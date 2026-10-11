// vitest.setup.ts - Test Environment Isolation
import { beforeAll } from "vitest";

// Guard against tests ever touching production or staging Supabase databases
const PROTECTED_SUPABASE_HOSTS = [
  "ikavnyjfmdxjnlbovkzm.supabase.co", // Production
  "mjxwzknnlgvwtwklzkks.supabase.co", // Staging
];

beforeAll(() => {
  const currentUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  
  for (const host of PROTECTED_SUPABASE_HOSTS) {
    if (currentUrl.includes(host)) {
      // Force test isolation: replace live URL with a deterministically unresolvable URL.
      // This explicitly denies network access rather than redirecting to a potentially non-existent local server.
      process.env.NEXT_PUBLIC_SUPABASE_URL = "http://0.0.0.0:0";
      process.env.SUPABASE_SECRET_KEY = "mock-service-role-key-test-environment-isolated";
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "mock-anon-key-test-environment-isolated";
    }
  }
});
