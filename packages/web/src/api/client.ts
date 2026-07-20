export type SourceType = 'email' | 'bank' | 'card';

export interface Transaction {
  id: string;
  date: string;
  postedAt: string | null;
  amount: number;
  currency: string;
  merchantRaw: string;
  merchantNormalized: string;
  description: string;
  category: string | null;
  categorySource: 'rule' | 'manual' | 'llm' | 'none';
  sourceType: SourceType;
  sourceProvider: string | null;
  sourceRef: string | null;
  externalId: string | null;
  importBatch: string | null;
  rawAmount: string | null;
  mergedInto: string | null;
  createdAt: string;
}

export interface LedgerEntry extends Transaction {
  sources: Transaction[];
  sourceCount: number;
  sourceTypes: SourceType[];
}

export interface Category {
  name: string;
  display_order: number;
  color: string | null;
  is_builtin: number;
}

export interface CategoryRule {
  id: string;
  pattern: string;
  match_type: 'exact' | 'contains' | 'regex';
  category: string;
  source: 'user' | 'llm' | 'seed';
  priority: number;
  created_at: string;
}

export interface ColumnMapping {
  date?: string | null;
  amount?: string | null;
  debit?: string | null;
  credit?: string | null;
  description?: string | null;
  merchant?: string | null;
  currency?: string | null;
  type?: string | null;
}

export type AmountMode = 'signed' | 'debit_credit' | 'magnitude_type' | 'flip_sign';

export interface ImportPreview {
  signature: string;
  headerRow: number;
  header: string[];
  sampleRows: string[][];
  totalRows: number;
  suggestion: {
    mapping: ColumnMapping;
    amountMode: AmountMode;
    provider: string | null;
    sourceType: 'bank' | 'card';
    confidence: number;
  };
  detectedDateFormat: string;
  format: 'csv' | 'xlsx';
  encoding?: string;
}

export interface DashboardSummary {
  currency: string;
  referenceMonth: string;
  totals: { thisMonth: number; lastMonth: number; threeMonthAvg: number; momChangePct: number | null };
  categoryBreakdown: Array<{ category: string; amount: number; count: number }>;
  spendOverTime: Array<{ month: string; expense: number; income: number }>;
  topMerchants: Array<{ merchant: string; amount: number; count: number }>;
  cashFlow: Array<{ month: string; income: number; expense: number; net: number }>;
  counts: { ledger: number; alerts: number };
}

export interface RecurringItem {
  merchant: string;
  category: string | null;
  avgAmount: number;
  currency: string;
  intervalDays: number;
  occurrences: number;
  lastDate: string;
  nextExpected: string;
  monthlyCost: number;
  annualCost: number;
}

export interface Anomaly {
  type: 'spike' | 'new_merchant' | 'double_charge';
  transactionId?: string;
  merchant: string;
  amount: number;
  date: string;
  detail: string;
  alertId?: string;
}

export interface DoubleChargeAlert {
  id: string;
  txn_a: string;
  txn_b: string;
  amount: number;
  merchant: string;
  date_a: string;
  date_b: string;
  similarity: number;
  status: string;
  created_at: string;
  a: Transaction | null;
  b: Transaction | null;
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.error) msg = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  const ct = res.headers.get('content-type') ?? '';
  return (ct.includes('application/json') ? res.json() : res.text()) as Promise<T>;
}

