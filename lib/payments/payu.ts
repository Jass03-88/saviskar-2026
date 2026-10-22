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

/**
 * Decimal-safe parsing of currency strings or numbers to integer paise.
 * Avoids floating-point inaccuracies by rounding to nearest integer paise.
 */
export function parsePaise(val: unknown): number | undefined {
  if (val === null || val === undefined || val === "") return undefined;
  if (typeof val === "string" && val.trim() === "") return undefined;
  const num = typeof val === "number" ? val : parseFloat(String(val).trim());
  if (isNaN(num)) return undefined;
  return Math.round(num * 100);
}

export type NormalizedPayUAmounts = {
  baseAmountPaise: number;
  additionalChargesPaise: number;
  customerTransactionAmountPaise?: number;
  settlementAmountPaise?: number;
  amountSettledPaise?: number;
  deductionsPaise: number;
  payuAmtPaise?: number;
  payuTransactionAmountPaise?: number;
  netDebitPaise?: number;
  amountAmbiguityReason?: string;
};

/**
 * Normalizes amount fields from PayU verify_payment transaction responses.
 *
 * In PayU's API contract:
 * - `amt`: Merchant-requested base transaction amount (e.g. "999.00").
 * - `transaction_amount`: Base or gross captured transaction amount (e.g. "999.00" or "1000.18").
 * - `additional_charges`: Explicit customer-side payment gateway surcharge / convenience fee (e.g. "1.18").
 * - `net_amount_debit`: Customer debit amount debited from customer account/card (e.g. "1000.18").
 * - `amount_settled`: Authoritative settlement amount credited to merchant bank account (e.g. "999.00"). Only present when returned by settlement APIs.
 * - `disc`: Merchant-side discount or deduction (e.g. "0.00").
 *
 * Never subtracts explicit charges from transaction_amount when transaction_amount is already the base amount!
 * If `amt` and `transaction_amount` differ and cannot be reconciled via `additional_charges`, flags ambiguity
 * and prevents premature or unsafe classification.
 */
