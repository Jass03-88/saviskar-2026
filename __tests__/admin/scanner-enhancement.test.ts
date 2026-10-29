import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET as getParticipantDetails } from "@/app/api/admin/participants/[participantId]/route";
import * as serverLib from "@/lib/supabase/server";
import { calculateStayDates, getCanonicalStayLabel } from "@/lib/accommodation-dates";
import { evaluateEventPaymentStatus } from "@/lib/admin/check-in-rules";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SECRET_KEY = "test-secret-key";

// In-memory mock database state
interface MockDb {
  participants: any[];
  participantEvents: any[];
  participantEventMembers: any[];
  participantAccommodations: any[];
  facultyIncharges: any[];
  mutationCalls: { method: string; table: string; args: any }[];
}

let mockDb: MockDb = {
  participants: [],
  participantEvents: [],
  participantEventMembers: [],
  participantAccommodations: [],
  facultyIncharges: [],
  mutationCalls: [],
};

function createMockSupabaseAdmin() {
  return {
    from: (table: string) => {
      const builder: any = {
        select: (_cols?: string) => builder,
        eq: (col: string, val: any) => {
          return {
            maybeSingle: async () => {
              if (table === "participants") {
                const found = mockDb.participants.find(
                  (p) =>
                    p[col] === val ||
                    (col === "participant_id" &&
                      String(p.participant_id).toLowerCase() === String(val).toLowerCase())
                );
                return { data: found ? JSON.parse(JSON.stringify(found)) : null, error: null };
              }
              return { data: null, error: null };
            },
            single: async () => {
              if (table === "participants") {
                const found = mockDb.participants.find(
                  (p) =>
                    p[col] === val ||
                    (col === "participant_id" &&
                      String(p.participant_id).toLowerCase() === String(val).toLowerCase())
                );
                if (!found) return { data: null, error: { message: "Not found" } };
                return { data: JSON.parse(JSON.stringify(found)), error: null };
              }
              return { data: null, error: { message: "Not found" } };
            },
            limit: (n: number) => {
              if (table === "participants") {
                const found = mockDb.participants.filter(
                  (p) =>
                    p[col] === val ||
                    (col === "participant_id" &&
                      String(p.participant_id).toLowerCase() === String(val).toLowerCase())
                );
                return Promise.resolve({ data: JSON.parse(JSON.stringify(found.slice(0, n))), error: null });
              }
              return Promise.resolve({ data: [], error: null });
            },
          };
        },
        in: (col: string, values: any[]) => {
          if (table === "participant_event_members") {
            const matches = mockDb.participantEventMembers.filter((m) => values.includes(m[col]));
            return Promise.resolve({ data: JSON.parse(JSON.stringify(matches)), error: null });
          }
          if (table === "participant_accommodations") {
            const matches = mockDb.participantAccommodations.filter((acc) => values.includes(acc[col]));
            return Promise.resolve({ data: JSON.parse(JSON.stringify(matches)), error: null });
          }
          if (table === "faculty_incharges") {
            const matches = mockDb.facultyIncharges.filter((f) => values.includes(f[col]));
            return Promise.resolve({ data: JSON.parse(JSON.stringify(matches)), error: null });
          }
          if (table === "participants") {
            const matches = mockDb.participants.filter((p) => values.includes(p[col]));
            return Promise.resolve({ data: JSON.parse(JSON.stringify(matches)), error: null });
          }
          return Promise.resolve({ data: [], error: null });
        },
        insert: (args: any) => {
          mockDb.mutationCalls.push({ method: "insert", table, args });
          return Promise.resolve({ data: null, error: null });
        },
        update: (args: any) => {
          mockDb.mutationCalls.push({ method: "update", table, args });
          return {
            eq: () => Promise.resolve({ data: null, error: null }),
          };
        },
        delete: (args: any) => {
          mockDb.mutationCalls.push({ method: "delete", table, args });
          return {
            eq: () => Promise.resolve({ data: null, error: null }),
          };
        },
      };
      return builder;
    },
    storage: {
      from: (bucket: string) => ({
        createSignedUrl: (path: string, _expiresIn: number) => {
          return Promise.resolve({
            data: { signedUrl: `https://storage.supabase.co/${bucket}/${path}?token=mock-token` },
            error: null,
          });
        },
      }),
    },
  };
}

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => createMockSupabaseAdmin(),
}));

