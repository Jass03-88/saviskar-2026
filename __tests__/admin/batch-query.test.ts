import { describe, it, expect, vi } from "vitest";
import { fetchInBatches } from "@/lib/supabase/batch";

describe("lib/supabase/batch - fetchInBatches Unit Tests", () => {
  it("handles empty and nullish inputs without calling the fetcher", async () => {
    const fetcher = vi.fn();

    const res1 = await fetchInBatches([], fetcher);
    expect(res1).toEqual({ data: [], error: null });

    const res2 = await fetchInBatches(null as unknown as string[], fetcher);
    expect(res2).toEqual({ data: [], error: null });

    const res3 = await fetchInBatches([null, undefined, ""] as unknown as string[], fetcher);
    expect(res3).toEqual({ data: [], error: null });

    expect(fetcher).not.toHaveBeenCalled();
  });

  it("deduplicates IDs and removes non-string / empty values before chunking", async () => {
    const fetcher = vi.fn().mockImplementation((chunk: string[]) =>
      Promise.resolve({
        data: chunk.map((id) => ({ id, name: `Record ${id}` })),
        error: null,
      })
    );

    const input = ["a", "b", "a", "c", "", null as unknown as string, "b", undefined as unknown as string, "d"];
    const result = await fetchInBatches(input, fetcher, 10);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(["a", "b", "c", "d"]);
    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(4);
    expect(result.data.map((r: { id: string }) => r.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("correctly chunks 200+ IDs into expected batch sizes", async () => {
    const receivedChunks: string[][] = [];
    const totalIds = 250;
    const chunkSize = 80;
    const ids = Array.from({ length: totalIds }, (_, i) => `uuid-${i + 1}`);

    const fetcher = vi.fn().mockImplementation((chunk: string[]) => {
      receivedChunks.push([...chunk]);
      return Promise.resolve({
        data: chunk.map((id) => ({ id })),
        error: null,
      });
    });

    const result = await fetchInBatches(ids, fetcher, chunkSize, 2);

    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(totalIds);
    // 250 with chunkSize 80 => 80, 80, 80, 10 (4 calls)
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(receivedChunks[0]).toHaveLength(80);
    expect(receivedChunks[1]).toHaveLength(80);
    expect(receivedChunks[2]).toHaveLength(80);
    expect(receivedChunks[3]).toHaveLength(10);

    // Verify first and last IDs in chunk slices
    expect(receivedChunks[0][0]).toBe("uuid-1");
    expect(receivedChunks[0][79]).toBe("uuid-80");
    expect(receivedChunks[1][0]).toBe("uuid-81");
    expect(receivedChunks[3][9]).toBe("uuid-250");
  });

  it("correctly aggregates all results across all batches without missing or duplicate records", async () => {
    const ids = Array.from({ length: 300 }, (_, i) => `item-${i}`);
    const fetcher = (chunk: string[]) =>
      Promise.resolve({
        data: chunk.map((id) => ({ id, value: `val-${id}` })),
        error: null,
      });

    const result = await fetchInBatches(ids, fetcher, 50, 4);

    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(300);

    const receivedIds = result.data.map((r: { id: string }) => r.id);
    const uniqueReceivedIds = new Set(receivedIds);
    expect(uniqueReceivedIds.size).toBe(300);
    expect(receivedIds).toEqual(ids);
  });

  it("strictly bounds concurrency to the configured limit", async () => {
    let currentInFlight = 0;
    let maxInFlight = 0;
    const concurrencyLimit = 3;
    const ids = Array.from({ length: 90 }, (_, i) => `concurrency-${i}`);

    const fetcher = vi.fn().mockImplementation(async (chunk: string[]) => {
      currentInFlight++;
      maxInFlight = Math.max(maxInFlight, currentInFlight);
      // Simulate async network latency
      await new Promise((resolve) => setTimeout(resolve, 20));
      currentInFlight--;
      return {
        data: chunk.map((id) => ({ id })),
        error: null,
      };
    });

    // 90 IDs with chunkSize 10 => 9 chunks. Concurrency limit 3 => max 3 concurrent calls.
    const result = await fetchInBatches(ids, fetcher, 10, concurrencyLimit);

    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(90);
    expect(fetcher).toHaveBeenCalledTimes(9);
    expect(maxInFlight).toBeLessThanOrEqual(concurrencyLimit);
    expect(maxInFlight).toBeGreaterThanOrEqual(2);
  });

  it("halts execution immediately when Supabase returns an error and never returns partial data as success", async () => {
    const ids = Array.from({ length: 160 }, (_, i) => `err-${i}`);
    const executedChunks: number[] = [];

    const fetcher = vi.fn().mockImplementation((chunk: string[]) => {
      const chunkIndex = executedChunks.length;
      executedChunks.push(chunkIndex);

      if (chunkIndex === 0) {
        return Promise.resolve({
          data: chunk.map((id) => ({ id })),
          error: null,
        });
      }

      // Second batch fails
      return Promise.resolve({
        data: null,
        error: { message: "PostgREST 500: Database Connection Timeout", code: "PGRST500" },
      });
    });

    // chunkSize 40 => 4 chunks. concurrency 1 to test step-by-step halting
    const result = await fetchInBatches(ids, fetcher, 40, 1);

    expect(result.error).toEqual({
      message: "PostgREST 500: Database Connection Timeout",
      code: "PGRST500",
    });
    // Critical: must not return partial records from first batch as success!
    expect(result.data).toEqual([]);
    // Chunks 3 and 4 should not have been called
    expect(executedChunks).toEqual([0, 1]);
  });

  it("propagates rejected promises when fetcher throws unexpectedly", async () => {
    const ids = ["reject-1", "reject-2"];
    const fetcher = () => Promise.reject(new Error("Network TLS socket closed abruptly"));

    await expect(fetchInBatches(ids, fetcher, 10, 2)).rejects.toThrow(
      "Network TLS socket closed abruptly"
    );
  });
});
