import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from '@/app/api/admin/accommodations/dashboard/route';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/server', () => ({
  requireAccommodationAdmin: vi.fn().mockResolvedValue({ status: 200, error: null }),
}));

// Configurable mock state
let mockParticipantAccommodations: any[] = [];
let mockBatchErrorOnRange: { start: number; end: number; error: any } | null = null;
let mockActiveAllocations: any[] = [{ hostel_id: 'h1', room_id: 'r1' }];
let mockAllocationsErrorOnRange: { start: number; end: number; error: any } | null = null;
let recordedRanges: { table: string; start: number; end: number }[] = [];

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      let data: any[] = [];
      const count = 0;
      if (table === 'hostels') data = [{ id: 'h1', name: 'H1', is_active: true }];
      if (table === 'hostel_floors') data = [{ id: 'f1', hostel_id: 'h1', is_active: true }];
      if (table === 'hostel_rooms') data = [
        { id: 'r1', hostel_id: 'h1', floor_id: 'f1', capacity: 2, is_active: true },
        { id: 'r2', hostel_id: 'h1', floor_id: 'f1', capacity: 1, is_active: false }
      ];
      if (table === 'accommodation_plans') data = [{ id: 'p1', name: 'Plan 1', price: 100 }];

      let currentRange: [number, number] | null = null;

      const chain = {
        select: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        range: vi.fn((start: number, end: number) => {
          currentRange = [start, end];
          recordedRanges.push({ table, start, end });
          return chain;
        }),
        eq: vi.fn().mockReturnThis(),
      };

      const thenable = {
        then: (resolve: any) => {
          if (table === 'participant_accommodations') {
            const start = currentRange ? currentRange[0] : 0;
            const end = currentRange ? currentRange[1] : mockParticipantAccommodations.length - 1;

            if (mockBatchErrorOnRange && start === mockBatchErrorOnRange.start) {
              resolve({ data: null, count: mockParticipantAccommodations.length, error: mockBatchErrorOnRange.error });
              return;
            }

            const slice = mockParticipantAccommodations.slice(start, end + 1);
            resolve({ data: slice, count: mockParticipantAccommodations.length, error: null });
          } else if (table === 'accommodation_allocations') {
            const start = currentRange ? currentRange[0] : 0;
            const end = currentRange ? currentRange[1] : mockActiveAllocations.length - 1;

            if (mockAllocationsErrorOnRange && start === mockAllocationsErrorOnRange.start) {
              resolve({ data: null, count: mockActiveAllocations.length, error: mockAllocationsErrorOnRange.error });
              return;
            }

            const slice = mockActiveAllocations.slice(start, end + 1);
            resolve({ data: slice, count: mockActiveAllocations.length, error: null });
          } else {
            resolve({ data, count, error: null });
          }
        }
      };
      Object.assign(chain, thenable);
      return chain;
    })
  }))
}));

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
  process.env.SUPABASE_SECRET_KEY = 'test_secret_key';
  mockBatchErrorOnRange = null;
  mockAllocationsErrorOnRange = null;
  recordedRanges = [];

  // Default baseline data (4 records)
  mockParticipantAccommodations = [
    { id: 'a1', status: 'paid', room_id: 'r1', checked_in: true, checked_out: false },
    { id: 'a2', status: 'paid', room_id: null, checked_in: false, checked_out: false },
    { id: 'a3', status: 'pending', room_id: null, checked_in: false, checked_out: false },
    { id: 'a4', status: 'cancelled', room_id: null, checked_in: false, checked_out: false },
  ];
  mockActiveAllocations = [{ hostel_id: 'h1', room_id: 'r1' }];
});

