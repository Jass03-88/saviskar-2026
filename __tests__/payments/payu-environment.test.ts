import { PayUGateway } from "@/lib/payments/payu";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

describe("PayU Environment Selection", () => {
  beforeEach(() => {
    // Provide dummy keys to pass validation
    vi.stubEnv("PAYU_KEY", "test_key");
    vi.stubEnv("PAYU_SALT", "test_salt");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  const getEndpoint = () => {
    const gateway = new PayUGateway();
    return gateway.getCheckoutConfig({
      gatewayOrderId: "txnid",
      amount: 100,
      currency: "INR",
      payer: { name: "Test", email: "test@example.com", phone: "9999999999" },
      orderReference: "ref",
    }).postUrl;
  };

  it("1. PAYU_ENVIRONMENT=test with NODE_ENV=development", () => {
    vi.stubEnv("PAYU_ENVIRONMENT", "test");
    vi.stubEnv("NODE_ENV", "development");
    expect(getEndpoint()).toBe("https://test.payu.in/_payment");
  });

  it("2. PAYU_ENVIRONMENT=test with NODE_ENV=production", () => {
    vi.stubEnv("PAYU_ENVIRONMENT", "test");
    vi.stubEnv("NODE_ENV", "production");
    expect(getEndpoint()).toBe("https://test.payu.in/_payment");
  });

  it("3. PAYU_ENVIRONMENT=production with NODE_ENV=production", () => {
    vi.stubEnv("PAYU_ENVIRONMENT", "production");
    vi.stubEnv("NODE_ENV", "production");
    expect(getEndpoint()).toBe("https://secure.payu.in/_payment");
  });

  it("4. Missing PAYU_ENVIRONMENT throws configuration error", () => {
    vi.stubEnv("PAYU_ENVIRONMENT", "");
    vi.stubEnv("NODE_ENV", "production");
    expect(() => getEndpoint()).toThrowError(/PAYU_ENVIRONMENT must be explicitly/);
  });

  it("5. Invalid PAYU_ENVIRONMENT throws configuration error", () => {
    vi.stubEnv("PAYU_ENVIRONMENT", "invalid");
    vi.stubEnv("NODE_ENV", "production");
    expect(() => getEndpoint()).toThrowError(/PAYU_ENVIRONMENT must be explicitly/);
  });
});
