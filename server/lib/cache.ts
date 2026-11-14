// Small in-memory caches. Config files are tiny and change often, so most
// readers cache for a few seconds; expensive scans (disk usage) for longer.
// In-flight promises are shared so concurrent requests do the work once.

interface Entry<T> {
  at: number
  value: Promise<T>
}

const ttlEntries = new Map<string, Entry<unknown>>()

export function cached<T>(key: string, ttlMs: number, compute: () => Promise<T>): Promise<T> {
  const hit = ttlEntries.get(key) as Entry<T> | undefined
  if (hit && Date.now() - hit.at < ttlMs) return hit.value
  const value = compute()
  ttlEntries.set(key, { at: Date.now(), value })
  value.catch(() => ttlEntries.delete(key))
  return value
}

export function clearCaches(): void {
  ttlEntries.clear()
}

/** A cache keyed by a file's identity (path + size + mtime). */
export function createFileCache<T>(limit = Number.POSITIVE_INFINITY) {
  const entries = new Map<string, { size: number; mtimeMs: number; value: T }>()
  return {
    get(file: string, size: number, mtimeMs: number): T | undefined {
      const hit = entries.get(file)
      return hit && hit.size === size && hit.mtimeMs === mtimeMs ? hit.value : undefined
    },
    /** The last value stored for a file, even if the file has changed since. */
    latest(file: string): T | undefined {
      return entries.get(file)?.value
    },
    set(file: string, size: number, mtimeMs: number, value: T): void {
      entries.delete(file)
      entries.set(file, { size, mtimeMs, value })
      while (entries.size > limit) {
        const oldest = entries.keys().next().value
        if (oldest === undefined) break
        entries.delete(oldest)
      }
    },
    entries() {
      return entries.entries()
    },
    load(file: string, size: number, mtimeMs: number, value: T) {
      entries.set(file, { size, mtimeMs, value })
    },
  }
}

export const TTL = {
  config: 5_000,
  history: 15_000,
  storage: 10 * 60_000,
} as const
