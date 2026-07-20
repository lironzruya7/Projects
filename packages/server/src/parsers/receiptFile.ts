import { extractPdfText } from './pdf.js';
import { ocrImage, ocrPdf } from './ocr.js';

const IMAGE = /image\/(png|jpe?g|gif|webp|bmp|tiff|heic|heif)/i;

/**
 * Pull text out of a receipt file (PDF or image), OCR'ing when there's no text
 * layer. Shared by the email scanner and the manual "scan a receipt" flow.
 */
export async function receiptTextFromFile(mime: string, filename: string, data: Buffer): Promise<string> {
  const lower = filename.toLowerCase();
  if (mime.includes('pdf') || lower.endsWith('.pdf')) {
    const t = await extractPdfText(data);
    if (t.trim().length > 20) return t;
    const ocred = await ocrPdf(data);
    return ocred.trim().length > 0 ? ocred : t;
  }
  if (IMAGE.test(mime) || /\.(png|jpe?g|gif|webp|bmp|tiff|heic|heif)$/i.test(lower)) {
    return ocrImage(data);
  }
  return '';
}
