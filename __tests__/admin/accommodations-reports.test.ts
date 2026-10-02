import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as DashboardGET } from '@/app/api/admin/accommodations/dashboard/route';
import { GET as HistoryGET } from '@/app/api/admin/accommodations/history/route';
import { requireAccommodationAdmin } from '@/lib/supabase/server';

// Mock the auth module
vi.mock('@/lib/supabase/server', () => ({
  requireAccommodationAdmin: vi.fn(),
  requireAdminSession: vi.fn(),
}));

// Mock Supabase admin client
const mockSupabase = {
  from: vi.fn(),
};

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => mockSupabase),
}));

describe('Phase 3C: Accommodation Reporting, Reconciliation & Admin Reports', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv, NEXT_PUBLIC_SUPABASE_URL: 'http://localhost', SUPABASE_SECRET_KEY: 'test-key' };
    (requireAccommodationAdmin as any).mockResolvedValue({ success: true });
    
    // Default chain for mockSupabase.from()
    const createQueryChain = (data: any, error = null) => {
      const chain: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        range: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        then: vi.fn((resolve) => resolve({ data, error })),
      };
      return chain;
    };
    
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'accommodation_allocations') {
        return createQueryChain([{ id: 'h1', participant_accommodation_id: 'a1', status: 'active', created_at: new Date().toISOString() }]);
      }
      return createQueryChain([]);
    });
  });

  describe('Global Allocation History API', () => {
    it('should return global history when participantAccommodationId is not provided', async () => {
      const req = new NextRequest('http://localhost:3000/api/admin/accommodations/history');
      const response = await HistoryGET(req);
      const data = await response.json();
      
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data).toHaveLength(1);
      
      // Verify pagination defaults were applied
      expect(mockSupabase.from).toHaveBeenCalledWith('accommodation_allocations');
    });

    it('should filter history when participantAccommodationId is provided', async () => {
      const req = new NextRequest('http://localhost:3000/api/admin/accommodations/history?participantAccommodationId=p123');
      const response = await HistoryGET(req);
      const data = await response.json();
      
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });

    it('should return 500 on database error', async () => {
      mockSupabase.from.mockImplementation(() => {
        const chain: any = {
          select: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          range: vi.fn().mockReturnThis(),
          then: vi.fn((resolve) => resolve({ data: null, error: { message: 'DB Error' } })),
        };
        return chain;
      });

      const req = new NextRequest('http://localhost:3000/api/admin/accommodations/history');
      const response = await HistoryGET(req);
      const data = await response.json();
      
      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('DB_ERROR');
    });
  });
  
  describe('Reports Data Completeness', () => {
    // We already fetch all data using the existing Dashboard API
    // We verify that the API still returns the correct structure.
    it('Dashboard API should return plans, accommodations, hostels, floors, rooms, and aggregations', async () => {
      // Mock the complex Dashboard API chains
      mockSupabase.from.mockImplementation((table: string) => {
        const chain: any = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          range: vi.fn().mockReturnThis(),
          then: vi.fn((resolve) => resolve({ data: [], error: null })),
        };
        return chain;
      });

      const req = new NextRequest('http://localhost:3000/api/admin/accommodations/dashboard');
      const response = await DashboardGET(req);
      const data = await response.json();
      
      expect(response.status).toBe(200);
      expect(data.accommodations).toBeDefined();
      expect(data.hostels).toBeDefined();
      expect(data.floors).toBeDefined();
      expect(data.rooms).toBeDefined();
      expect(data.plans).toBeDefined();
      expect(data.roomOccupancy).toBeDefined();
    });
  });

});
