import crypto from "crypto";
import {
  CheckoutConfig,
  CreateOrderParams,
  CreateOrderResult,
  FetchedPaymentDetails,
  PaymentGateway,
  WebhookValidationResult,
  VerifyPaymentParams,
  VerifyPaymentResult,
} from "./types";
import {
  generatePayURequestHash,
  generatePayUCommandHash,
  verifyPayUResponseHash,
} from "./payu-hash";
import { getSiteBaseUrl } from "./resume-token";

export class PayUGateway implements PaymentGateway {
  readonly name = "payu";

  private get environment(): "test" | "production" {
    return process.env.PAYU_ENVIRONMENT === "production" ? "production" : "test";
  }

  private get endpoint(): string {
    return this.environment === "production"
      ? "https://secure.payu.in/_payment"
      : "https://test.payu.in/_payment";
  }

  private get verifyEndpoint(): string {
    return this.environment === "production"
      ? "https://info.payu.in/merchant/postservice.php?form=2"
      : "https://test.payu.in/merchant/postservice.php?form=2";
  }

  private get key(): string {
    const k = process.env.PAYU_KEY?.trim();
    if (!k) throw new Error("PAYU_KEY is not set in environment variables.");
    return k;
  }

  private get salt(): string {
    const s = process.env.PAYU_SALT?.trim();
    if (!s) throw new Error("PAYU_SALT is not set in environment variables.");
    return s;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async createOrder(_params: CreateOrderParams): Promise<CreateOrderResult> {
    // txnid must be unique, max 25 chars.
    const randomSuffix = crypto.randomBytes(4).toString("hex");
    let txnid = `SVK-${Date.now()}-${randomSuffix}`;
    if (txnid.length > 25) {
      txnid = txnid.substring(0, 25);
    }
    
    return {
      gatewayOrderId: txnid,
      status: "created", // Maps to 'pending' internally by our services
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async verifyPayment(_params: VerifyPaymentParams): Promise<VerifyPaymentResult> {
    throw new Error("verifyPayment should use fetchPaymentDetails directly for PayU.");
  }

  getCheckoutConfig(params: {
    gatewayOrderId: string;
    amount: number;
    currency: string;
    payer: CreateOrderParams["payer"];
    orderReference: string;
    baseUrl?: string;
  }): CheckoutConfig {
    const amountStr = (params.amount / 100).toFixed(2); // Convert paise to INR
    const productinfo = "Saviskar 2026 Registration";
    const firstname = params.payer.name?.trim().substring(0, 50) || "Participant";
    const email = params.payer.email?.trim() || "noreply@saviskar.co.in";
    const phone = params.payer.phone?.trim() || "9999999999";
    const udf1 = params.orderReference; 

    const baseUrl = params.baseUrl || getSiteBaseUrl();
    const surl = `${baseUrl}/api/payments/payu/success`;
    const furl = `${baseUrl}/api/payments/payu/failure`;

    const hash = generatePayURequestHash({
      key: this.key,
      txnid: params.gatewayOrderId,
      amount: amountStr,
      productinfo,
      firstname,
      email,
      udf1,
      salt: this.salt,
    });

    const options = {
      key: this.key,
      txnid: params.gatewayOrderId,
      amount: amountStr,
      productinfo,
      firstname,
      email,
      phone,
      surl,
      furl,
      udf1,
      hash,
    };

    return {
      gateway: this.name,
      options,
      postUrl: this.endpoint,
    };
  }

  validateWebhook(params: { body: string; signature: string }): WebhookValidationResult {
    try {
      const data = new URLSearchParams(params.body);
      
      const status = data.get("status") || "";
      const txnid = data.get("txnid") || "";
      const amount = data.get("amount") || "";
      const productinfo = data.get("productinfo") || "";
      const firstname = data.get("firstname") || "";
      const email = data.get("email") || "";
      const udf1 = data.get("udf1") || "";
      const udf2 = data.get("udf2") || "";
      const udf3 = data.get("udf3") || "";
      const udf4 = data.get("udf4") || "";
      const udf5 = data.get("udf5") || "";
      const key = data.get("key") || "";
      const additionalCharges = data.get("additional_charges") || undefined;
      const mihpayid = data.get("mihpayid") || "";

      // Signature could be in a header (params.signature) or we verify the received hash in the body
      const receivedHash = data.get("hash") || params.signature || "";

      const isValid = verifyPayUResponseHash({
        status,
        email,
        firstname,
        productinfo,
        amount,
        txnid,
        key,
        salt: this.salt,
        udf1,
        udf2,
        udf3,
        udf4,
        udf5,
        additionalCharges,
        receivedHash
      });

      if (!isValid) {
        return { valid: false, error: "Invalid webhook signature." };
      }

      let parsedStatus: "pending" | "paid" | "failed" | "cancelled" | "refunded" = "failed";
      if (status === "success") {
        parsedStatus = "paid";
      } else if (status === "pending") {
        parsedStatus = "pending";
      }

      return {
        valid: true,
        event: {
          eventType: status, 
          gatewayOrderId: txnid,
          gatewayPaymentId: mihpayid,
          status: parsedStatus,
          amount: Math.round(parseFloat(amount) * 100), 
          currency: "INR",
          rawPayload: Object.fromEntries(data.entries()),
        }
      };
    } catch {
      return { valid: false, error: "Invalid webhook body." };
    }
  }

  async fetchPaymentDetails(gatewayPaymentId: string): Promise<FetchedPaymentDetails> {
    if (!gatewayPaymentId) {
      throw new Error("fetchPaymentDetails: gatewayPaymentId is required.");
    }
    const command = "verify_payment";
    const var1 = gatewayPaymentId; // PayU verify payment takes txnid as var1. So we pass txnid as gatewayPaymentId.
    const hash = generatePayUCommandHash({
      key: this.key,
      command,
      var1,
      salt: this.salt,
    });

    const body = new URLSearchParams();
    body.append("key", this.key);
    body.append("command", command);
    body.append("var1", var1);
    body.append("hash", hash);

    let response: Response;
    try {
      response = await fetch(this.verifyEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      throw new Error(`fetchPaymentDetails: Network/timeout error fetching payment ${gatewayPaymentId}: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "(unreadable)");
      throw new Error(`fetchPaymentDetails: PayU returned ${response.status} for payment ${gatewayPaymentId}: ${errorBody}`);
    }

    let data: {
      status?: number;
      msg?: string;
      transaction_details?: Record<string, {
        status?: string;
        mihpayid?: string | number;
        txnid?: string;
        amt?: string;
        amount?: string;
      }>;
    };
    try {
      const text = await response.text();
      try {
        data = JSON.parse(text);
      } catch {
        console.error(`PayU fetchPaymentDetails JSON parse failed for ${gatewayPaymentId}. Raw response: ${text.substring(0, 500)}`);
        throw new Error(`fetchPaymentDetails: Malformed JSON response for payment ${gatewayPaymentId}.`);
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes('Malformed JSON')) {
        throw err;
      }
      throw new Error(`fetchPaymentDetails: Failed to read response for payment ${gatewayPaymentId}.`);
    }
    
    if (data.status !== 1) {
      throw new Error(`fetchPaymentDetails: PayU verification failed for ${gatewayPaymentId}: ${data.msg}`);
    }
    
    const transaction = data.transaction_details?.[var1];
    if (!transaction) {
      throw new Error(`fetchPaymentDetails: Transaction not found in PayU response for ${gatewayPaymentId}.`);
    }
    
    let parsedStatus = "failed";
    if (transaction.status === "success") {
      parsedStatus = "paid";
    } else if (transaction.status === "pending" || transaction.status === "in progress") {
      parsedStatus = "pending";
    }

    const amt = parseFloat(transaction.amt || transaction.amount || "0");
    const amountInPaise = Math.round(amt * 100);

    return {
      gatewayPaymentId: transaction.mihpayid?.toString() || "",
      gatewayOrderId: transaction.txnid || var1,
      status: parsedStatus,
      amount: amountInPaise,
      currency: "INR",
    };
  }
}
