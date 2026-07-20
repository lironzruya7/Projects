/**
 * OCR fallback for scanned / image receipts using tesseract.js (Hebrew + English).
 * tesseract.js downloads its language traineddata on first use; if the network
 * is unavailable this fails gracefully and returns an empty string so the rest
 * of the import still succeeds.
 */
export async function ocrImage(buf: Buffer): Promise<string> {
  try {
    const { createWorker } = await import('tesseract.js');
    const worker = await createWorker('heb+eng');
    try {
      const { data } = await worker.recognize(buf);
      return data.text ?? '';
    } finally {
      await worker.terminate();
    }
  } catch (err) {
    console.warn('[ocr] OCR unavailable:', (err as Error).message);
    return '';
  }
}