describe('Accommodation Dashboard API & Bounded Batch Fetching (Step 9.2 & 9.3)', () => {
  it('should compute comprehensive stats for baseline data', async () => {
    const req = new NextRequest('http://localhost:3000/api/admin/accommodations/dashboard');
    const res = await GET(req);
    const json = await res.json();
    if (res.status !== 200) console.error("TEST FAILED WITH:", json);

    expect(res.status).toBe(200);
    expect(json.stats.totalCapacity).toBe(2);
    expect(json.stats.occupiedCapacity).toBe(1);
    expect(json.stats.allocated).toBe(1);
    expect(json.stats.awaitingAllocation).toBe(1);
    expect(json.stats.total).toBe(3);
    expect(json.stats.paid).toBe(2);
    expect(json.stats.pending).toBe(1);
    expect(json.stats.cancelled).toBe(1);
    expect(json.stats.checkedIn).toBe(1);
  });

  it('1. More than 1,000 accommodation records are fetched in consecutive batches', async () => {
    mockParticipantAccommodations = Array.from({ length: 1250 }, (_, i) => ({
      id: `acc-${i}`,
      status: 'paid',
      room_id: null,
      checked_in: false,
      checked_out: false,
      participants: { name: `Participant ${i}`, participant_id: `SVK-${i}` }
    }));

    const req = new NextRequest('http://localhost:3000/api/admin/accommodations/dashboard');
    const res = await GET(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.accommodations).toHaveLength(1250);
    expect(json.totalCount).toBe(1250);

    const accRanges = recordedRanges.filter(r => r.table === 'participant_accommodations').slice(0, 2);
    expect(accRanges).toEqual([
      { table: 'participant_accommodations', start: 0, end: 999 },
      { table: 'participant_accommodations', start: 1000, end: 1249 },
    ]);
  });

  it('2. Exactly 1,000 records do not cause an unnecessary extra batch', async () => {
    mockParticipantAccommodations = Array.from({ length: 1000 }, (_, i) => ({
      id: `acc-exact-${i}`,
      status: 'paid',
      room_id: null,
      participants: { name: `Exact ${i}`, participant_id: `SVK-${i}` }
    }));

    const req = new NextRequest('http://localhost:3000/api/admin/accommodations/dashboard');
    const res = await GET(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.accommodations).toHaveLength(1000);

    const accRanges = recordedRanges.filter(r => r.table === 'participant_accommodations');
    expect(accRanges[0]).toEqual({ table: 'participant_accommodations', start: 0, end: 999 });
    expect(accRanges[1]).toEqual({ table: 'participant_accommodations', start: 0, end: 999 });
    expect(accRanges).toHaveLength(2);
  });

  it('3. The final partial batch is handled correctly (1,250 records)', async () => {
    mockParticipantAccommodations = Array.from({ length: 1250 }, (_, i) => ({
      id: `acc-partial-${i}`,
      status: 'paid',
      room_id: null,
      participants: { name: `Partial ${i}` }
    }));

    const req = new NextRequest('http://localhost:3000/api/admin/accommodations/dashboard');
    const res = await GET(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.accommodations).toHaveLength(1250);
    expect(json.accommodations[1249].id).toBe('acc-partial-1249');
  });

  it('4. A database count exceeding 5,000 can be fetched safely in multiple batches', async () => {
    mockParticipantAccommodations = Array.from({ length: 5500 }, (_, i) => ({
      id: `acc-5k-${i}`,
      status: 'paid',
      room_id: null,
      participants: { name: `Large ${i}` }
    }));

    const req = new NextRequest('http://localhost:3000/api/admin/accommodations/dashboard');
    const res = await GET(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.accommodations).toHaveLength(5500);

    const accRanges = recordedRanges.filter(r => r.table === 'participant_accommodations').slice(0, 6);
    expect(accRanges).toEqual([
      { table: 'participant_accommodations', start: 0, end: 999 },
      { table: 'participant_accommodations', start: 1000, end: 1999 },
      { table: 'participant_accommodations', start: 2000, end: 2999 },
      { table: 'participant_accommodations', start: 3000, end: 3999 },
      { table: 'participant_accommodations', start: 4000, end: 4999 },
      { table: 'participant_accommodations', start: 5000, end: 5499 },
    ]);
  });

  it('5. Batch errors are surfaced and incomplete data is never returned as a successful complete result', async () => {
    mockParticipantAccommodations = Array.from({ length: 1500 }, (_, i) => ({
      id: `acc-err-${i}`,
      status: 'paid',
      room_id: null,
    }));

    mockBatchErrorOnRange = {
      start: 1000,
      end: 1499,
      error: { message: "Database connection timeout during batch 2" }
    };

    const req = new NextRequest('http://localhost:3000/api/admin/accommodations/dashboard');
    const res = await GET(req);
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toMatch(/Database connection timeout during batch 2/i);
    expect(json.accommodations).toBeUndefined();
  });

  it('6. Record IDs are neither duplicated nor omitted across batch boundaries', async () => {
    mockParticipantAccommodations = Array.from({ length: 1250 }, (_, i) => ({
      id: `acc-bound-${i}`,
      status: 'paid',
      room_id: null,
      participants: { name: `Bound ${i}`, participant_id: `SVK-${i}` }
    }));

    const req = new NextRequest('http://localhost:3000/api/admin/accommodations/dashboard');
    const res = await GET(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    const ids = json.accommodations.map((a: any) => a.id);
    expect(ids).toHaveLength(1250);
    expect(new Set(ids).size).toBe(1250);
    expect(ids[999]).toBe('acc-bound-999');
    expect(ids[1000]).toBe('acc-bound-1000');
  });

  it('8. statusStats totals include all records within the supported resource limit', async () => {
    mockParticipantAccommodations = Array.from({ length: 1200 }, (_, i) => ({
      id: `acc-stats-${i}`,
      status: i < 700 ? 'paid' : 'pending',
      room_id: null,
      checked_in: false,
      checked_out: false,
    }));

    const req = new NextRequest('http://localhost:3000/api/admin/accommodations/dashboard');
    const res = await GET(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.stats.total).toBe(1200);
    expect(json.stats.paid).toBe(700);
    expect(json.stats.pending).toBe(500);
  });

  // STEP 9.3: OCCUPANCY QUERY TESTS
  it('9. calculates room, floor, hostel and occupiedCapacity correctly for active allocations below 1,000', async () => {
    // 150 active allocations all in room r1, floor f1, hostel h1
    mockActiveAllocations = Array.from({ length: 150 }, () => ({
      hostel_id: 'h1',
      room_id: 'r1',
    }));

    const req = new NextRequest('http://localhost:3000/api/admin/accommodations/dashboard');
    const res = await GET(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.stats.occupiedCapacity).toBe(150);
    expect(json.roomOccupancy['r1']).toBe(150);
    expect(json.floorOccupancy['f1']).toBe(150);
    expect(json.hostelOccupancy['h1']).toBe(150);

    // Verify exactly 1 batch was queried for allocations
    const allocRanges = recordedRanges.filter(r => r.table === 'accommodation_allocations');
    expect(allocRanges).toHaveLength(1);
    expect(allocRanges[0]).toEqual({ table: 'accommodation_allocations', start: 0, end: 999 });
  });

  it('10. fetches active allocations exceeding 1,000 in consecutive batches with a final partial batch and accurate totals', async () => {
    // 1,250 active allocations: 800 in room r1, 450 in room r2 (both in hostel h1)
    mockActiveAllocations = [
      ...Array.from({ length: 800 }, () => ({ hostel_id: 'h1', room_id: 'r1' })),
      ...Array.from({ length: 450 }, () => ({ hostel_id: 'h1', room_id: 'r2' })),
    ];

    const req = new NextRequest('http://localhost:3000/api/admin/accommodations/dashboard');
    const res = await GET(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.stats.occupiedCapacity).toBe(1250);
    expect(json.roomOccupancy['r1']).toBe(800);
    expect(json.roomOccupancy['r2']).toBe(450);
    expect(json.floorOccupancy['f1']).toBe(1250); // both r1 and r2 are on floor f1 in mock
    expect(json.hostelOccupancy['h1']).toBe(1250);

    // Verify 2 consecutive batches for allocations
    const allocRanges = recordedRanges.filter(r => r.table === 'accommodation_allocations');
    expect(allocRanges).toHaveLength(2);
    expect(allocRanges).toEqual([
      { table: 'accommodation_allocations', start: 0, end: 999 },
      { table: 'accommodation_allocations', start: 1000, end: 1249 },
    ]);
  });

  it('11. surfaces allocation batch-fetch errors and returns HTTP 500 without reporting partial occupancy', async () => {
    mockActiveAllocations = Array.from({ length: 1500 }, () => ({ hostel_id: 'h1', room_id: 'r1' }));
    mockAllocationsErrorOnRange = {
      start: 1000,
      end: 1499,
      error: { message: "Database connection failed reading allocations batch 2" },
    };

    const req = new NextRequest('http://localhost:3000/api/admin/accommodations/dashboard');
    const res = await GET(req);
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toMatch(/Database connection failed reading allocations batch 2/i);
    expect(json.roomOccupancy).toBeUndefined();
  });
});
