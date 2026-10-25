import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from '@/app/api/admin/accommodations/dashboard/route';
import { NextRequest } from 'next/server';
import { getCanonicalStayLabel, isValidAccommodationDate, calculateStayDates } from '@/lib/accommodation-dates';

vi.mock('@/lib/supabase/server', () => ({
  requireAccommodationAdmin: vi.fn(),
}));

import { requireAccommodationAdmin } from '@/lib/supabase/server';

let mockParticipantAccommodations: any[] = [];
let mockHostels: any[] = [];
let mockFloors: any[] = [];
let mockRooms: any[] = [];
let mockPlans: any[] = [];
let mockActiveAllocations: any[] = [];

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      let data: any[] = [];
      if (table === 'hostels') data = mockHostels;
      if (table === 'hostel_floors') data = mockFloors;
      if (table === 'hostel_rooms') data = mockRooms;
      if (table === 'accommodation_plans') data = mockPlans;
      if (table === 'participant_accommodations') data = mockParticipantAccommodations;
      if (table === 'accommodation_allocations') data = mockActiveAllocations;

      let currentRange: [number, number] | null = null;
      let isEqStatus = false;

      const chain: any = {
        select: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        eq: vi.fn((col: string, val: any) => {
          if (table === 'accommodation_allocations' && col === 'status' && val === 'active') {
            isEqStatus = true;
          }
          return chain;
        }),
        range: vi.fn((start: number, end: number) => {
          currentRange = [start, end];
          return chain;
        }),
      };

      const thenable = {
        then: (resolve: any) => {
          if (table === 'participant_accommodations') {
            const start = currentRange ? currentRange[0] : 0;
            const end = currentRange ? currentRange[1] : mockParticipantAccommodations.length - 1;
            const slice = mockParticipantAccommodations.slice(start, end + 1);
            resolve({ data: slice, count: mockParticipantAccommodations.length, error: null });
          } else if (table === 'accommodation_allocations') {
            const start = currentRange ? currentRange[0] : 0;
            const end = currentRange ? currentRange[1] : mockActiveAllocations.length - 1;
            const slice = mockActiveAllocations.slice(start, end + 1);
            resolve({ data: slice, count: mockActiveAllocations.length, error: null });
          } else {
            resolve({ data, count: data.length, error: null });
          }
        }
      };

      Object.assign(chain, thenable);
      return chain;
    })
  }))
}));

