import { describe, it, expect } from "vitest";
import {
  calculateTeamPaymentSummary,
  type RegistrationLike,
} from "@/lib/admin/team-payment-summary";

describe("Search and Combined Pending Payment Filter Logic", () => {
  // Helper simulating the admin page filtering logic
  function filterRegistrations(
    items: RegistrationLike[],
    search: string,
    paymentFilter: "all" | "any_pending" | "paid" | "pending" | "not_required"
  ): RegistrationLike[] {
    const query = search.trim().toLowerCase();
    const queryDigits = query.replace(/\D/g, "");

    return items.filter((item) => {
      const participant = item.participant;
      const eventName = item.event?.name ?? "";

      const memberMatches = (item.members ?? []).some((m) => {
        const memPart = m.participants;
        const nameMatch = m.name?.toLowerCase().includes(query);
        const emailMatch = m.email?.toLowerCase().includes(query);
        const phoneMatch =
          m.phone?.toLowerCase().includes(query) ||
          (queryDigits.length >= 3 &&
            m.phone &&
            m.phone.replace(/\D/g, "").includes(queryDigits));
        const idMatch =
          m.participant_id?.toLowerCase().includes(query) ||
          memPart?.participant_id?.toLowerCase().includes(query);
        const colMatch =
          memPart?.college?.toLowerCase().includes(query);
        const stateMatch =
          m.state?.toLowerCase().includes(query) ||
          memPart?.state?.toLowerCase().includes(query);

        return (
          nameMatch ||
          emailMatch ||
          phoneMatch ||
          idMatch ||
          colMatch ||
          stateMatch
        );
      });

      const matchesSearch =
        !query ||
        participant.name?.toLowerCase().includes(query) ||
        participant.email?.toLowerCase().includes(query) ||
        participant.phone?.toLowerCase().includes(query) ||
        (queryDigits.length >= 3 &&
          participant.phone &&
          participant.phone.replace(/\D/g, "").includes(queryDigits)) ||
        participant.college?.toLowerCase().includes(query) ||
        participant.participant_id?.toLowerCase().includes(query) ||
        participant.id?.toLowerCase().includes(query) ||
        participant.state?.toLowerCase().includes(query) ||
        eventName.toLowerCase().includes(query) ||
        item.registration.team_name?.toLowerCase().includes(query) ||
        memberMatches;

      const matchesPayment = (() => {
        if (paymentFilter === "all") return true;
        if (paymentFilter === "any_pending") {
          const summary = calculateTeamPaymentSummary(item);
          return summary.hasAnyPendingPayment;
        }
        if (paymentFilter === "paid") {
          return item.registration.payment_status?.toLowerCase() === "paid";
        }
        if (paymentFilter === "pending") {
          return (
            item.registration.payment_status?.toLowerCase() === "pending" ||
            item.registration.payment_status?.toLowerCase() === "unpaid"
          );
        }
        if (paymentFilter === "not_required") {
          return (
            item.registration.payment_status?.toLowerCase() === "not_required" ||
            item.event?.payment_type === "free"
          );
        }
        return item.registration.payment_status?.toLowerCase() === paymentFilter;
      })();

      return matchesSearch && matchesPayment;
    });
  }

  const sampleDataset: RegistrationLike[] = [
    // 1. Antriksha Rathore: Event paid, 14 members paid stay, 2 no stay
    {
      participant: {
        id: "antriksha-uuid",
        participant_id: "SVK26-59E7A8EF",
        name: "ANTRIKSHA RATHORE",
        email: "22ibo043@smvdu.ac.in",
        phone: "+91 9651494424",
        college: "Shri Mata Vaishno Devi University",
        state: "Jammu and Kashmir",
        accommodation: null,
      },
      registration: {
        id: "pe-antriksha",
        payment_status: "paid",
        payment_amount: 3500,
        team_name: "Natraj Group",
      },
      event: {
        id: "ev-dance",
        name: "Nritya-e-bharat",
        payment_type: "paid",
        registration_fee: 3500,
      },
      members: [
        {
          id: "m-priya",
          participant_id: "SVK26-PRIYA01",
          name: "Priya Sharma",
          email: "priya@smvdu.ac.in",
          phone: "+91 9876543210",
          accommodation: { id: "acc-priya", status: "paid", amount: 999 },
          participants: {
            participant_id: "SVK26-PRIYA01",
            college: "Shri Mata Vaishno Devi University",
            state: "Jammu and Kashmir",
          },
        },
        {
          id: "m-rahul",
          participant_id: "SVK26-RAHUL02",
          name: "Rahul Verma",
          email: "rahul@smvdu.ac.in",
          phone: "9123456789",
          accommodation: null, // no stay selected
          participants: {
            participant_id: "SVK26-RAHUL02",
            college: "Shri Mata Vaishno Devi University",
            state: "Jammu and Kashmir",
          },
        },
      ],
    },

    // 2. Event paid, but team has outstanding accommodation payment
    {
      participant: {
        id: "vikram-uuid",
        participant_id: "SVK26-VIKRAM01",
        name: "Vikram Malhotra",
        email: "vikram@thapar.edu",
        phone: "9812345678",
        college: "Thapar University",
        state: "Punjab",
        accommodation: null,
      },
      registration: {
        id: "pe-vikram",
        payment_status: "paid", // Event fee is already PAID
        payment_amount: 2000,
        team_name: "Thapar Code Squad",
      },
      event: {
        id: "ev-hack",
        name: "Hackathon 2026",
        payment_type: "paid",
        registration_fee: 2000,
      },
      members: [
        {
          id: "m-simran",
          participant_id: "SVK26-SIMRAN02",
          name: "Simran Kaur",
          email: "simran@thapar.edu",
          phone: "9876501234",
          accommodation: {
            id: "acc-simran",
            status: "pending", // Accommodation payment is PENDING
            amount: 999,
          },
          participants: {
            participant_id: "SVK26-SIMRAN02",
            college: "Thapar University",
            state: "Punjab",
          },
        },
      ],
    },

    // 3. Event payment pending, no accommodation selected
    {
      participant: {
        id: "aman-uuid",
        participant_id: "SVK26-AMAN001",
        name: "Aman Gupta",
        email: "aman@cgc.edu.in",
        phone: "9988776655",
        college: "CGC University Mohali",
        state: "Punjab",
        accommodation: null,
      },
      registration: {
        id: "pe-aman",
        payment_status: "pending", // Event fee is PENDING
        payment_amount: 500,
        team_name: null,
      },
      event: {
        id: "ev-singing",
        name: "Solo Singing",
        payment_type: "paid",
        registration_fee: 500,
      },
      members: [],
    },

    // 4. Free event, no stay, fully cleared
    {
      participant: {
        id: "deepak-uuid",
        participant_id: "SVK26-DEEPAK01",
        name: "Deepak Kumar",
        email: "deepak@chitkara.edu.in",
        phone: "9876599999",
        college: "Chitkara University",
        state: "Himachal Pradesh",
        accommodation: null,
      },
      registration: {
        id: "pe-deepak",
        payment_status: "not_required",
        payment_amount: 0,
      },
      event: {
        id: "ev-quiz",
        name: "Tech Quiz",
        payment_type: "free",
        registration_fee: 0,
      },
      members: [],
    },
  ];

  it("Comprehensive Search: Finds registration by secondary team member name", () => {
    const results = filterRegistrations(sampleDataset, "Priya Sharma", "all");
    expect(results.length).toBe(1);
    expect(results[0].participant.name).toBe("ANTRIKSHA RATHORE");
  });

  it("Comprehensive Search: Finds registration by secondary team member participant ID", () => {
    const results = filterRegistrations(sampleDataset, "SVK26-SIMRAN02", "all");
    expect(results.length).toBe(1);
    expect(results[0].participant.name).toBe("Vikram Malhotra");
  });

  it("Comprehensive Search: Finds registration by phone number with formatting differences", () => {
    // Search with digits only: "9876543210" should match "+91 9876543210"
    const results = filterRegistrations(sampleDataset, "9876543210", "all");
    expect(results.length).toBe(1);
    expect(results[0].participant.name).toBe("ANTRIKSHA RATHORE");
  });

  it("Comprehensive Search: Finds registration by team name", () => {
    const results = filterRegistrations(sampleDataset, "Natraj Group", "all");
    expect(results.length).toBe(1);
    expect(results[0].participant.name).toBe("ANTRIKSHA RATHORE");
  });

  it("Comprehensive Search: Finds registration by institution/college", () => {
    const results = filterRegistrations(sampleDataset, "Thapar University", "all");
    expect(results.length).toBe(1);
    expect(results[0].participant.name).toBe("Vikram Malhotra");
  });

  it("Comprehensive Search: Finds registration by state", () => {
    const results = filterRegistrations(sampleDataset, "Himachal Pradesh", "all");
    expect(results.length).toBe(1);
    expect(results[0].participant.name).toBe("Deepak Kumar");
  });

  it("Combined Pending Payment Filter: Finds records where accommodation is pending even though event fee is paid", () => {
    // Vikram Malhotra has event fee paid, but Simran Kaur's accommodation is pending
    const results = filterRegistrations(sampleDataset, "", "any_pending");
    const matchedNames = results.map((r) => r.participant.name);

    expect(matchedNames).toContain("Vikram Malhotra"); // Stay pending
    expect(matchedNames).toContain("Aman Gupta"); // Event pending
    expect(matchedNames).not.toContain("ANTRIKSHA RATHORE"); // All paid
    expect(matchedNames).not.toContain("Deepak Kumar"); // Free, no stay
  });

  it("Payment Filter 'paid' (Event fee): Preserves existing behavior", () => {
    const results = filterRegistrations(sampleDataset, "", "paid");
    const matchedNames = results.map((r) => r.participant.name);

    expect(matchedNames).toContain("ANTRIKSHA RATHORE");
    expect(matchedNames).toContain("Vikram Malhotra"); // Event fee is paid
    expect(matchedNames).not.toContain("Aman Gupta");
  });

  it("Payment Filter 'pending' (Event fee): Preserves existing behavior", () => {
    const results = filterRegistrations(sampleDataset, "", "pending");
    const matchedNames = results.map((r) => r.participant.name);

    expect(matchedNames).toContain("Aman Gupta");
    expect(matchedNames).not.toContain("Vikram Malhotra"); // Event fee is not pending
  });
});