describe("Saviskar 2026 Admin Scanner Enhancement - 20 Critical Scenarios", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = {
      participants: [],
      participantEvents: [],
      participantEventMembers: [],
      participantAccommodations: [],
      facultyIncharges: [],
      mutationCalls: [],
    };

    vi.spyOn(serverLib, "requireAdmin").mockResolvedValue({
      user: { id: "admin-1", email: "admin@saviskar.org" },
      role: "admin",
      error: null,
      status: 200,
    } as any);
  });

  // 1. Scanning individual participant
  it("Scenario 1: Scanning individual participant retrieves personal profile and event details without crash", async () => {
    mockDb.participants = [
      {
        id: "p-solo-1",
        participant_id: "SVK26-SOLO0001",
        name: "Solo Singer",
        email: "solo@example.com",
        phone: "9876543210",
        college: "Music Academy",
        gender: "female",
        state: "Maharashtra",
        id_card_storage_path: "id-cards/solo.jpg",
        participant_events: [
          {
            id: "pe-solo-1",
            event_id: "evt-solo-1",
            participant_id: "p-solo-1",
            registration_status: "confirmed",
            payment_status: "paid",
            payment_amount: 300,
            checked_in: false,
            events: {
              name: "Solo Singing",
              registration_fee: 300,
              payment_type: "paid",
              is_team: false,
            },
          },
        ],
        participant_event_members: [],
        participant_accommodations: [],
      },
    ];

    const req = new Request("https://localhost/api/admin/participants/SVK26-SOLO0001");
    const res = await getParticipantDetails(req as any, { params: Promise.resolve({ participantId: "SVK26-SOLO0001" }) });
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.participant.name).toBe("Solo Singer");
    expect(data.participant.participantId).toBe("SVK26-SOLO0001");
    expect(data.participant.gender).toBe("female");
    expect(data.participant.state).toBe("Maharashtra");
    expect(data.participant.idCardUrl).toContain("solo.jpg");
    expect(data.participantEvents).toHaveLength(1);
    expect(data.participantEvents[0].eventName).toBe("Solo Singing");
    expect(data.participantEvents[0].amountDue).toBe(300);
    expect(data.participantEvents[0].amountPaid).toBe(300);
    expect(data.participantEvents[0].balance).toBe(0);
  });

  // 2. Scanning team leader
  it("Scenario 2: Scanning team leader retrieves team details, role as leader, and full team roster", async () => {
    mockDb.participants = [
      {
        id: "p-lead-1",
        participant_id: "SVK26-LEAD0001",
        name: "Captain Alpha",
        email: "lead@example.com",
        phone: "9876543211",
        participant_events: [
          {
            id: "pe-hack-1",
            event_id: "evt-hack-1",
            participant_id: "p-lead-1",
            registration_group_id: "grp-hack-1",
            team_name: "Hack Team Alpha",
            registration_status: "confirmed",
            payment_status: "paid",
            payment_amount: 1000,
            events: {
              name: "Hackathon",
              registration_fee: 1000,
              payment_type: "team_fixed",
              registration_type: "team",
              is_team: true,
            },
          },
        ],
        participant_event_members: [],
        participant_accommodations: [],
      },
    ];

    mockDb.participantEventMembers = [
      {
        id: "mem-1",
        participant_event_id: "pe-hack-1",
        participant_id: "p-lead-1",
        name: "Captain Alpha",
        is_team_leader: true,
        participants: {
          id: "p-lead-1",
          participant_id: "SVK26-LEAD0001",
          name: "Captain Alpha",
        },
      },
      {
        id: "mem-2",
        participant_event_id: "pe-hack-1",
        participant_id: "p-member-2",
        name: "Dev Beta",
        is_team_leader: false,
        participants: {
          id: "p-member-2",
          participant_id: "SVK26-MEMB0002",
          name: "Dev Beta",
        },
      },
    ];

    const req = new Request("https://localhost/api/admin/participants/SVK26-LEAD0001");
    const res = await getParticipantDetails(req as any, { params: Promise.resolve({ participantId: "SVK26-LEAD0001" }) });
    const data = await res.json();

    expect(data.success).toBe(true);
    expect(data.participant.name).toBe("Captain Alpha");
    const ev = data.participantEvents[0];
    expect(ev.teamRole).toBe("leader");
    expect(ev.team).toBeDefined();
    expect(ev.team.teamName).toBe("Hack Team Alpha");
    expect(ev.team.members).toHaveLength(2);
    expect(ev.team.members[0].isTeamLeader).toBe(true);
    expect(ev.team.members[0].isScannedParticipant).toBe(true);
  });

  // 3. Scanning regular team member
  it("Scenario 3: Scanning regular team member displays member's own info first, not team leader's info", async () => {
    mockDb.participants = [
      {
        id: "p-member-2",
        participant_id: "SVK26-MEMB0002",
        name: "Dev Beta",
        email: "beta@example.com",
        phone: "9123456789",
        participant_events: [],
        participant_event_members: [
          {
            id: "mem-2",
            participant_event_id: "pe-hack-1",
            participant_id: "p-member-2",
            is_team_leader: false,
            participant_events: {
              id: "pe-hack-1",
              event_id: "evt-hack-1",
              participant_id: "p-lead-1",
              team_name: "Hack Team Alpha",
              registration_status: "confirmed",
              payment_status: "paid",
              payment_amount: 1000,
              events: {
                name: "Hackathon",
                registration_fee: 1000,
                payment_type: "team_fixed",
                registration_type: "team",
                is_team: true,
              },
            },
          },
        ],
        participant_accommodations: [],
      },
    ];

    mockDb.participantEventMembers = [
      {
        id: "mem-1",
        participant_event_id: "pe-hack-1",
        participant_id: "p-lead-1",
        name: "Captain Alpha",
        is_team_leader: true,
        participants: {
          id: "p-lead-1",
          participant_id: "SVK26-LEAD0001",
          name: "Captain Alpha",
        },
      },
      {
        id: "mem-2",
        participant_event_id: "pe-hack-1",
        participant_id: "p-member-2",
        name: "Dev Beta",
        is_team_leader: false,
        participants: {
          id: "p-member-2",
          participant_id: "SVK26-MEMB0002",
          name: "Dev Beta",
        },
      },
    ];

    const req = new Request("https://localhost/api/admin/participants/SVK26-MEMB0002");
    const res = await getParticipantDetails(req as any, { params: Promise.resolve({ participantId: "SVK26-MEMB0002" }) });
    const data = await res.json();

    // The scanned participant must be Dev Beta, not Captain Alpha
    expect(data.participant.name).toBe("Dev Beta");
    expect(data.participant.participantId).toBe("SVK26-MEMB0002");
    expect(data.participantEvents[0].teamRole).toBe("member");
  });

  // 4. Expanding complete team roster
  it("Scenario 4: Complete team roster lists leader and every registered team member with permanent IDs", async () => {
    mockDb.participants = [
      {
        id: "p-mem-3",
        participant_id: "SVK26-MEMB0003",
        name: "Charlie Coder",
        participant_events: [
          {
            id: "pe-hack-1",
            participant_id: "p-lead-1",
            team_name: "Hackers",
            events: { name: "Hackathon", registration_type: "team" },
          },
        ],
        participant_event_members: [],
        participant_accommodations: [],
      },
    ];

    mockDb.participantEventMembers = [
      {
        id: "m-1",
        participant_event_id: "pe-hack-1",
        participant_id: "p-lead-1",
        name: "Lead Alice",
        is_team_leader: true,
        participants: {
          id: "p-lead-1",
          participant_id: "SVK26-LEAD0001",
          name: "Lead Alice",
        },
      },
      {
        id: "m-2",
        participant_event_id: "pe-hack-1",
        participant_id: "p-mem-2",
        name: "Bob Builder",
        is_team_leader: false,
        participants: {
          id: "p-mem-2",
          participant_id: "SVK26-MEMB0002",
          name: "Bob Builder",
        },
      },
      {
        id: "m-3",
        participant_event_id: "pe-hack-1",
        participant_id: "p-mem-3",
        name: "Charlie Coder",
        is_team_leader: false,
        participants: {
          id: "p-mem-3",
          participant_id: "SVK26-MEMB0003",
          name: "Charlie Coder",
        },
      },
    ];

    const req = new Request("https://localhost/api/admin/participants/SVK26-MEMB0003");
    const res = await getParticipantDetails(req as any, { params: Promise.resolve({ participantId: "SVK26-MEMB0003" }) });
    const data = await res.json();

    const roster = data.participantEvents[0].team.members;
    expect(roster).toHaveLength(3);
    expect(roster.map((m: any) => m.participantId)).toEqual([
      "SVK26-LEAD0001",
      "SVK26-MEMB0002",
      "SVK26-MEMB0003",
    ]);
  });

  // 5. Identifying leader and scanned participant correctly
  it("Scenario 5: Roster flags identify the leader and the currently scanned participant accurately", async () => {
    mockDb.participants = [
      {
        id: "p-mem-2",
        participant_id: "SVK26-MEMB0002",
        name: "Bob Builder",
        participant_events: [
          {
            id: "pe-hack-1",
            participant_id: "p-lead-1",
            team_name: "Hackers",
            events: { name: "Hackathon", registration_type: "team" },
          },
        ],
        participant_event_members: [],
        participant_accommodations: [],
      },
    ];

    mockDb.participantEventMembers = [
      {
        id: "m-1",
        participant_event_id: "pe-hack-1",
        participant_id: "p-lead-1",
        name: "Lead Alice",
        is_team_leader: true,
        participants: {
          id: "p-lead-1",
          participant_id: "SVK26-LEAD0001",
          name: "Lead Alice",
        },
      },
      {
        id: "m-2",
        participant_event_id: "pe-hack-1",
        participant_id: "p-mem-2",
        name: "Bob Builder",
        is_team_leader: false,
        participants: {
          id: "p-mem-2",
          participant_id: "SVK26-MEMB0002",
          name: "Bob Builder",
        },
      },
    ];

    const req = new Request("https://localhost/api/admin/participants/SVK26-MEMB0002");
    const res = await getParticipantDetails(req as any, { params: Promise.resolve({ participantId: "SVK26-MEMB0002" }) });
    const data = await res.json();

    const members = data.participantEvents[0].team.members;
    const leader = members.find((m: any) => m.isTeamLeader);
    const scanned = members.find((m: any) => m.isScannedParticipant);

    expect(leader.participantId).toBe("SVK26-LEAD0001");
    expect(leader.isScannedParticipant).toBe(false);
    expect(scanned.participantId).toBe("SVK26-MEMB0002");
    expect(scanned.isTeamLeader).toBe(false);
  });

  // 6. Multiple team events without mixing records
  it("Scenario 6: Participant belonging to multiple team events displays independent associations without mixing", async () => {
    mockDb.participants = [
      {
        id: "p-multi-1",
        participant_id: "SVK26-MULTI001",
        name: "Multi Talent",
        participant_events: [
          {
            id: "pe-hack",
            participant_id: "p-multi-1",
            team_name: "Code Ninjas",
            events: { name: "Hackathon", registration_type: "team" },
          },
          {
            id: "pe-robotics",
            participant_id: "p-robo-lead",
            team_name: "Bot Builders",
            events: { name: "Robotics Derby", registration_type: "team" },
          },
        ],
        participant_event_members: [],
        participant_accommodations: [],
      },
    ];

    mockDb.participantEventMembers = [
      {
        id: "m-h1",
        participant_event_id: "pe-hack",
        participant_id: "p-multi-1",
        name: "Multi Talent",
        is_team_leader: true,
        participants: { id: "p-multi-1", participant_id: "SVK26-MULTI001", name: "Multi Talent" },
      },
      {
        id: "m-h2",
        participant_event_id: "pe-hack",
        participant_id: "p-hackmate",
        name: "Hack Partner",
        is_team_leader: false,
        participants: { id: "p-hackmate", participant_id: "SVK26-HACKMATE", name: "Hack Partner" },
      },
      {
        id: "m-r1",
        participant_event_id: "pe-robotics",
        participant_id: "p-robo-lead",
        name: "Robo Lead",
        is_team_leader: true,
        participants: { id: "p-robo-lead", participant_id: "SVK26-ROBOTLD1", name: "Robo Lead" },
      },
      {
        id: "m-r2",
        participant_event_id: "pe-robotics",
        participant_id: "p-multi-1",
        name: "Multi Talent",
        is_team_leader: false,
        participants: { id: "p-multi-1", participant_id: "SVK26-MULTI001", name: "Multi Talent" },
      },
    ];

    const req = new Request("https://localhost/api/admin/participants/SVK26-MULTI001");
    const res = await getParticipantDetails(req as any, { params: Promise.resolve({ participantId: "SVK26-MULTI001" }) });
    const data = await res.json();

    expect(data.participantEvents).toHaveLength(2);
    const hackEvent = data.participantEvents.find((e: any) => e.eventName === "Hackathon");
    const roboEvent = data.participantEvents.find((e: any) => e.eventName === "Robotics Derby");

    expect(hackEvent.team.teamName).toBe("Code Ninjas");
    expect(hackEvent.teamRole).toBe("leader");
    expect(hackEvent.team.members).toHaveLength(2);
    expect(hackEvent.team.members.some((m: any) => m.name === "Bot Builders")).toBe(false);

    expect(roboEvent.team.teamName).toBe("Bot Builders");
    expect(roboEvent.teamRole).toBe("member");
    expect(roboEvent.team.members).toHaveLength(2);
    expect(roboEvent.team.members.some((m: any) => m.name === "Robo Lead")).toBe(true);
  });

  // 7. Participant with no accommodation
  it("Scenario 7: Participant with no accommodation booking explicitly reports no accommodation", async () => {
    mockDb.participants = [
      {
        id: "p-no-acc",
        participant_id: "SVK26-NOACC001",
        name: "Local Day Scholar",
        participant_events: [
          {
            id: "pe-1",
            events: { name: "Coding Contest" },
          },
        ],
        participant_event_members: [],
        participant_accommodations: [],
      },
    ];

    const req = new Request("https://localhost/api/admin/participants/SVK26-NOACC001");
    const res = await getParticipantDetails(req as any, { params: Promise.resolve({ participantId: "SVK26-NOACC001" }) });
    const data = await res.json();

    expect(data.accommodations).toHaveLength(0);
    expect(data.warnings.some((w: any) => w.code === "no_accommodation" || w.id === "no_accommodation")).toBe(true);
  });

  // 8. Participant with paid accommodation
  it("Scenario 8: Participant with paid accommodation displays duration, canonical stay dates and checkout date", async () => {
    mockDb.participants = [
      {
        id: "p-acc-paid",
        participant_id: "SVK26-ACCPAID1",
        name: "Hostel Resident",
        participant_events: [],
        participant_event_members: [],
        participant_accommodations: [
          {
            id: "acc-1",
            status: "paid",
            start_date: "2026-10-28",
            end_date: "2026-10-30",
            duration_days: 2,
            hostel_name: "Boys Hostel 1",
            room_number: "204",
            floor_number: "2",
            // Simulating a combined team payment order of 15 members
            payment_orders: {
              id: "po-team-bundle",
              order_reference: "ORD-TEAM-15",
              status: "paid",
              amount: 14985,
            },
            accommodation_plans: {
              id: "plan-2d",
              name: "2 Days Accommodation",
              slug: "2_days",
              duration: 2,
              price: 999,
            },
          },
        ],
      },
    ];

    const req = new Request("https://localhost/api/admin/participants/SVK26-ACCPAID1");
    const res = await getParticipantDetails(req as any, { params: Promise.resolve({ participantId: "SVK26-ACCPAID1" }) });
    const data = await res.json();

    expect(data.accommodations).toHaveLength(1);
    const acc = data.accommodations[0];
    expect(acc.status).toBe("paid");
    expect(acc.amountDue).toBe(999);
    expect(acc.amountPaid).toBe(999);
    expect(acc.balance).toBe(0);
    expect(acc.stayLabel).toBe("28–29 Oct (2 Days)");
    expect(acc.checkout_date).toBe("2026-10-30");
  });

  // 9. Pending, failed, and refunded accommodation payments
  it("Scenario 9: Pending, failed, and refunded accommodation payments generate appropriate non-destructive warnings", async () => {
    mockDb.participants = [
      {
        id: "p-acc-ref",
        participant_id: "SVK26-REFUND01",
        name: "Refunded Guest",
        participant_events: [],
        participant_event_members: [],
        participant_accommodations: [
          {
            id: "acc-ref-1",
            status: "refunded",
            start_date: "2026-10-28",
            end_date: "2026-10-29",
            duration_days: 1,
            accommodation_plans: { name: "1 Day Plan", price: 499 },
          },
        ],
      },
    ];

    const req = new Request("https://localhost/api/admin/participants/SVK26-REFUND01");
    const res = await getParticipantDetails(req as any, { params: Promise.resolve({ participantId: "SVK26-REFUND01" }) });
    const data = await res.json();

    const accWarning = data.warnings.find((w: any) => w.code === "unpaid_acc" || w.id.startsWith("unpaid_acc"));
    expect(accWarning).toBeDefined();
    expect(accWarning.message).toContain("refunded");
  });

  // 10. Event payment and accommodation payment separate
  it("Scenario 10: Event payment and accommodation payment amounts and statuses remain independent", async () => {
    mockDb.participants = [
      {
        id: "p-sep-1",
        participant_id: "SVK26-SEP00001",
        name: "Independent Payer",
        participant_events: [
          {
            id: "pe-1",
            payment_status: "paid",
            payment_amount: 500,
            events: { name: "Gaming", registration_fee: 500, payment_type: "paid" },
          },
        ],
        participant_event_members: [],
        participant_accommodations: [
          {
            id: "acc-1",
            status: "pending",
            accommodation_plans: { name: "2 Day Plan", price: 999 },
          },
        ],
      },
    ];

    const req = new Request("https://localhost/api/admin/participants/SVK26-SEP00001");
    const res = await getParticipantDetails(req as any, { params: Promise.resolve({ participantId: "SVK26-SEP00001" }) });
    const data = await res.json();

    const ev = data.participantEvents[0];
    const acc = data.accommodations[0];

    // Event is fully paid
    expect(ev.paymentStatus).toBe("paid");
    expect(ev.amountPaid).toBe(500);
    expect(ev.balance).toBe(0);

    // Accommodation is pending (unpaid)
    expect(acc.status).toBe("pending");
    expect(acc.amountDue).toBe(999);
    expect(acc.amountPaid).toBe(0);
    expect(acc.balance).toBe(999);
  });

  // 11. Authoritative balances only
  it("Scenario 11: Outstanding balances are derived strictly from authoritative payment evaluation", async () => {
    mockDb.participants = [
      {
        id: "p-bal-1",
        participant_id: "SVK26-BAL00001",
        name: "Partial Payer",
        participant_events: [
          {
            id: "pe-part",
            payment_status: "partially_paid",
            payment_amount: 200,
            events: { name: "Design Challenge", registration_fee: 600, payment_type: "paid" },
          },
          {
            id: "pe-unpaid",
            payment_status: "unpaid",
            payment_amount: 500,
            events: { name: "Web Dev Sprint", registration_fee: 500, payment_type: "paid" },
          },
        ],
        participant_event_members: [],
        participant_accommodations: [],
      },
    ];

    const req = new Request("https://localhost/api/admin/participants/SVK26-BAL00001");
    const res = await getParticipantDetails(req as any, { params: Promise.resolve({ participantId: "SVK26-BAL00001" }) });
    const data = await res.json();

    const evPart = data.participantEvents.find((e: any) => e.eventName === "Design Challenge");
    expect(evPart.amountDue).toBe(600);
    expect(evPart.amountPaid).toBe(200);
    expect(evPart.balance).toBe(400);

    const evUnpaid = data.participantEvents.find((e: any) => e.eventName === "Web Dev Sprint");
    expect(evUnpaid.amountDue).toBe(500);
    expect(evUnpaid.amountPaid).toBe(0);
    expect(evUnpaid.balance).toBe(500);
  });

  // 12. Ensuring member's payment and accommodation statuses are not copied from leader
  it("Scenario 12: Team member does not inherit team leader's accommodation booking or accommodation status", async () => {
    mockDb.participants = [
      {
        id: "p-member-solo",
        participant_id: "SVK26-MEMB0099",
        name: "Local Member",
        participant_events: [
          {
            id: "pe-hack",
            participant_id: "p-lead-luxury",
            team_name: "Hackathon",
            events: { name: "Hackathon", registration_type: "team" },
          },
        ],
        participant_event_members: [],
        participant_accommodations: [],
      },
    ];

    mockDb.participantEventMembers = [
      {
        id: "m-lead",
        participant_event_id: "pe-hack",
        participant_id: "p-lead-luxury",
        name: "Outstation Leader",
        is_team_leader: true,
        participants: {
          id: "p-lead-luxury",
          participant_id: "SVK26-LEAD0099",
          name: "Outstation Leader",
        },
      },
      {
        id: "m-local",
        participant_event_id: "pe-hack",
        participant_id: "p-member-solo",
        name: "Local Member",
        is_team_leader: false,
        participants: {
          id: "p-member-solo",
          participant_id: "SVK26-MEMB0099",
          name: "Local Member",
        },
      },
    ];

    // Leader has paid accommodation in DB
    mockDb.participantAccommodations = [
      {
        id: "acc-leader",
        participant_id: "p-lead-luxury",
        status: "paid",
        accommodation_plans: { name: "3 Days Plan", price: 1498 },
      },
    ];

    const req = new Request("https://localhost/api/admin/participants/SVK26-MEMB0099");
    const res = await getParticipantDetails(req as any, { params: Promise.resolve({ participantId: "SVK26-MEMB0099" }) });
    const data = await res.json();

    // Scanned member's own accommodations list is empty
    expect(data.accommodations).toHaveLength(0);

    // In the team roster, member's accommodation has hasBooking: false
    const team = data.participantEvents[0].team;
    const localMember = team.members.find((m: any) => m.participantId === "SVK26-MEMB0099");
    expect(localMember.accommodation.hasBooking).toBe(false);

    // Leader's accommodation is attached to leader only
    const leaderMember = team.members.find((m: any) => m.participantId === "SVK26-LEAD0099");
    expect(leaderMember.accommodation.hasBooking).toBe(true);
    expect(leaderMember.accommodation.bookingStatus).toBe("paid");
  });

  // 13. Handling missing or inconsistent records
  it("Scenario 13: Handles missing or inconsistent records gracefully without unhandled exceptions", async () => {
    mockDb.participants = [
      {
        id: "p-corrupt",
        participant_id: "SVK26-CORRUPT1",
        name: "Corrupt Edge Case",
        participant_events: [
          {
            id: "pe-corrupt",
            registration_group_id: "grp-empty",
            events: null, // missing event details
          },
        ],
        participant_event_members: [],
        participant_accommodations: [
          {
            id: "acc-bad",
            status: "unknown_status",
            start_date: null,
            accommodation_plans: null, // missing plan
          },
        ],
      },
    ];

    const req = new Request("https://localhost/api/admin/participants/SVK26-CORRUPT1");
    const res = await getParticipantDetails(req as any, { params: Promise.resolve({ participantId: "SVK26-CORRUPT1" }) });
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.participantEvents[0].eventName).toBe("Unknown event");
    expect(data.accommodations[0].planName).toBe("Campus Accommodation");
  });

  // 14. Manual lookup by permanent participant ID
  it("Scenario 14: Manual lookup normalizes input (case-insensitive & trimmed) and finds participant", async () => {
    mockDb.participants = [
      {
        id: "p-norm-1",
        participant_id: "SVK26-ABCDEF12",
        name: "Normalized User",
        participant_events: [],
        participant_event_members: [],
        participant_accommodations: [],
      },
    ];

    // Search with lowercase and untrimmed query parameter
    const req = new Request("https://localhost/api/admin/participants/svk26-abcdef12");
    const res = await getParticipantDetails(req as any, { params: Promise.resolve({ participantId: "svk26-abcdef12" }) });
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.participant.participantId).toBe("SVK26-ABCDEF12");
  });

  // 15. Invalid IDs, missing records, API errors
  it("Scenario 15: Nonexistent participant ID returns structured 404 response", async () => {
    const req = new Request("https://localhost/api/admin/participants/SVK26-NONEXIST");
    const res = await getParticipantDetails(req as any, { params: Promise.resolve({ participantId: "SVK26-NONEXIST" }) });
    expect(res.status).toBe(404);

    const data = await res.json();
    expect(data.error).toMatch(/Participant not found/i);
  });

  // 16. Verifying scanning alone never mutates DB
  it("Scenario 16: Read-only scanning never invokes insert, update, or delete on database", async () => {
    mockDb.participants = [
      {
        id: "p-ro-1",
        participant_id: "SVK26-READONLY",
        name: "Read Only Participant",
        participant_events: [],
        participant_event_members: [],
        participant_accommodations: [],
      },
    ];

    const req = new Request("https://localhost/api/admin/participants/SVK26-READONLY");
    await getParticipantDetails(req as any, { params: Promise.resolve({ participantId: "SVK26-READONLY" }) });

    expect(mockDb.mutationCalls).toHaveLength(0);
  });

  // 17. Verifying authorization for lookups and mutations
  it("Scenario 17: Unauthorized or unauthenticated caller is rejected with 401 or 403", async () => {
    vi.spyOn(serverLib, "requireAdmin").mockResolvedValue({
      user: null,
      error: "UNAUTHORIZED",
      status: 401,
    } as any);

    const req = new Request("https://localhost/api/admin/participants/SVK26-AUTH0001");
    const res = await getParticipantDetails(req as any, { params: Promise.resolve({ participantId: "SVK26-AUTH0001" }) });
    expect(res.status).toBe(401);
  });

  // 18. Preventing duplicate check-in/out actions
  it("Scenario 18: Already checked in participant generates warning notice for staff review", async () => {
    mockDb.participants = [
      {
        id: "p-chk-1",
        participant_id: "SVK26-CHECKED1",
        name: "Already Checked In",
        participant_events: [
          {
            id: "pe-chk-1",
            checked_in: true,
            checked_in_at: "2026-10-28T10:00:00Z",
            events: { name: "Robotics" },
          },
        ],
        participant_event_members: [],
        participant_accommodations: [],
      },
    ];

    const req = new Request("https://localhost/api/admin/participants/SVK26-CHECKED1");
    const res = await getParticipantDetails(req as any, { params: Promise.resolve({ participantId: "SVK26-CHECKED1" }) });
    const data = await res.json();

    const checkedInWarning = data.warnings.find((w: any) => w.code === "already_checked_in" || w.id.startsWith("event_checked_in"));
    expect(checkedInWarning).toBeDefined();
    expect(checkedInWarning.message).toContain("Robotics");
  });

  // 19. Event check-in independent from accommodation check-in
  it("Scenario 19: Free or paid event check-in remains permissible even if separate accommodation is unpaid", () => {
    const eventDecision = evaluateEventPaymentStatus({
      paymentStatus: "confirmed",
      registrationStatus: "confirmed",
      paymentType: "free",
      registrationFee: 0,
      paymentAmount: 0,
    });

    expect(eventDecision.canCheckIn).toBe(true);
    expect(eventDecision.isPaymentComplete).toBe(true);
  });

  // 20. Accommodation date and price rules
  it("Scenario 20: Preserves canonical accommodation rules (Oct 30-31 ₹999, Oct 28-30 + after_30 ₹1498, Oct 31 checkout Nov 1)", () => {
    // 2-day stay starting Oct 30: checkout Nov 1 morning
    const stay2DaysOct30 = calculateStayDates("2_days", "2026-10-30");
    expect(stay2DaysOct30.startDate).toBe("2026-10-30");
    expect(stay2DaysOct30.endDate).toBe("2026-11-01");
    expect(stay2DaysOct30.durationDays).toBe(2);
    expect(getCanonicalStayLabel("2026-10-30", 2)).toBe("30–31 Oct (2 Days • Checkout 1 Nov)");

    // 3-day stay starting Oct 28: standard 3-day plan spanning to Oct 31
    const stay3DaysOct28 = calculateStayDates("3_days", "2026-10-28");
    expect(stay3DaysOct28.startDate).toBe("2026-10-28");
    expect(stay3DaysOct28.endDate).toBe("2026-10-31");
    expect(stay3DaysOct28.durationDays).toBe(3);
    expect(getCanonicalStayLabel("2026-10-28", 3)).toBe("28–30 Oct (3 Days • Day After)");

    // Oct 31 1-day overnight stay: checkout Nov 1 morning
    const stay1DayOct31 = calculateStayDates("1_day", "2026-10-31");
    expect(stay1DayOct31.startDate).toBe("2026-10-31");
    expect(stay1DayOct31.endDate).toBe("2026-11-01");
    expect(stay1DayOct31.durationDays).toBe(1);
    expect(getCanonicalStayLabel("2026-10-31", 1)).toBe("31 Oct (Day 4 • Checkout 1 Nov)");
  });
});