describe('SAVISKAR 2026 — October 31 Accommodation & Admin Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
    process.env.SUPABASE_SECRET_KEY = 'test_secret_key';

    (requireAccommodationAdmin as any).mockResolvedValue({ status: 200, error: null, role: 'accommodation_admin' });

    mockHostels = [{ id: 'h-main', name: 'Main Campus Hostel', gender_eligibility: 'any', is_active: true }];
    mockFloors = [{ id: 'f-1', hostel_id: 'h-main', floor_number: 1, name: 'Ground Floor', is_active: true }];
    mockRooms = [{ id: 'r-101', hostel_id: 'h-main', floor_id: 'f-1', room_number: '101', capacity: 2, is_active: true }];

    mockPlans = [
      { id: 'p-1day', slug: '1_day', name: '1 Day Accommodation', duration: 1, price: 499, currency: 'INR', is_active: true },
      { id: 'p-2days', slug: '2_days', name: '2 Days Accommodation', duration: 2, price: 999, currency: 'INR', is_active: true },
      { id: 'p-3days', slug: '3_days', name: '3 Days Accommodation', duration: 3, price: 1498, currency: 'INR', is_active: true },
      { id: 'p-4days', slug: '4_days', name: '4 Days Accommodation', duration: 4, price: 1997, currency: 'INR', is_active: true },
    ];

    mockActiveAllocations = [];
  });

  it('1. Paid October 31 booking with November 1 checkout is returned and preserved by Dashboard API', async () => {
    mockParticipantAccommodations = [
      {
        id: 'acc-oct31',
        participant_id: 'part-001',
        accommodation_plan_id: 'p-1day',
        start_date: '2026-10-31',
        end_date: '2026-11-01',
        duration_days: 1,
        amount: 499,
        currency: 'INR',
        status: 'paid',
        hostel_id: null,
        room_id: null,
        checked_in: false,
        checked_in_at: null,
        checked_out: false,
        checked_out_at: null,
        created_at: '2026-10-25T01:00:00Z',
        participants: {
          participant_id: 'SVK26-TEST-31',
          name: 'Aman Deep',
          email: 'aman@test.local',
          phone: '+919876543210',
          gender: 'male',
          state: 'Punjab',
          college: 'CGC Landran',
        }
      }
    ];

    const req = new NextRequest('http://localhost:3000/api/admin/accommodations/dashboard');
    const res = await GET(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.accommodations).toHaveLength(1);

    const record = json.accommodations[0];
    expect(record.id).toBe('acc-oct31');
    expect(record.start_date).toBe('2026-10-31');
    expect(record.end_date).toBe('2026-11-01');
    expect(record.duration_days).toBe(1);
    expect(record.amount).toBe(499);
    expect(record.currency).toBe('INR');
    expect(record.status).toBe('paid');
    expect(record.participants.name).toBe('Aman Deep');
    expect(record.participants.email).toBe('aman@test.local');
    expect(record.participants.participant_id).toBe('SVK26-TEST-31');
  });

  it('2. Paid but unallocated accommodation remains visible where intended and increments awaitingAllocation', async () => {
    mockParticipantAccommodations = [
      {
        id: 'acc-unallocated',
        participant_id: 'part-002',
        accommodation_plan_id: 'p-1day',
        start_date: '2026-10-31',
        end_date: '2026-11-01',
        duration_days: 1,
        amount: 499,
        currency: 'INR',
        status: 'paid',
        hostel_id: null,
        room_id: null,
        checked_in: false,
        checked_out: false,
        participants: { name: 'Unallocated User' }
      }
    ];

    const req = new NextRequest('http://localhost:3000/api/admin/accommodations/dashboard');
    const res = await GET(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.stats.paid).toBe(1);
    expect(json.stats.awaitingAllocation).toBe(1);
    expect(json.stats.allocated).toBe(0);
    expect(json.accommodations[0].hostel_id).toBeNull();
    expect(json.accommodations[0].room_id).toBeNull();
  });

  it('3. Null hostel/room assignments do not hide valid bookings or cause join drops', async () => {
    mockParticipantAccommodations = [
      {
        id: 'acc-null-hostel',
        participant_id: 'part-003',
        accommodation_plan_id: 'p-2days',
        start_date: '2026-10-30',
        end_date: '2026-11-01',
        duration_days: 2,
        amount: 999,
        currency: 'INR',
        status: 'paid',
        hostel_id: null,
        room_id: null,
        checked_in: false,
        checked_out: false,
        participants: { name: 'Delegate 30-31' }
      }
    ];

    const req = new NextRequest('http://localhost:3000/api/admin/accommodations/dashboard');
    const res = await GET(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.accommodations).toHaveLength(1);
    expect(json.accommodations[0].start_date).toBe('2026-10-30');
    expect(json.accommodations[0].end_date).toBe('2026-11-01');
  });

  it('4. Team and accommodation-only records follow intended query behavior', async () => {
    mockParticipantAccommodations = [
      // A: Team record
      {
        id: 'acc-team',
        participant_id: 'part-team-1',
        accommodation_plan_id: 'p-3days',
        start_date: '2026-10-29',
        end_date: '2026-11-01',
        duration_days: 3,
        amount: 1498,
        currency: 'INR',
        status: 'paid',
        hostel_id: null,
        room_id: null,
        checked_in: false,
        checked_out: false,
        participants: {
          name: 'Team Member 1',
          participant_events: [],
          participant_event_members: [
            {
              id: 'pem-1',
              participant_event_id: 'pe-team-alpha',
              is_team_leader: true,
              participant_events: {
                id: 'pe-team-alpha',
                team_name: 'Alpha Coders',
                registration_group_id: 'grp-001',
                participants: { participant_id: 'SVK-LEADER', name: 'Team Member 1' }
              }
            }
          ]
        }
      },
      // B: Accommodation-only record (no events, no teams)
      {
        id: 'acc-solo',
        participant_id: 'part-solo-1',
        accommodation_plan_id: 'p-4days',
        start_date: '2026-10-28',
        end_date: '2026-11-01',
        duration_days: 4,
        amount: 1997,
        currency: 'INR',
        status: 'paid',
        hostel_id: null,
        room_id: null,
        checked_in: false,
        checked_out: false,
        participants: {
          name: 'Solo Attendee',
          participant_events: [],
          participant_event_members: [],
          faculty_incharges: []
        }
      }
    ];

    const req = new NextRequest('http://localhost:3000/api/admin/accommodations/dashboard');
    const res = await GET(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.accommodations).toHaveLength(2);

    const teamAcc = json.accommodations.find((a: any) => a.id === 'acc-team');
    expect(teamAcc.team_name).toBe('Alpha Coders');
    expect(teamAcc.is_ambiguous).toBe(false);

    const soloAcc = json.accommodations.find((a: any) => a.id === 'acc-solo');
    expect(soloAcc.team_name).toBeNull();
    expect(soloAcc.is_ambiguous).toBe(false);
  });

  it('5. Fails closed with 401/403 when user is unauthorized', async () => {
    (requireAccommodationAdmin as any).mockResolvedValueOnce({
      status: 401,
      error: 'UNAUTHORIZED',
      role: null
    });

    const req = new NextRequest('http://localhost:3000/api/admin/accommodations/dashboard');
    const res = await GET(req);
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json.error).toBe('UNAUTHORIZED');
  });

  it('6. All four stay extensions ending Oct 31 produce Nov 1 checkout and canonical stay labels', () => {
    // 1 Day: Oct 31 -> Nov 1
    const stay1 = calculateStayDates('1_day', '2026-10-31');
    expect(stay1).toEqual({ startDate: '2026-10-31', endDate: '2026-11-01', durationDays: 1 });
    expect(getCanonicalStayLabel(stay1.startDate, stay1.durationDays)).toBe('31 Oct (Day 4 • Checkout 1 Nov)');

    // 2 Days: Oct 30 -> Nov 1
    const stay2 = calculateStayDates('2_days', '2026-10-30');
    expect(stay2).toEqual({ startDate: '2026-10-30', endDate: '2026-11-01', durationDays: 2 });
    expect(getCanonicalStayLabel(stay2.startDate, stay2.durationDays)).toBe('30–31 Oct (2 Days • Checkout 1 Nov)');

    // 3 Days: Oct 29 -> Nov 1
    const stay3 = calculateStayDates('3_days', '2026-10-29');
    expect(stay3).toEqual({ startDate: '2026-10-29', endDate: '2026-11-01', durationDays: 3 });
    expect(getCanonicalStayLabel(stay3.startDate, stay3.durationDays)).toBe('29–31 Oct (3 Days • Checkout 1 Nov)');

    // 4 Days: Oct 28 -> Nov 1
    const stay4 = calculateStayDates('4_days', '2026-10-28');
    expect(stay4).toEqual({ startDate: '2026-10-28', endDate: '2026-11-01', durationDays: 4 });
    expect(getCanonicalStayLabel(stay4.startDate, stay4.durationDays)).toBe('28–31 Oct (4 Days • Checkout 1 Nov)');
  });

  it('7. Validation permits Oct 31 stays and rejects unsupported dates', () => {
    expect(isValidAccommodationDate('1_day', '2026-10-31')).toBe(true);
    expect(isValidAccommodationDate('2_days', '2026-10-30')).toBe(true);
    expect(isValidAccommodationDate('3_days', '2026-10-29')).toBe(true);
    expect(isValidAccommodationDate('4_days', '2026-10-28')).toBe(true);

    // Rejections
    expect(isValidAccommodationDate('1_day', '2026-11-01')).toBe(false);
    expect(isValidAccommodationDate('2_days', '2026-10-27')).toBe(false);
    expect(isValidAccommodationDate('3_days', '2026-10-31')).toBe(false);
    expect(isValidAccommodationDate('4_days', '2026-10-29')).toBe(false);
  });

  it('8. Existing bookings and previously supported dates continue to behave correctly', () => {
    // 1 Day on 27, 28, 29, 30
    for (const d of ['2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30']) {
      expect(isValidAccommodationDate('1_day', d)).toBe(true);
    }
    // 2 Days on 28
    const stay28 = calculateStayDates('2_days', '2026-10-28');
    expect(stay28).toEqual({ startDate: '2026-10-28', endDate: '2026-10-30', durationDays: 2 });
    expect(getCanonicalStayLabel(stay28.startDate, stay28.durationDays)).toBe('28–29 Oct (2 Days)');

    // 3 Days on 27
    const stay27 = calculateStayDates('3_days', '2026-10-27');
    expect(stay27).toEqual({ startDate: '2026-10-27', endDate: '2026-10-30', durationDays: 3 });
    expect(getCanonicalStayLabel(stay27.startDate, stay27.durationDays)).toBe('27–29 Oct (3 Days • Day Before)');

    // 4 Days on 27
    const stayFull = calculateStayDates('4_days', '2026-10-27');
    expect(stayFull).toEqual({ startDate: '2026-10-27', endDate: '2026-10-31', durationDays: 4 });
    expect(getCanonicalStayLabel(stayFull.startDate, stayFull.durationDays)).toBe('27–30 Oct (4 Days • Full Stay)');
  });
});
