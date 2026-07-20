import { config, outlookConfigured } from '../config.js';
import { htmlToText } from './html.js';
import { loadToken, saveToken } from './tokenStore.js';
import type { EmailAttachment, EmailMessage, EmailProvider } from './types.js';

// Microsoft Graph, read-only mail. offline_access gives us a refresh token.
const SCOPES = 'offline_access Mail.Read';
const GRAPH = 'https://graph.microsoft.com/v1.0';

function authBase(): string {
  return `https://login.microsoftonline.com/${config.outlook.tenant}/oauth2/v2.0`;
}

interface StoredToken {
  access_token: string;
  refresh_token?: string;
  expires_at: number; // epoch ms
}

export function getAuthUrl(): string {
  const params = new URLSearchParams({
    client_id: config.outlook.clientId,
    response_type: 'code',
    redirect_uri: config.outlook.redirectUri,
    response_mode: 'query',
    scope: SCOPES,
    prompt: 'select_account',
  });
  return `${authBase()}/authorize?${params.toString()}`;
}

async function requestToken(body: Record<string, string>): Promise<StoredToken> {
  const res = await fetch(`${authBase()}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.outlook.clientId,
      client_secret: config.outlook.clientSecret,
      scope: SCOPES,
      redirect_uri: config.outlook.redirectUri,
      ...body,
    }).toString(),
  });
  if (!res.ok) {
    throw new Error(`Microsoft token request failed ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const data = (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number };
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + (data.expires_in - 60) * 1000,
  };
}

export async function exchangeCode(code: string): Promise<void> {
  const token = await requestToken({ grant_type: 'authorization_code', code });
  saveToken('outlook', token);
}

async function accessToken(): Promise<string | null> {
  const stored = loadToken<StoredToken>('outlook');
  if (!stored) return null;
  if (Date.now() < stored.expires_at) return stored.access_token;
  if (!stored.refresh_token) return null;
  const refreshed = await requestToken({ grant_type: 'refresh_token', refresh_token: stored.refresh_token });
  // Microsoft may not return a new refresh token; keep the old one if so.
  const merged: StoredToken = { ...refreshed, refresh_token: refreshed.refresh_token ?? stored.refresh_token };
  saveToken('outlook', merged);
  return merged.access_token;
}

/** Translate the shared (Gmail-style) query string into a Graph $search KQL string. */
function toKql(query: string): string {
  const terms: string[] = [];
  for (const m of query.matchAll(/"([^"]+)"/g)) terms.push(`"${m[1]}"`);
  for (const m of query.matchAll(/from:(\S+)/g)) terms.push(`from:${m[1]}`);
  return terms.join(' OR ');
}

function lookbackCutoff(query: string): number | null {
  const m = query.match(/newer_than:(\d+)d/);
  if (!m) return null;
  return Date.now() - Number(m[1]) * 86_400_000;
}

export const outlookProvider: EmailProvider = {
  name: 'outlook',
  isConfigured: () => outlookConfigured(),
  async isConnected() {
    return Boolean(loadToken('outlook'));
  },
  async search(query, maxResults) {
    const token = await accessToken();
    if (!token) throw new Error('Outlook not connected');
    const kql = toKql(query);
    const cutoff = lookbackCutoff(query);

    const url = new URL(`${GRAPH}/me/messages`);
    url.searchParams.set('$top', String(Math.min(maxResults, 100)));
    url.searchParams.set('$select', 'id,subject,from,receivedDateTime,body,hasAttachments');
    if (kql) url.searchParams.set('$search', `"${kql}"`);
    else url.searchParams.set('$orderby', 'receivedDateTime desc');

    const res = await fetch(url, {
      headers: {
        authorization: `Bearer ${token}`,
        // Ask Graph to return the body as plain text so we skip HTML parsing.
        Prefer: 'outlook.body-content-type="text"',
      },
    });
    if (!res.ok) {
      throw new Error(`Microsoft Graph error ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    const data = (await res.json()) as { value: GraphMessage[] };

    const out: EmailMessage[] = [];
    for (const msg of data.value ?? []) {
      const dateIso = (msg.receivedDateTime ?? new Date().toISOString()).slice(0, 10);
      if (cutoff && Date.parse(msg.receivedDateTime ?? '') < cutoff) continue;

      const bodyRaw = msg.body?.content ?? '';
      const bodyText = msg.body?.contentType === 'html' ? htmlToText(bodyRaw) : bodyRaw;

      const attachments: EmailAttachment[] = [];
      if (msg.hasAttachments) {
        for (const att of await fetchAttachments(token, msg.id)) attachments.push(att);
      }

      out.push({
        id: msg.id,
        from: msg.from?.emailAddress?.address ?? '',
        fromName: msg.from?.emailAddress?.name ?? '',
        subject: msg.subject ?? '',
        date: dateIso,
        bodyText,
        attachments,
      });
    }
    return out;
  },
};

interface GraphMessage {
  id: string;
  subject?: string;
  receivedDateTime?: string;
  hasAttachments?: boolean;
  from?: { emailAddress?: { address?: string; name?: string } };
  body?: { contentType?: string; content?: string };
}

/** Fetch a single attachment's bytes on demand (no local storage). */
export async function fetchAttachment(
  messageId: string,
  filename: string,
): Promise<{ data: Buffer; mimeType: string } | null> {
  const token = await accessToken();
  if (!token) throw new Error('Outlook not connected');
  const atts = await fetchAttachments(token, messageId);
  const match = atts.find((a) => a.filename === filename);
  if (!match) return null;
  return { data: match.data, mimeType: match.mimeType };
}

async function fetchAttachments(token: string, messageId: string): Promise<EmailAttachment[]> {
  const res = await fetch(`${GRAPH}/me/messages/${messageId}/attachments`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) return [];
  const data = (await res.json()) as {
    value: Array<{
      '@odata.type'?: string;
      name?: string;
      contentType?: string;
      contentBytes?: string;
    }>;
  };
  const out: EmailAttachment[] = [];
  for (const a of data.value ?? []) {
    if (a['@odata.type'] === '#microsoft.graph.fileAttachment' && a.contentBytes) {
      out.push({
        filename: a.name ?? 'attachment',
        mimeType: a.contentType ?? 'application/octet-stream',
        data: Buffer.from(a.contentBytes, 'base64'),
      });
    }
  }
  return out;
}
