import { randomUUID } from 'node:crypto';

interface CachedUpload {
  filename: string;
  buffer: Buffer;
  createdAt: number;
}

const cache = new Map<string, CachedUpload>();
const TTL_MS = 30 * 60 * 1000;

export function putUpload(filename: string, buffer: Buffer): string {
  const id = randomUUID();
  cache.set(id, { filename, buffer, createdAt: Date.now() });
  sweep();
  return id;
}

export function getUpload(id: string): CachedUpload | null {
  const u = cache.get(id);
  if (!u) return null;
  if (Date.now() - u.createdAt > TTL_MS) {
    cache.delete(id);
    return null;
  }
  return u;
}

function sweep(): void {
  const now = Date.now();
  for (const [id, u] of cache) if (now - u.createdAt > TTL_MS) cache.delete(id);
}
