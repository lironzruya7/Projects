export interface EmailAttachment {
  filename: string;
  mimeType: string;
  data: Buffer;
}

export interface EmailMessage {
  id: string;
  threadId?: string;
  from: string;
  fromName: string;
  subject: string;
  date: string; // ISO yyyy-mm-dd
  snippet?: string;
  bodyText: string;
  attachments: EmailAttachment[];
}

/** Common interface implemented by both the Gmail API and IMAP providers. */
export interface EmailProvider {
  readonly name: 'gmail' | 'imap';
  isConfigured(): boolean;
  isConnected(): Promise<boolean>;
  /** Search and return full messages (body + attachments) for a query. */
  search(query: string, maxResults: number): Promise<EmailMessage[]>;
}

/** Build a provider search query from keywords + sender domains + lookback. */
export function buildQuery(opts: {
  keywords: string[];
  senderDomains: string[];
  lookbackDays: number;
}): string {
  const parts: string[] = [];
  const terms: string[] = [];
  if (opts.keywords.length) terms.push(...opts.keywords.map((k) => `"${k}"`));
  if (opts.senderDomains.length) terms.push(...opts.senderDomains.map((d) => `from:${d}`));
  if (terms.length) parts.push(`(${terms.join(' OR ')})`);
  if (opts.lookbackDays > 0) parts.push(`newer_than:${opts.lookbackDays}d`);
  return parts.join(' ');
}
