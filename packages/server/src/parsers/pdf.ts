// Import the library entry directly to avoid pdf-parse's debug harness, which
// tries to read a bundled test PDF when imported as the package root under ESM.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export async function extractPdfText(buf: Buffer): Promise<string> {
  try {
    const pdfParse = require('pdf-parse/lib/pdf-parse.js') as (b: Buffer) => Promise<{ text: string }>;
    const data = await pdfParse(buf);
    return data.text ?? '';
  } catch (err) {
    return '';
  }
}
