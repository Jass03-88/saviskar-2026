import { describe, it, expect } from "vitest";
import {
  calculateTeamPaymentSummary,
  getAuthoritativeStayStatus,
  type RegistrationLike,
} from "@/lib/admin/team-payment-summary";

describe("Team Payment and Accommodation Summary Accounting Rules", () => {
  it("Scenario 1: Team of 15 members with 15 verified ₹999 accommodation payments shows ₹14,985 paid", () => {
    const members = Array.from({ length: 14 }).map((_, i) => ({
      id: `member-${i + 1}`,
      participant_id: `pid-${i + 1}`,
      name: `Member ${i + 1}`,
      accommodation: {
        id: `acc-m-${i + 1}`,
        amount: 999,
        status: "paid",
      },
    }));

    const reg: RegistrationLike = {
      participant: {
        id: "leader-1",
        name: "Leader",
        accommodation: {
          id: "acc-leader",
          amount: 999,
          status: "paid",
        },
      },
      registration: {
        id: "pe-1",
        payment_status: "paid",
        payment_amount: 3500,
      },
      event: {
        name: "Nritya-e-bharat",
        payment_type: "paid",
        registration_fee: 3500,
      },
      members,
    };

    const summary = calculateTeamPaymentSummary(reg);

    expect(summary.totalTeamMembers).toBe(15);
    expect(summary.membersWithStayCount).toBe(15);
    expect(summary.membersPaidStayCount).toBe(15);
    expect(summary.membersPendingStayCount).toBe(0);
    expect(summary.membersNoStayCount).toBe(0);
    expect(summary.totalStayPaidAmount).toBe(14985);
    expect(summary.totalStayPendingAmount).toBe(0);
    expect(summary.stayBadgeVariant).toBe("paid");
    expect(summary.stayBadgeText).toContain("₹14,985 PAID · 15 members");
    expect(summary.hasAnyPendingPayment).toBe(false);
  });

  it("Scenario 2: Team has only 5 paid ₹999 stays, 1 valid unpaid ₹999 stay, and 9 members without stay", () => {
    // Leader: paid stay (1 paid)
    // 4 members: paid stay (4 paid) -> total 5 paid
    // 1 member: pending stay (1 pending) -> total 1 pending
    // 9 members: no stay -> total 9 no stay
    // Total team = 1 + 4 + 1 + 9 = 15 members
    const members = [
      ...Array.from({ length: 4 }).map((_, i) => ({
        id: `paid-m-${i + 1}`,
        participant_id: `paid-pid-${i + 1}`,
        name: `Paid Member ${i + 1}`,
        accommodation: { id: `acc-p-${i + 1}`, amount: 999, status: "paid" },
      })),
      {
        id: "pending-m-1",
        participant_id: "pending-pid-1",
        name: "Pending Member 1",
        accommodation: { id: "acc-pending-1", amount: 999, status: "pending" },
      },
      ...Array.from({ length: 9 }).map((_, i) => ({
        id: `nostay-m-${i + 1}`,
        participant_id: `nostay-pid-${i + 1}`,
        name: `No Stay Member ${i + 1}`,
        accommodation: null,
      })),
    ];

    const reg: RegistrationLike = {
      participant: {
        id: "leader-1",
        name: "Leader",
        accommodation: { id: "acc-leader", amount: 999, status: "paid" },
      },
      registration: {
        id: "pe-1",
        payment_status: "paid",
        payment_amount: 3500,
      },
      event: {
        name: "Nritya-e-bharat",
        payment_type: "paid",
        registration_fee: 3500,
      },
      members,
    };

    const summary = calculateTeamPaymentSummary(reg);

    expect(summary.totalTeamMembers).toBe(15);
    expect(summary.membersWithStayCount).toBe(6);
    expect(summary.membersPaidStayCount).toBe(5);
    expect(summary.membersPendingStayCount).toBe(1);
    expect(summary.membersNoStayCount).toBe(9);
    expect(summary.totalStayPaidAmount).toBe(4995);
    expect(summary.totalStayPendingAmount).toBe(999);
    expect(summary.stayBadgeVariant).toBe("partial");
    expect(summary.stayBadgeText).toContain("₹4,995");
    expect(summary.stayBadgeText).toContain("5 paid, 1 pending");
    expect(summary.stayBreakdownText).toContain("9 members have no stay selected");
    // Should flag as having pending payment because 1 member's stay is pending
    expect(summary.hasAnyPendingPayment).toBe(true);
  });

  it("Scenario 3: Team has no active accommodation selections", () => {
    const reg: RegistrationLike = {
      participant: {
        id: "leader-1",
        name: "Leader",
        accommodation: null,
      },
      registration: {
        id: "pe-1",
        payment_status: "paid",
        payment_amount: 1500,
      },
      event: {
        name: "Code Craze",
        payment_type: "paid",
        registration_fee: 1500,
      },
      members: [
        { id: "m-1", name: "Member 1", accommodation: null },
        { id: "m-2", name: "Member 2", accommodation: null },
      ],
    };

    const summary = calculateTeamPaymentSummary(reg);

    expect(summary.totalTeamMembers).toBe(3);
    expect(summary.membersWithStayCount).toBe(0);
    expect(summary.membersPaidStayCount).toBe(0);
    expect(summary.membersPendingStayCount).toBe(0);
    expect(summary.membersNoStayCount).toBe(3);
    expect(summary.hasAnyStay).toBe(false);
    expect(summary.stayBadgeText).toBeNull();
    expect(summary.hasAnyPendingPayment).toBe(false);
  });

  it("Scenario 4: An accommodation payment is paid but room allocation is pending", () => {
    const reg: RegistrationLike = {
      participant: {
        id: "p-1",
        name: "Solo Participant",
        accommodation: {
          id: "acc-1",
          amount: 999,
          status: "paid",
          room_number: null, // Room not allocated yet
          hostel_name: null,
        },
      },
      registration: {
        id: "pe-1",
        payment_status: "paid",
        payment_amount: 0,
      },
      event: { name: "Free Event", payment_type: "free" },
    };

    const summary = calculateTeamPaymentSummary(reg);

    expect(summary.membersPaidStayCount).toBe(1);
    expect(summary.membersPendingStayCount).toBe(0);
    expect(summary.totalStayPaidAmount).toBe(999);
    expect(summary.stayBadgeVariant).toBe("paid");
    expect(summary.hasAnyPendingPayment).toBe(false); // Room allocation pending != payment pending
    expect(summary.membersBreakdown[0].roomAllocated).toBe(false);
    expect(summary.membersBreakdown[0].stayStatus).toBe("paid");
  });

  it("Scenario 5: Non-hardcoded rates: One member has ₹499 stay and another has ₹999 stay", () => {
    const reg: RegistrationLike = {
      participant: {
        id: "leader-1",
        name: "Leader",
        accommodation: { id: "acc-1", amount: 499, status: "paid" },
      },
      registration: { id: "pe-1", payment_status: "paid" },
      members: [
        {
          id: "m-1",
          name: "Member 1",
          accommodation: { id: "acc-2", amount: 999, status: "paid" },
        },
      ],
    };

    const summary = calculateTeamPaymentSummary(reg);

    expect(summary.totalStayPaidAmount).toBe(1498); // 499 + 999
    expect(summary.membersPaidStayCount).toBe(2);
    expect(summary.stayBadgeText).toContain("₹1,498 PAID · 2 members");
  });

  it("Scenario 6 & 7: Deduplication: Team payment order with multiple line items or referenced by multiple members", () => {
    // Both leader and member reference the same payment order id covering both
    const reg: RegistrationLike = {
      participant: {
        id: "leader-1",
        name: "Leader",
        accommodation: {
          id: "acc-1",
          amount: 999,
          status: "paid",
          payment_order_id: "order-shared-1",
        },
      },
      registration: { id: "pe-1", payment_status: "paid" },
      members: [
        {
          id: "m-1",
          name: "Member 1",
          accommodation: {
            id: "acc-2",
            amount: 999,
            status: "paid",
            payment_order_id: "order-shared-1", // duplicate order reference
          },
        },
      ],
    };

    const summary = calculateTeamPaymentSummary(reg);

    // The order-shared-1 amount should be counted once to prevent double counting
    expect(summary.totalStayPaidAmount).toBe(999);
    expect(summary.membersPaidStayCount).toBe(2);
  });

  it("Scenario 8: Cancelled stay must not count as an active pending payment", () => {
    const reg: RegistrationLike = {
      participant: {
        id: "leader-1",
        name: "Leader",
        accommodation: {
          id: "acc-cancelled-1",
          amount: 999,
          status: "cancelled", // Admin-cancelled stay
        },
      },
      registration: {
        id: "pe-1",
        payment_status: "paid",
        payment_amount: 500,
      },
      event: { name: "Hackathon", payment_type: "paid" },
    };

    const summary = calculateTeamPaymentSummary(reg);

    expect(summary.membersWithStayCount).toBe(0);
    expect(summary.membersPendingStayCount).toBe(0);
    expect(summary.totalStayPendingAmount).toBe(0);
    expect(summary.hasAnyStay).toBe(false);
    expect(summary.hasAnyPendingPayment).toBe(false);
  });

  it("Scenario 9: Pending payment must not be presented as paid", () => {
    const reg: RegistrationLike = {
      participant: {
        id: "leader-1",
        name: "Leader",
        accommodation: {
          id: "acc-pending-1",
          amount: 999,
          status: "pending",
        },
      },
      registration: { id: "pe-1", payment_status: "paid" },
    };

    const summary = calculateTeamPaymentSummary(reg);

    expect(summary.membersPaidStayCount).toBe(0);
    expect(summary.membersPendingStayCount).toBe(1);
    expect(summary.totalStayPaidAmount).toBe(0);
    expect(summary.totalStayPendingAmount).toBe(999);
    expect(summary.stayBadgeVariant).toBe("pending");
    expect(summary.hasAnyPendingPayment).toBe(true);
  });

  it("Scenario 10: Event-registration payments remain separate from accommodation totals", () => {
    const reg: RegistrationLike = {
      participant: {
        id: "leader-1",
        name: "Leader",
        accommodation: {
          id: "acc-1",
          amount: 999,
          status: "pending", // accommodation pending
        },
      },
      registration: {
        id: "pe-1",
        payment_status: "paid", // event registration paid
        payment_amount: 1500,
      },
      event: {
        name: "Choreography",
        payment_type: "paid",
        registration_fee: 1500,
      },
    };

    const summary = calculateTeamPaymentSummary(reg);

    expect(summary.totalEventPaidAmount).toBe(1500);
    expect(summary.isEventPaid).toBe(true);
    expect(summary.totalStayPaidAmount).toBe(0);
    expect(summary.totalStayPendingAmount).toBe(999);
    // Combined pending filter must identify this record because stay is pending!
    expect(summary.hasAnyPendingPayment).toBe(true);
  });

  it("Authoritative stay status helper categorizes correctly", () => {
    expect(getAuthoritativeStayStatus(null)).toBe("none");
    expect(getAuthoritativeStayStatus({ status: "paid" })).toBe("paid");
    expect(getAuthoritativeStayStatus({ status: "confirmed" })).toBe("paid");
    expect(getAuthoritativeStayStatus({ status: "pending" })).toBe("pending");
    expect(getAuthoritativeStayStatus({ status: "unpaid" })).toBe("pending");
    expect(getAuthoritativeStayStatus({ status: "cancelled" })).toBe("cancelled");
    expect(getAuthoritativeStayStatus({ status: "failed" })).toBe("cancelled");
  });
});