export function normalizePayUAmountFields(
  txRecord: Record<string, unknown>,
  fallbackAmount?: string,
  explicitStatus?: string
): NormalizedPayUAmounts {
  const payuAmtPaise = parsePaise(txRecord.amt);
  const payuTxnAmtPaise = parsePaise(txRecord.transaction_amount);
  const additionalChargesPaise = parsePaise(txRecord.additional_charges) ?? 0;
  const netDebitPaise = parsePaise(txRecord.net_amount_debit);
  const amountSettledPaise = parsePaise(txRecord.amount_settled);
  const deductionsPaise = parsePaise(txRecord.disc) ?? 0;

  let baseAmountPaise = 0;
  let customerTransactionAmountPaise: number | undefined;
  let amountAmbiguityReason: string | undefined;

  if (payuAmtPaise != null && payuTxnAmtPaise != null) {
    if (payuAmtPaise === payuTxnAmtPaise) {
      // Standard PayU legacy response: amt and transaction_amount both report the base amount.
      baseAmountPaise = payuAmtPaise;
      if (additionalChargesPaise > 0) {
        customerTransactionAmountPaise = baseAmountPaise + additionalChargesPaise;
      }
    } else if (
      additionalChargesPaise > 0 &&
      payuTxnAmtPaise - additionalChargesPaise === payuAmtPaise
    ) {
      // transaction_amount represents gross customer debit, amt represents base amount.
      baseAmountPaise = payuAmtPaise;
      customerTransactionAmountPaise = payuTxnAmtPaise;
    } else if (
      additionalChargesPaise > 0 &&
      payuAmtPaise - additionalChargesPaise === payuTxnAmtPaise
    ) {
      // Inverted format: amt represents gross customer debit, transaction_amount represents base amount.
      baseAmountPaise = payuTxnAmtPaise;
      customerTransactionAmountPaise = payuAmtPaise;
    } else {
      // Discordant amounts that do not reconcile with reported additional charges!
      amountAmbiguityReason = `PayU amount fields mismatch: 'amt' (₹${payuAmtPaise / 100}) and 'transaction_amount' (₹${payuTxnAmtPaise / 100}) differ and cannot be reconciled with additional_charges (₹${additionalChargesPaise / 100}).`;
      baseAmountPaise = payuAmtPaise;
    }
  } else if (payuAmtPaise != null) {
    baseAmountPaise = payuAmtPaise;
    if (additionalChargesPaise > 0) {
      customerTransactionAmountPaise = baseAmountPaise + additionalChargesPaise;
    }
  } else if (payuTxnAmtPaise != null) {
    baseAmountPaise = payuTxnAmtPaise;
    if (additionalChargesPaise > 0) {
      customerTransactionAmountPaise = baseAmountPaise + additionalChargesPaise;
    }
  } else {
    baseAmountPaise = parsePaise(fallbackAmount) ?? 0;
    if (baseAmountPaise === 0) {
      amountAmbiguityReason = "Missing PayU amount fields in gateway transaction response.";
    }
  }

  // Status-aware classification
  const rawStatus = (
    explicitStatus ||
    (typeof txRecord.status === "string" ? txRecord.status : "") ||
    (typeof txRecord.unmappedstatus === "string" ? txRecord.unmappedstatus : "")
  ).toLowerCase().trim();

  const isExplicitFailure =
    rawStatus === "failure" ||
    rawStatus === "failed" ||
    rawStatus === "bounced" ||
    rawStatus === "usercancelled" ||
    rawStatus === "dropped";

  const isExplicitPending =
    rawStatus === "pending" ||
    rawStatus === "in progress";

  // Corroborate customer debit using net_amount_debit
  // In PayU's API contract, net_amount_debit represents the customer debit amount (either gross debit or net of surcharge).
  if (netDebitPaise != null) {
    if (netDebitPaise === 0) {
      customerTransactionAmountPaise = 0;
      if (isExplicitFailure) {
        // Case A: PayU explicitly reports failure, and net_amount_debit is zero.
        // Customer was not debited because the transaction failed.
        // Do NOT generate an amount-discrepancy warning solely because zero differs from the expected charge.
      } else if (isExplicitPending) {
        // Case B: PayU reports pending, and net_amount_debit is zero.
        // Payment is still awaiting completion or confirmation by PayU.
        // Do NOT treat zero debit as an amount discrepancy.
      } else {
        // Case C: PayU reports success (or status is unspecified/assumed captured), but net_amount_debit is zero for a positive expected charge.
        // Zero customer debit directly contradicts payment capture!
        if (baseAmountPaise > 0) {
          const zeroDebitDiff = `PayU customer debit discrepancy: 'net_amount_debit' is ₹0.00 for a ₹${(baseAmountPaise / 100).toFixed(2)} order. Zero debit cannot prove payment capture.`;
          amountAmbiguityReason = amountAmbiguityReason
            ? `${amountAmbiguityReason} ${zeroDebitDiff}`
            : zeroDebitDiff;
        }
      }
    } else {
      // Positive customer debit
      if (customerTransactionAmountPaise == null) {
        customerTransactionAmountPaise =
          additionalChargesPaise > 0 && netDebitPaise === baseAmountPaise
            ? baseAmountPaise + additionalChargesPaise
            : netDebitPaise;
        if (
          additionalChargesPaise === 0 &&
          netDebitPaise !== baseAmountPaise
        ) {
          const debitDiff = `PayU customer debit discrepancy: 'net_amount_debit' (₹${(netDebitPaise / 100).toFixed(2)}) differs from base order amount (₹${(baseAmountPaise / 100).toFixed(2)}).`;
          amountAmbiguityReason = amountAmbiguityReason
            ? `${amountAmbiguityReason} ${debitDiff}`
            : debitDiff;
        }
      } else if (
        netDebitPaise !== customerTransactionAmountPaise &&
        netDebitPaise !== baseAmountPaise
      ) {
        const debitDiff = `PayU customer debit discrepancy: 'net_amount_debit' (₹${(netDebitPaise / 100).toFixed(2)}) differs from customer debit (₹${(customerTransactionAmountPaise / 100).toFixed(2)}).`;
        amountAmbiguityReason = amountAmbiguityReason
          ? `${amountAmbiguityReason} ${debitDiff}`
          : debitDiff;
      }
    }
  }

  // Settlement amount resolution & validation
  // Merchant settlement ONLY comes from an authoritative settlement field (amount_settled).
  // Under NO circumstances fall back to net_amount_debit (customer debit), amt, or transaction_amount.
  let settlementAmountPaise: number | undefined;
  if (amountSettledPaise != null) {
    settlementAmountPaise = amountSettledPaise;
    if (
      customerTransactionAmountPaise != null &&
      amountSettledPaise > customerTransactionAmountPaise
    ) {
      const settleDiff = `PayU settlement discrepancy: 'amount_settled' (₹${(amountSettledPaise / 100).toFixed(2)}) exceeds customer debit (₹${(customerTransactionAmountPaise / 100).toFixed(2)}).`;
      amountAmbiguityReason = amountAmbiguityReason
        ? `${amountAmbiguityReason} ${settleDiff}`
        : settleDiff;
    }
    const expectedMerchantNet = baseAmountPaise - deductionsPaise;
    if (expectedMerchantNet > 0 && amountSettledPaise !== expectedMerchantNet) {
      const settleNetDiff = `PayU settlement discrepancy: 'amount_settled' (₹${(amountSettledPaise / 100).toFixed(2)}) differs from expected merchant net settlement (₹${(expectedMerchantNet / 100).toFixed(2)}).`;
      amountAmbiguityReason = amountAmbiguityReason
        ? `${amountAmbiguityReason} ${settleNetDiff}`
        : settleNetDiff;
    }
  }

  return {
    baseAmountPaise,
    additionalChargesPaise,
    customerTransactionAmountPaise,
    settlementAmountPaise,
    amountSettledPaise,
    deductionsPaise,
    payuAmtPaise,
    payuTransactionAmountPaise: payuTxnAmtPaise,
    netDebitPaise,
    amountAmbiguityReason,
  };
}

