/** Run `worker` over `items` with at most `limit` in flight. Order preserved. */
export async function mapPool(items, limit, worker) {
  if (!Number.isFinite(limit) || limit <= 0) {
    throw new Error(`mapPool: limit must be a positive finite number, got ${limit}`);
  }
  const results = new Array(items.length);
  let next = 0;

  async function drain() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index], index);
    }
  }

  const width = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: width }, drain));
  return results;
}
