import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { config } from '../config.js';

/**
 * Encrypt a UTF-8 string with AES-256-GCM using a key derived from
 * TOKEN_ENCRYPTION_KEY. If no key is configured, returns the plaintext and
 * signals `encrypted: false` so the caller can store it as-is.
 */
export function encryptSecret(plaintext: string): { value: string; encrypted: boolean } {
  if (!config.tokenEncryptionKey) return { value: plaintext, encrypted: false };
  const key = createHash('sha256').update(config.tokenEncryptionKey).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const packed = Buffer.concat([iv, tag, enc]).toString('base64');
  return { value: packed, encrypted: true };
}

export function decryptSecret(value: string, encrypted: boolean): string {
  if (!encrypted) return value;
  if (!config.tokenEncryptionKey) throw new Error('TOKEN_ENCRYPTION_KEY not set but token is encrypted');
  const key = createHash('sha256').update(config.tokenEncryptionKey).digest();
  const raw = Buffer.from(value, 'base64');
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const enc = raw.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}
