import { simpleParser } from 'mailparser';
import { config, imapConfigured } from '../config.js';
import type { EmailAttachment, EmailMessage, EmailProvider } from './types.js';

/**
 * IMAP fallback provider (same interface as Gmail). Uses imapflow + mailparser.
 * Query is a plain string of space-separated keywords; matching is done with an
 * OR of TEXT searches, limited to the last `lookbackDays` (encoded by the scan
 * layer via SINCE we approximate by fetching recent messages).
 */
export const imapProvider: EmailProvider = {
  name: 'imap',
  isConfigured: () => imapConfigured(),
  async isConnected() {
    return imapConfigured();
  },
  async search(query, maxResults) {
    if (!imapConfigured()) throw new Error('IMAP not configured');
    const { ImapFlow } = await import('imapflow');
    const client = new ImapFlow({
      host: config.imap.host,
      port: config.imap.port,
      secure: true,
      auth: { user: config.imap.user, pass: config.imap.password },
      logger: false,
    });
    const messages: EmailMessage[] = [];
    await client.connect();
    try {
      const lock = await client.getMailboxLock('INBOX');
      try {
        const keywords = query
          .replace(/newer_than:\d+d/g, '')
          .match(/"([^"]+)"/g)
          ?.map((s) => s.replace(/"/g, '')) ?? [];
        const searchQuery: Record<string, unknown> =
          keywords.length > 0 ? { or: keywords.map((k) => ({ body: k })) } : { all: true };

        const uids = (await client.search(searchQuery, { uid: true })) || [];
        const chosen = uids.slice(-maxResults);
        for await (const msg of client.fetch(chosen, { uid: true, source: true }, { uid: true })) {
          if (!msg.source) continue;
          const parsed = await simpleParser(msg.source);
          const attachments: EmailAttachment[] = (parsed.attachments ?? []).map((a: { filename?: string; contentType?: string; content: Buffer }) => ({
            filename: a.filename ?? 'attachment',
            mimeType: a.contentType ?? 'application/octet-stream',
            data: a.content,
          }));
          const fromAddr = parsed.from?.value?.[0];
          messages.push({
            id: String(msg.uid),
            from: fromAddr?.address ?? '',
            fromName: fromAddr?.name ?? '',
            subject: parsed.subject ?? '',
            date: (parsed.date ?? new Date()).toISOString().slice(0, 10),
            bodyText: parsed.text ?? (parsed.html ? String(parsed.html).replace(/<[^>]+>/g, ' ') : ''),
            attachments,
          });
        }
      } finally {
        lock.release();
      }
    } finally {
      await client.logout();
    }
    return messages;
  },
};