export const api = {
  health: () => req<{ ok: boolean; currency: string }>('/api/health'),

  // Import
  previewFile: async (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch('/api/import/preview', { method: 'POST', body: fd });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Upload failed');
    return res.json() as Promise<{
      uploadId: string;
      filename: string;
      preview: ImportPreview;
      remembered: unknown;
    }>;
  },
  commitImport: (body: unknown) =>
    req<{ imported: number; skippedCount: number; skipped: unknown[]; dedup: unknown; batchId: string }>(
      '/api/import/commit',
      { method: 'POST', body: JSON.stringify(body) },
    ),
  batches: () => req<{ batches: any[] }>('/api/import/batches'),
  deleteBatch: (id: string) => req(`/api/import/batches/${id}`, { method: 'DELETE' }),
  mappings: () => req<{ mappings: any[] }>('/api/import/mappings'),

  // Transactions
  transactions: (params: Record<string, string | undefined>) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
    return req<{ transactions: LedgerEntry[]; count: number }>(`/api/transactions?${qs.toString()}`);
  },
  transaction: (id: string) => req<LedgerEntry>(`/api/transactions/${id}`),
  recategorize: (id: string, category: string | null, applyToMerchant: boolean) =>
    req(`/api/transactions/${id}/category`, {
      method: 'POST',
      body: JSON.stringify({ category, applyToMerchant }),
    }),

  // Categories & rules
  categories: () => req<{ categories: Category[] }>('/api/categories'),
  addCategory: (name: string, color?: string) =>
    req('/api/categories', { method: 'POST', body: JSON.stringify({ name, color }) }),
  renameCategory: (name: string, newName: string) =>
    req(`/api/categories/${encodeURIComponent(name)}`, { method: 'PATCH', body: JSON.stringify({ newName }) }),
  deleteCategory: (name: string) =>
    req(`/api/categories/${encodeURIComponent(name)}`, { method: 'DELETE' }),
  rules: () => req<{ rules: CategoryRule[] }>('/api/rules'),
  addRule: (pattern: string, category: string, matchType: 'exact' | 'contains' | 'regex') =>
    req<{ rule: CategoryRule; recategorized: number }>('/api/rules', {
      method: 'POST',
      body: JSON.stringify({ pattern, category, matchType }),
    }),
  deleteRule: (id: string) => req(`/api/rules/${id}`, { method: 'DELETE' }),
  recategorizeAll: () => req<{ recategorized: number }>('/api/rules/recategorize', { method: 'POST' }),

  // Dedup
  runDedup: () => req<{ merges: number; mergedRows: number; alerts: number }>('/api/dedup/run', { method: 'POST' }),
  rebuildDedup: () => req('/api/dedup/rebuild', { method: 'POST' }),
  alerts: (status?: string) =>
    req<{ alerts: DoubleChargeAlert[] }>(`/api/dedup/alerts${status ? `?status=${status}` : ''}`),
  resolveAlert: (id: string, status: 'confirmed' | 'dismissed') =>
    req(`/api/dedup/alerts/${id}/resolve`, { method: 'POST', body: JSON.stringify({ status }) }),
  unmerge: (id: string) => req('/api/dedup/unmerge', { method: 'POST', body: JSON.stringify({ id }) }),
  mergeManual: (ids: string[]) => req('/api/dedup/merge', { method: 'POST', body: JSON.stringify({ ids }) }),

  // Dashboard & insights
  dashboard: (params: Record<string, string | undefined> = {}) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
    return req<DashboardSummary>(`/api/dashboard?${qs.toString()}`);
  },
  recurring: () => req<{ recurring: RecurringItem[] }>('/api/insights/recurring'),
  anomalies: () => req<{ anomalies: Anomaly[] }>('/api/insights/anomalies'),

  // Email
  emailStatus: () =>
    req<{ gmail: { configured: boolean; connected: boolean }; imap: { configured: boolean }; settings: any }>(
      '/api/email/status',
    ),
  emailSettings: () => req<any>('/api/email/settings'),
  updateEmailSettings: (body: unknown) =>
    req('/api/email/settings', { method: 'PUT', body: JSON.stringify(body) }),
  gmailAuthUrl: () => req<{ url: string }>('/api/email/gmail/auth-url'),
  gmailDisconnect: () => req('/api/email/gmail/disconnect', { method: 'POST' }),
  scanEmail: (body: unknown = {}) =>
    req<{ messagesScanned: number; transactionsCreated: number; skippedExisting: number; dedup: unknown }>(
      '/api/email/scan',
      { method: 'POST', body: JSON.stringify(body) },
    ),

  // LLM
  llmStatus: () => req<{ configured: boolean; enabled: boolean; note: string }>('/api/llm/status'),
  setLlm: (enabled: boolean) => req('/api/llm/settings', { method: 'PUT', body: JSON.stringify({ enabled }) }),
  llmCategorize: () =>
    req<{ count: number; recategorized: number; classified: Record<string, string> }>('/api/llm/categorize', {
      method: 'POST',
    }),

  // Settings / data
  settings: () => req<any>('/api/settings'),
  setCurrency: (currency: string) =>
    req('/api/settings/currency', { method: 'PUT', body: JSON.stringify({ currency }) }),
  setDedup: (body: unknown) => req('/api/settings/dedup', { method: 'PUT', body: JSON.stringify(body) }),
  setAnomaly: (body: unknown) => req('/api/settings/anomaly', { method: 'PUT', body: JSON.stringify(body) }),
  wipe: () => req('/api/wipe', { method: 'POST', body: JSON.stringify({ confirm: 'DELETE' }) }),
};
