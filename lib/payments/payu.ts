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
  PaymentVerificationError,
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
      throw new PaymentVerificationError("provider_error", "fetchPaymentDetails: gatewayPaymentId is required.");
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
      const isTimeout =
        err instanceof Error &&
        (err.name === "TimeoutError" || err.message.toLowerCase().includes("timeout"));
      throw new PaymentVerificationError(
        isTimeout ? "timeout" : "network",
        `fetchPaymentDetails: Network or timeout error fetching payment ${gatewayPaymentId}: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "(unreadable)");
      throw new PaymentVerificationError(
        "provider_error",
        `fetchPaymentDetails: PayU returned HTTP ${response.status} for payment ${gatewayPaymentId}: ${errorBody}`
      );
    }

    let text: string;
    try {
      text = await response.text();
    } catch (readErr) {
      throw new PaymentVerificationError(
        "network",
        `fetchPaymentDetails: Failed to read response stream for payment ${gatewayPaymentId}: ${
          readErr instanceof Error ? readErr.message : String(readErr)
        }`
      );
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
      data = JSON.parse(text);
    } catch {
      console.error(
        `PayU fetchPaymentDetails JSON parse failed for ${gatewayPaymentId}. Raw response: ${text.substring(0, 500)}`
      );
      throw new PaymentVerificationError(
        "malformed",
        `fetchPaymentDetails: Malformed non-JSON response from PayU for payment ${gatewayPaymentId}.`
      );
    }

    // 1. Detect credential / environment mismatch error from PayU
    if (data.status === 0 && data.msg?.toLowerCase().includes("invalid hash")) {
      console.error(
        `[PAYU CONFIG ERROR] PayU command hash rejected ("Invalid Hash."). Check that PAYU_ENVIRONMENT ("${this.environment}") matches the configured merchant key and salt.`
      );
      throw new PaymentVerificationError(
        "invalid_credentials",
        `PayU verification rejected command hash ("${data.msg}"). Verify PAYU_ENVIRONMENT matches key and salt.`
      );
    }

    const transaction = data.transaction_details?.[var1];

    // 2. Transaction Not Found (status: 0 with 'Not Found', or transaction object with status 'Not Found')
    // This happens when checkout was opened but attendee never entered/submitted payment details on PayU.
    if (
      (data.status === 0 &&
        (!transaction ||
          transaction.status === "Not Found" ||
          transaction.mihpayid === "Not Found" ||
          data.msg?.includes("0 out of") ||
          data.msg?.toLowerCase().includes("no transactions found"))) ||
      (transaction &&
        (transaction.status === "Not Found" || transaction.mihpayid === "Not Found"))
    ) {
      return {
        gatewayPaymentId: "",
        gatewayOrderId: var1,
        status: "not_found",
        amount: 0,
        currency: "INR",
        rawStatus: transaction?.status || data.msg || "Not Found",
      };
    }

    // 3. If transaction is completely absent and status !== 0
    if (!transaction) {
      throw new PaymentVerificationError(
        "provider_error",
        `fetchPaymentDetails: PayU returned status ${data.status} (${data.msg}) without transaction details for ${gatewayPaymentId}.`
      );
    }

    // 4. Map PayU transaction status safely
    const rawStatus = (transaction.status || "").toLowerCase().trim();
    let parsedStatus = "failed";

    if (rawStatus === "success") {
      parsedStatus = "paid";
    } else if (rawStatus === "pending" || rawStatus === "in progress") {
      parsedStatus = "pending";
    } else if (
      rawStatus === "failure" ||
      rawStatus === "failed" ||
      rawStatus === "bounced" ||
      rawStatus === "usercancelled" ||
      rawStatus === "dropped"
    ) {
      parsedStatus = "failed";
    } else if (rawStatus === "not found") {
      parsedStatus = "not_found";
    }

    const amt = parseFloat(transaction.amt || transaction.amount || "0");
    const amountInPaise = Math.round(amt * 100);

    return {
      gatewayPaymentId: transaction.mihpayid?.toString() || "",
      gatewayOrderId: transaction.txnid || var1,
      status: parsedStatus,
      amount: amountInPaise,
      currency: "INR",
      rawStatus: transaction.status,
    };
  }
}
