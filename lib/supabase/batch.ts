/**
 * Executes a Supabase query across multiple batches of IDs to avoid PostgREST
 * URL overflow (UND_ERR_HEADERS_OVERFLOW / 16KB header limits in Node undici).
 *
 * When passing large arrays of IDs to `.in("column", ids)`, PostgREST generates
 * query parameters like `?column=in.(uuid1,uuid2,...)`. If there are 300+ UUIDs,
 * the URL length exceeds 16KB, causing Node fetch / undici to fail with
 * `HeadersOverflowError: Headers Overflow Error (UND_ERR_HEADERS_OVERFLOW)`.
 *
 * This utility splits the IDs into chunks (default 80 IDs per chunk, ensuring <4KB URL)
 * and executes them with a concurrency limit.
 *
 * @param ids Array of IDs/strings to filter with .in()
 * @param fetcher Async function returning Supabase response { data, error }
 * @param chunkSize Max number of IDs per query (defaults to 80 for safe URL lengths)
 * @param concurrency Max concurrent requests to execute at a time (defaults to 5)
 */
export async function fetchInBatches<T = any>(
  ids: (string | null | undefined)[],
  fetcher: (chunk: string[]) => PromiseLike<{ data: any; error: any }>,
  chunkSize = 80,
  concurrency = 5
): Promise<{ data: T[]; error: any }> {
  if (!ids || ids.length === 0) {
    return { data: [], error: null };
  }

  // Deduplicate and filter out empty / falsy strings
  const uniqueIds = Array.from(
    new Set(ids.filter((id): id is string => Boolean(id && typeof id === "string")))
  );
  if (uniqueIds.length === 0) {
    return { data: [], error: null };
  }

  const chunks: string[][] = [];
  for (let i = 0; i < uniqueIds.length; i += chunkSize) {
    chunks.push(uniqueIds.slice(i, i + chunkSize));
  }

  const allData: T[] = [];

  for (let i = 0; i < chunks.length; i += concurrency) {
    const currentBatch = chunks.slice(i, i + concurrency);
    const results = await Promise.all(currentBatch.map((chunk) => fetcher(chunk)));

    for (const res of results) {
      if (res.error) {
        return { data: [], error: res.error };
      }
      if (res.data && Array.isArray(res.data)) {
        allData.push(...res.data);
      }
    }
  }

  return { data: allData, error: null };
}

/**
 * Fetches all rows from a Supabase query by paginating in chunks of 1000
 * to overcome the Supabase/PostgREST 1000 max-rows limit.
 */
export async function fetchAllRows<T = any>(
  fetchChunk: (start: number, end: number) => PromiseLike<{ data: T[] | null; error: any; count?: number | null }>,
  chunkSize = 1000,
  maxRecords = 50000
): Promise<{ data: T[]; totalCount: number; error: any }> {
  let allData: T[] = [];
  let currentStart = 0;
  let totalCount = 0;

  while (currentStart < maxRecords) {
    const currentEnd = currentStart + chunkSize - 1;
    const res = await fetchChunk(currentStart, currentEnd);
    if (res.error) {
      return { data: allData, totalCount, error: res.error };
    }
    const chunk = res.data || [];
    if (totalCount === 0 && typeof res.count === "number") {
      totalCount = res.count;
    }
    allData.push(...chunk);
    if (chunk.length < chunkSize) {
      break;
    }
    currentStart += chunkSize;
    if (totalCount > 0 && currentStart >= totalCount) {
      break;
    }
  }

  return { data: allData, totalCount: totalCount || allData.length, error: null };
}
