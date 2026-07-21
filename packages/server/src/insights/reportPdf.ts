import { config } from '../config.js';

/**
 * Render report HTML to a PDF using the same Chromium the scraper uses.
 * Headless PDF needs no display, so this works without xvfb.
 */
export async function htmlToPdf(html: string): Promise<Buffer> {
  const { default: puppeteer } = await import('puppeteer');
  const browser = await puppeteer.launch({
    headless: true,
    ...(config.puppeteerExecutablePath ? { executablePath: config.puppeteerExecutablePath } : {}),
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  } as never);
  try {
    const page = await browser.newPage();
    // Self-contained HTML (no external requests) — 'load' is enough.
    await page.setContent(html, { waitUntil: 'load' });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '14mm', bottom: '14mm', left: '10mm', right: '10mm' },
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}
