import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from '@/app/api/admin/accommodations/dashboard/route';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/server', () => ({
  requireAccommodationAdmin: vi.fn().mockResolvedValue({ status: 200, error: null }),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: vi.fn((table) => {
      let data: any[] = [];
      let count = 0;
      if (table === 'hostels') data = [{ id: 'h1', name: 'H1', is_active: true }];
      if (table === 'hostel_floors') data = [{ id: 'f1', hostel_id: 'h1', is_active: true }];
      if (table === 'hostel_rooms') data = [
        { id: 'r1', hostel_id: 'h1', floor_id: 'f1', capacity: 2, is_active: true },
        { id: 'r2', hostel_id: 'h1', floor_id: 'f1', capacity: 1, is_active: false }
      ];
      if (table === 'accommodation_plans') data = [{ id: 'p1', name: 'Plan 1', price: 100 }];
      
      const chain = {
        select: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        range: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
      };
      
      const thenable = {
        then: (resolve: any) => {
          if (table === 'participant_accommodations') {
            const accs = [
              { id: 'a1', status: 'paid', room_id: 'r1', checked_in: true, checked_out: false },
              { id: 'a2', status: 'paid', room_id: null, checked_in: false, checked_out: false },
              { id: 'a3', status: 'pending', room_id: null, checked_in: false, checked_out: false },
              { id: 'a4', status: 'cancelled', room_id: null, checked_in: false, checked_out: false },
            ];
            resolve({ data: accs, count: accs.length, error: null });
          } else if (table === 'accommodation_allocations') {
            resolve({ data: [{ hostel_id: 'h1', room_id: 'r1' }], error: null });
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
});

describe('Accommodation Dashboard API (Phase 2F)', () => {
  it('should compute comprehensive stats for Phase 2F', async () => {
    const req = new NextRequest('http://localhost:3000/api/admin/accommodations/dashboard');
    const res = await GET(req);
    const json = await res.json();
    if (res.status !== 200) console.error("TEST FAILED WITH:", json);
    
    expect(res.status).toBe(200);
    
    // Total capacity should only include active rooms (r1 capacity is 2)
    expect(json.stats.totalCapacity).toBe(2);
    
    // Occupied capacity should be 1 (from active allocation)
    expect(json.stats.occupiedCapacity).toBe(1);
    
    // 1 paid with room
    expect(json.stats.allocated).toBe(1);
    
    // 1 paid without room
    expect(json.stats.awaitingAllocation).toBe(1);
    
    // Total 4 records
    expect(json.stats.total).toBe(4);
    
    expect(json.stats.paid).toBe(2);
    expect(json.stats.pending).toBe(1);
    expect(json.stats.cancelled).toBe(1);
    
    // Check in should be 1
    expect(json.stats.checkedIn).toBe(1);
  });
});
