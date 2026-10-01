/** Object key order is not capture identity. Arrays, strings and value types are preserved. */
export function canonicalJson(value: unknown): string {
  const order = (entry: unknown): unknown => Array.isArray(entry) ? entry.map(order) : entry && typeof entry === 'object' ? Object.fromEntries(Object.entries(entry).sort(([left], [right]) => left.localeCompare(right)).map(([key, nested]) => [key, order(nested)])) : entry;
  return JSON.stringify(order(value));
}
