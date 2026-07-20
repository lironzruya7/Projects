import { spawn } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * OCR fallback for scanned / image receipts using tesseract.js (Hebrew + English).
 * tesseract.js downloads its language traineddata on first use; if the network
 * is unavailable this fails gracefully and returns an empty string so the rest
 * of the import still succeeds.
 */
export async function ocrImage(buf: Buffer): Promise<string> {
  // tesseract.js can throw asynchronously (e.g. it fails to fetch its language
  // data) in a way a try/catch here can't catch, so cap the whole thing with a
  // timeout. A global handler in index.ts keeps that async throw from crashing
  // the server; here we just return '' so the caller treats it as "no text".
  return withTimeout(runOcr(buf), 60_000);
}

async function runOcr(buf: Buffer): Promise<string> {
  try {
    const { createWorker } = await import('tesseract.js');
    const worker = await createWorker('heb+eng');
    try {
      const { data } = await worker.recognize(buf);
      return data.text ?? '';
    } finally {
      await worker.terminate().catch(() => {});
    }
  } catch (err) {
    console.warn('[ocr] OCR unavailable:', (err as Error).message);
    return '';
  }
}

function withTimeout(p: Promise<string>, ms: number): Promise<string> {
  return Promise.race([
    p.catch(() => ''),
    new Promise<string>((resolve) => setTimeout(() => resolve(''), ms)),
  ]);
}

/**
 * OCR a scanned PDF (one with no text layer). tesseract.js cannot read PDFs, so
 * we render the first few pages to PNG via `pdftoppm` (poppler-utils) and OCR
 * each. If poppler isn't installed this returns '' and logs how to enable it —
 * everything else still works.
 */
export async function ocrPdf(buf: Buffer, maxPages = 3): Promise<string> {
  let dir: string | null = null;
  try {
    dir = await mkdtemp(join(tmpdir(), 'finpdf-'));
    const pdfPath = join(dir, 'in.pdf');
    await writeFile(pdfPath, buf);

    const rendered = await renderPdfToPngs(pdfPath, join(dir, 'page'), maxPages);
    if (!rendered) return '';

    const pngs = (await readdir(dir)).filter((f) => f.endsWith('.png')).sort();
    let text = '';
    for (const f of pngs) {
      const img = await readFile(join(dir, f));
      text += (await ocrImage(img)) + '\n';
    }
    return text;
  } catch (err) {
    console.warn('[ocr] PDF OCR failed:', (err as Error).message);
    return '';
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

function renderPdfToPngs(input: string, outPrefix: string, maxPages: number): Promise<boolean> {
  return new Promise((resolve) => {
    // 200 DPI gives tesseract enough resolution for Hebrew receipts.
    const proc = spawn('pdftoppm', ['-png', '-r', '200', '-f', '1', '-l', String(maxPages), input, outPrefix]);
    proc.on('error', (err) => {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        console.warn(
          '[ocr] pdftoppm not found — install poppler-utils to OCR scanned PDFs (e.g. `sudo apt-get install poppler-utils`)',
        );
      } else {
        console.warn('[ocr] pdftoppm error:', err.message);
      }
      resolve(false);
    });
    proc.on('close', (code) => resolve(code === 0));
  });
}
