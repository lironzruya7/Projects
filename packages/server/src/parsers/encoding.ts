import chardet from 'chardet';
import iconv from 'iconv-lite';

/**
 * Decode a raw file buffer to a UTF-8 string, detecting the encoding.
 * Israeli bank/card CSVs are frequently Windows-1255 (Hebrew) or UTF-8 with BOM.
 */
export function decodeBuffer(buf: Buffer): { text: string; encoding: string } {
  // Strip UTF-8 BOM if present.
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return { text: buf.slice(3).toString('utf8'), encoding: 'UTF-8' };
  }
  let detected = chardet.detect(buf) ?? 'UTF-8';
  // chardet sometimes reports ISO-8859-x for Hebrew; prefer windows-1255 when
  // the byte distribution looks like Hebrew (0xE0-0xFA range heavily used).
  if (looksLikeHebrew1255(buf) && !/utf-?8/i.test(detected)) {
    detected = 'windows-1255';
  }
  if (!iconv.encodingExists(detected)) detected = 'UTF-8';
  try {
    return { text: iconv.decode(buf, detected), encoding: detected };
  } catch {
    return { text: buf.toString('utf8'), encoding: 'UTF-8' };
  }
}

function looksLikeHebrew1255(buf: Buffer): boolean {
  let hebrewish = 0;
  const sample = buf.subarray(0, Math.min(buf.length, 4096));
  for (const b of sample) {
    if (b >= 0xe0 && b <= 0xfa) hebrewish++;
  }
  return hebrewish > sample.length * 0.05;
}

/** Remove Unicode directional marks and zero-width chars that pollute parsed cells. */
export function stripDirectionalMarks(s: string): string {
  return s.replace(/[‎‏‪-‮⁦-⁩﻿​]/g, '');
}