export class PayUGateway implements PaymentGateway {
  readonly name = "payu";

  private cleanSecret(val?: string): string {
    return (val || "").trim().replace(/^["']+|["']+$/g, "").trim();
  }

  private get environment(): "test" | "production" {
    if (process.env.PAYU_ENVIRONMENT === "production") return "production";
    if (process.env.PAYU_ENVIRONMENT === "test") return "test";
    throw new Error("CRITICAL: PAYU_ENVIRONMENT must be explicitly 'test' or 'production'");
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
    const k = this.cleanSecret(process.env.PAYU_KEY);
    if (!k) throw new Error("PAYU_KEY is not set in environment variables.");
    return k;
  }

  private get salt(): string {
    const s = this.cleanSecret(process.env.PAYU_SALT);
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

    const txRecord = transaction as Record<string, unknown>;
    const amounts = normalizePayUAmountFields(txRecord, transaction.amount, parsedStatus);

    const bankRefNum = typeof txRecord.bank_ref_num === "string" && txRecord.bank_ref_num.trim()
      ? txRecord.bank_ref_num.trim()
      : typeof txRecord.field2 === "string" && txRecord.field2.trim()
        ? txRecord.field2.trim()
        : undefined;

    const udf1 = typeof txRecord.udf1 === "string" && txRecord.udf1.trim()
      ? txRecord.udf1.trim()
      : undefined;

    return {
      gatewayPaymentId: transaction.mihpayid?.toString() || "",
      gatewayOrderId: transaction.txnid || var1,
      status: parsedStatus,
      amount: amounts.baseAmountPaise,
      currency: "INR",
      rawStatus: transaction.status,
      unmappedStatus: typeof txRecord.unmappedstatus === "string" ? txRecord.unmappedstatus : undefined,
      mode: typeof txRecord.mode === "string" ? txRecord.mode : undefined,
      addedOn: typeof txRecord.addedon === "string" ? txRecord.addedon : undefined,
      additionalCharges: amounts.additionalChargesPaise,
      bankRefNum,
      udf1,
      settlementAmount: amounts.settlementAmountPaise,
      amountSettledPaise: amounts.amountSettledPaise,
      deductions: amounts.deductionsPaise,
      customerTransactionAmount: amounts.customerTransactionAmountPaise,
      payuAmtPaise: amounts.payuAmtPaise,
      payuTransactionAmountPaise: amounts.payuTransactionAmountPaise,
      netDebitPaise: amounts.netDebitPaise,
      amountAmbiguityReason: amounts.amountAmbiguityReason,
    };
  }

  /**
   * Batch verification of multiple PayU gateway order references (txnid)
   * using PayU's pipe-delimited verify_payment command.
   *
   * PayU supports up to 50 txnids per request. We enforce bounded chunks (max 25)
   * with strict 15-second timeouts and safe error handling.
   */
  async fetchPaymentBatchDetails(gatewayOrderIds: string[]): Promise<Record<string, FetchedPaymentDetails>> {
    if (!gatewayOrderIds || gatewayOrderIds.length === 0) {
      return {};
    }

    const uniqueIds = Array.from(new Set(gatewayOrderIds.filter((id) => Boolean(id && id.trim()))));
    if (uniqueIds.length === 0) return {};

    const CHUNK_SIZE = 25; // Safely below PayU's 50 limit
    const results: Record<string, FetchedPaymentDetails> = {};

    for (let i = 0; i < uniqueIds.length; i += CHUNK_SIZE) {
      const chunk = uniqueIds.slice(i, i + CHUNK_SIZE);
      const var1 = chunk.join("|");
      const command = "verify_payment";
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
          signal: AbortSignal.timeout(15_000),
        });
      } catch (err) {
        const isTimeout =
          err instanceof Error &&
          (err.name === "TimeoutError" || err.message.toLowerCase().includes("timeout"));
        throw new PaymentVerificationError(
          isTimeout ? "timeout" : "network",
          `fetchPaymentBatchDetails: Network/timeout error verifying batch: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }

      if (!response.ok) {
        const errorBody = await response.text().catch(() => "(unreadable)");
        throw new PaymentVerificationError(
          "provider_error",
          `fetchPaymentBatchDetails: PayU returned HTTP ${response.status}: ${errorBody}`
        );
      }

      const text = await response.text();
      let data: any;
      try {
        data = JSON.parse(text);
      } catch {
        throw new PaymentVerificationError(
          "malformed",
          "fetchPaymentBatchDetails: Malformed non-JSON response from PayU."
        );
      }

      const detailsMap = data?.transaction_details || {};

      for (const txnid of chunk) {
        const transaction = detailsMap[txnid];
        if (!transaction || transaction.status === "Not Found" || transaction.mihpayid === "Not Found") {
          results[txnid] = {
            gatewayPaymentId: "",
            gatewayOrderId: txnid,
            status: "not_found",
            amount: 0,
            currency: "INR",
            rawStatus: transaction?.status || "Not Found",
          };
          continue;
        }

        const rawStatus = (transaction.status || "").toLowerCase().trim();
        let parsedStatus = "failed";
        if (rawStatus === "success") parsedStatus = "paid";
        else if (rawStatus === "pending" || rawStatus === "in progress") parsedStatus = "pending";
        else if (rawStatus === "not found") parsedStatus = "not_found";

        const txRecord = transaction as Record<string, unknown>;
        const amounts = normalizePayUAmountFields(txRecord, transaction.amount, parsedStatus);

        results[txnid] = {
          gatewayPaymentId: transaction.mihpayid?.toString() || "",
          gatewayOrderId: transaction.txnid || txnid,
          status: parsedStatus,
          amount: amounts.baseAmountPaise,
          currency: "INR",
          rawStatus: transaction.status,
          unmappedStatus: typeof txRecord.unmappedstatus === "string" ? txRecord.unmappedstatus : undefined,
          mode: typeof txRecord.mode === "string" ? txRecord.mode : undefined,
          addedOn: typeof txRecord.addedon === "string" ? txRecord.addedon : undefined,
          additionalCharges: amounts.additionalChargesPaise,
          bankRefNum: typeof txRecord.bank_ref_num === "string" && txRecord.bank_ref_num.trim()
            ? txRecord.bank_ref_num.trim()
            : typeof txRecord.field2 === "string" && txRecord.field2.trim()
              ? txRecord.field2.trim()
              : undefined,
          udf1: typeof txRecord.udf1 === "string" && txRecord.udf1.trim()
            ? txRecord.udf1.trim()
            : undefined,
          settlementAmount: amounts.settlementAmountPaise,
          amountSettledPaise: amounts.amountSettledPaise,
          deductions: amounts.deductionsPaise,
          customerTransactionAmount: amounts.customerTransactionAmountPaise,
          payuAmtPaise: amounts.payuAmtPaise,
          payuTransactionAmountPaise: amounts.payuTransactionAmountPaise,
          netDebitPaise: amounts.netDebitPaise,
          amountAmbiguityReason: amounts.amountAmbiguityReason,
        };
      }
    }

    return results;
  }
}
