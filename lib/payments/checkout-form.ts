/**
 * Saviskar 2026 - PayU Hosted Checkout Form Submission Helper
 *
 * Constructs and submits the hidden HTML form required by PayU Hosted Checkout.
 * Shared between RegistrationForm.tsx, app/payment/resume/page.tsx, and automated tests.
 */

export interface PayUCheckoutConfig {
  gateway?: string;
  postUrl?: string;
  options?: Record<string, unknown>;
}

/**
 * Builds the hidden HTML form element populated with PayU checkout parameters.
 * Validates that postUrl and options.hash are present before constructing.
 */
export function buildPayUCheckoutForm(
  checkoutConfig?: PayUCheckoutConfig | null,
  doc: Document = typeof document !== "undefined" ? document : ({} as Document)
): HTMLFormElement {
  const options = checkoutConfig?.options ?? {};
  const postUrl = checkoutConfig?.postUrl;

  if (!postUrl || !options.hash) {
    throw new Error("Payment gateway configuration is missing or invalid.");
  }

  const checkoutForm = doc.createElement("form");
  checkoutForm.method = "POST";
  checkoutForm.action = postUrl;
  checkoutForm.style.display = "none";

  for (const [key, value] of Object.entries(options)) {
    if (value !== undefined && value !== null) {
      const input = doc.createElement("input");
      input.type = "hidden";
      input.name = key;
      input.value = String(value);
      checkoutForm.appendChild(input);
    }
  }

  return checkoutForm;
}

/**
 * Appends the constructed PayU form to document.body and submits it.
 */
export function submitPayUCheckoutForm(
  checkoutConfig?: PayUCheckoutConfig | null,
  doc: Document = typeof document !== "undefined" ? document : ({} as Document)
): HTMLFormElement {
  const form = buildPayUCheckoutForm(checkoutConfig, doc);
  if (doc.body) {
    doc.body.appendChild(form);
  }
  form.submit();
  return form;
}
