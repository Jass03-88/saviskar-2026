import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "@/app/api/participants/me/route";
import { NextRequest } from "next/server";
import { resetRateLimitStore } from "@/lib/rate-limit";

// Mock Supabase environment variables
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SECRET_KEY = "test-secret-key";

let mockSession = {
  authenticated: false,
  email: undefined as string | undefined,
};

vi.mock("@/lib/auth/session", () => ({
  getRegistrationSession: async () => mockSession,
}));

const mockDbParticipantsByEmail: Record<string, Record<string, unknown>> = {
  "aarav.sharma@example.com": {
    id: "uuid-p1",
    participant_id: "SVK26-12345678",
    name: "Aarav Sharma",
    college: "IIT Bombay",
    email: "aarav.sharma@example.com",
    phone: "9876543210",
    participant_events: [
      {
        id: "pe-1",
        event_id: "evt-robotics",
        payment_status: "paid",
        payment_amount: 500,
        is_archived: false,
        events: { name: "RoboWars" },
      },
    ],
    participant_event_members: [],
  },
  "anand.j4072@cgcuniversity.in": {
    id: "uuid-p2",
    participant_id: "SVK26-D917882D",
    name: "Anand",
    college: "CGC University",
    email: "anand.j4072@cgcuniversity.in",
    phone: "9876500000",
    participant_events: [],
    participant_event_members: [
      {
        id: "pem-1",
        participant_event_id: "pe-chords-1",
        participant_events: {
          id: "pe-chords-1",
          event_id: "evt-chords",
          payment_status: "pending",
          payment_amount: 300,
          is_archived: false,
          events: { name: "Clash of Chords" },
        },
      },
    ],
  },
  "archived.user@example.com": {
    id: "uuid-p3",
    participant_id: "SVK26-ARCHIVED",
    name: "Archived User",
    college: "IIT Bombay",
    email: "archived.user@example.com",
    phone: "9876544444",
    participant_events: [
      {
        id: "pe-archived-1",
        event_id: "evt-robotics",
        payment_status: "paid",
        payment_amount: 500,
        is_archived: true,
        events: { name: "RoboWars" },
      },
    ],
    participant_event_members: [],
  },
};

vi.mock("@supabase/supabase-js", () => {
  const createChainable = (val?: string) => {
    const chain: any = {
      eq: (_col: string, v: string) => createChainable(val || v),
      not: () => chain,
      order: () => chain,
      limit: () => Promise.resolve({ data: [], error: null }),
      maybeSingle: async () => {
        const p = val ? mockDbParticipantsByEmail[val.toLowerCase()] : null;
        if (!p) return { data: null, error: null };
        return { data: p, error: null };
      },
    };
    return chain;
  };

  return {
    createClient: () => ({
      from: () => ({
        select: () => createChainable(),
      }),
    }),
  };
});

function makeRequest(): NextRequest {
  return new NextRequest("http://localhost/api/participants/me", { method: "GET" });
}

describe("GET /api/participants/me - Authenticated Participant Hydration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimitStore();
    mockSession = { authenticated: false, email: undefined };
  });

  it("1. Rejects unauthenticated request with 401", async () => {
    mockSession = { authenticated: false, email: undefined };
    const req = makeRequest();
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.success).toBe(false);
    expect(body.error).toContain("authentication required");
  });

  it("2. Returns found: false for authenticated first-time registrant", async () => {
    mockSession = { authenticated: true, email: "brand.new.user@example.com" };
    const req = makeRequest();
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.found).toBe(false);
    expect(body.participant).toBeUndefined();
  });

  it("3. Returns verified profile and events for returning participant with direct events", async () => {
    mockSession = { authenticated: true, email: "aarav.sharma@example.com" };
    const req = makeRequest();
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.found).toBe(true);
    expect(body.participant.participantId).toBe("SVK26-12345678");
    expect(body.participant.name).toBe("Aarav Sharma");
    expect(body.participant.college).toBe("IIT Bombay");
    expect(body.participant.email).toBe("aarav.sharma@example.com");
    expect(body.participant.phone).toBe("9876543210");

    expect(body.events).toHaveLength(1);
    expect(body.events[0]).toMatchObject({
      participantEventId: "pe-1",
      eventId: "evt-robotics",
      eventName: "RoboWars",
      paymentStatus: "paid",
      paymentAmount: 500,
    });
  });

  it("4. Returns pending team events for participant registered as a team member", async () => {
    mockSession = { authenticated: true, email: "anand.j4072@cgcuniversity.in" };
    const req = makeRequest();
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.found).toBe(true);
    expect(body.participant.participantId).toBe("SVK26-D917882D");
    expect(body.events).toHaveLength(1);
    expect(body.events[0]).toMatchObject({
      participantEventId: "pe-chords-1",
      eventId: "evt-chords",
      eventName: "Clash of Chords",
      paymentStatus: "pending",
      paymentAmount: 300,
    });
  });

  it("5. Filters out archived events from results", async () => {
    mockSession = { authenticated: true, email: "archived.user@example.com" };
    const req = makeRequest();
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.found).toBe(true);
    expect(body.events).toHaveLength(0);
  });

  it("6. Enforces rate limits (30 reqs/min per IP)", async () => {
    mockSession = { authenticated: true, email: "aarav.sharma@example.com" };

    // Fire 30 requests
    for (let i = 0; i < 30; i++) {
      const res = await GET(makeRequest());
      expect(res.status).toBe(200);
    }

    // 31st request should be rate-limited
    const rateLimitedRes = await GET(makeRequest());
    expect(rateLimitedRes.status).toBe(429);
    const body = await rateLimitedRes.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain("Too many lookup attempts");
  });
});
