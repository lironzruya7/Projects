import { google } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';
import { config, gmailConfigured } from '../config.js';
import { htmlToText } from './html.js';
import type { EmailAttachment, EmailMessage, EmailProvider } from './types.js';
import { loadToken, saveToken } from './tokenStore.js';

const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];

function oauthClient(): OAuth2Client {
  return new google.auth.OAuth2(config.gmail.clientId, config.gmail.clientSecret, config.gmail.redirectUri);
}

export function getAuthUrl(): string {
  const client = oauthClient();
  return client.generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: SCOPES });
}

export async function exchangeCode(code: string): Promise<void> {
  const client = oauthClient();
  const { tokens } = await client.getToken(code);
  saveToken('gmail', tokens);
}

function authorizedClient(): OAuth2Client | null {
  const tokens = loadToken('gmail');
  if (!tokens) return null;
  const client = oauthClient();
  client.setCredentials(tokens as Record<string, unknown>);
  // Persist refreshed tokens.
  client.on('tokens', (t) => {
    const merged = { ...(loadToken('gmail') as object), ...t };
    saveToken('gmail', merged);
  });
  return client;
}

function headerValue(headers: Array<{ name?: string | null; value?: string | null }>, name: string): string {
  const h = headers.find((x) => (x.name ?? '').toLowerCase() === name.toLowerCase());
  return h?.value ?? '';
}

function parseFrom(from: string): { email: string; name: string } {
  const m = from.match(/^\s*"?([^"<]*)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1]!.trim(), email: m[2]!.trim() };
  return { name: from.trim(), email: from.trim() };
}

function decodeBody(data?: string | null): string {
  if (!data) return '';
  return Buffer.from(data, 'base64').toString('utf8');
}

function collectBodyAndAttachments(
  payload: any,
  acc: { text: string; html: string; attachmentParts: Array<{ filename: string; mimeType: string; attachmentId?: string; data?: string }> },
): void {
  if (!payload) return;
  const mime = payload.mimeType ?? '';
  const filename = payload.filename ?? '';
  if (filename && payload.body?.attachmentId) {
    acc.attachmentParts.push({
      filename,
      mimeType: mime,
      attachmentId: payload.body.attachmentId,
    });
  } else if (mime === 'text/plain') {
    acc.text += decodeBody(payload.body?.data);
  } else if (mime === 'text/html') {
    acc.html += decodeBody(payload.body?.data);
  }
  for (const part of payload.parts ?? []) collectBodyAndAttachments(part, acc);
}

export const gmailProvider: EmailProvider = {
  name: 'gmail',
  isConfigured: () => gmailConfigured(),
  async isConnected() {
    return Boolean(authorizedClient());
  },
  async search(query, maxResults) {
    const auth = authorizedClient();
    if (!auth) throw new Error('Gmail not connected');
    const gmail = google.gmail({ version: 'v1', auth });
    const list = await gmail.users.messages.list({ userId: 'me', q: query, maxResults });
    const ids = (list.data.messages ?? []).map((m) => m.id!).filter(Boolean);
    const messages: EmailMessage[] = [];
    for (const id of ids) {
      const full = await gmail.users.messages.get({ userId: 'me', id, format: 'full' });
      const payload = full.data.payload;
      const headers = payload?.headers ?? [];
      const from = parseFrom(headerValue(headers, 'From'));
      const subject = headerValue(headers, 'Subject');
      const dateHeader = headerValue(headers, 'Date');
      const dateIso = dateHeader ? new Date(dateHeader).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);

      const acc = { text: '', html: '', attachmentParts: [] as any[] };
      collectBodyAndAttachments(payload, acc);
      const bodyText = acc.text || htmlToText(acc.html);

      const attachments: EmailAttachment[] = [];
      for (const ap of acc.attachmentParts) {
        if (!ap.attachmentId) continue;
        const att = await gmail.users.messages.attachments.get({
          userId: 'me',
          messageId: id,
          id: ap.attachmentId,
        });
        if (att.data.data) {
          attachments.push({
            filename: ap.filename,
            mimeType: ap.mimeType,
            data: Buffer.from(att.data.data, 'base64'),
          });
        }
      }

      messages.push({
        id,
        threadId: full.data.threadId ?? undefined,
        from: from.email,
        fromName: from.name,
        subject,
        date: dateIso,
        snippet: full.data.snippet ?? undefined,
        bodyText,
        attachments,
      });
    }
    return messages;
  },
};
