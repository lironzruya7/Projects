export type SourceType = 'email' | 'bank' | 'card' | 'receipt';

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
  accountLabel: string | null;
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
  income: { total: number; salary: number; other: number };
  totals: { thisMonth: number; lastMonth: number; threeMonthAvg: number; momChangePct: number | null };
  categoryBreakdown: Array<{ category: string; amount: number; count: number }>;
  spendOverTime: Array<{ month: string; expense: number; income: number }>;
  topMerchants: Array<{ merchant: string; amount: number; count: number }>;
  cashFlow: Array<{ month: string; income: number; expense: number; net: number }>;
  byAccount: Array<{ provider: string | null; accountLabel: string | null; sourceType: string; amount: number; count: number }>;
  byCurrency: Array<{ currency: string; expense: number; income: number; count: number }>;
  activeCurrency: string;
  counts: { ledger: number; alerts: number };
  range: { min: string; max: string };
  forecast: Forecast;
}

export interface Forecast {
  currency: string;
  month: string;
  hasBalance: boolean;
  currentBalance: number | null;
  asOf: string | null;
  monthToDate: { spend: number; income: number };
  typical: { spend: number; income: number };
  expectedRemaining: { spend: number; income: number };
  projectedNet: number;
  projectedEndBalance: number | null;
  daysLeftInMonth: number;
  remainingBills: number;
  safeToSpendTotal: number;
  safeToSpendPerDay: number;
  simulation: { p10: number; p50: number; p90: number; probNegativePct: number } | null;
}

export interface Account {
  provider: string | null;
  accountLabel: string | null;
  sourceType: string;
  count: number;
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
  currentAmount: number;
  priceChangePct: number | null;
  isNew: boolean;
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

export interface RecommendationReport {
  currency: string;
  monthsAnalyzed: number;
  totalMonthlySpend: number;
  topCategories: Array<{ category: string; monthlyAvg: number; pct: number; count: number }>;
  recurring: RecurringItem[];
  recurringMonthly: number;
  recurringAnnual: number;
  serviceGroups: Array<{
    key: string;
    label: string;
    monthlyCost: number;
    overlapping: boolean;
    saveable: boolean;
    merchants: Array<{ merchant: string; monthlyCost: number; total: number; count: number }>;
  }>;
  recommendations: Array<{ kind: string; title: string; detail: string; monthlySaving: number }>;
  potentialMonthlySavings: number;
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

export interface EmailTestResult {
  provider: string;
  query: string;
  found: number;
  samples: Array<{
    from: string;
    subject: string;
    date: string;
    attachments: number;
    extractedAmount: number | null;
    currency: string | null;
  }>;
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  // Only set a JSON content-type when there's actually a body. Sending
  // `content-type: application/json` with an empty body (e.g. a bodyless
  // DELETE) makes Fastify reject the request with 400 "Body cannot be empty".
  const headers: Record<string, string> = { ...((init?.headers as Record<string, string>) ?? {}) };
  if (init?.body != null) headers['content-type'] = 'application/json';
  const res = await fetch(path, { ...init, headers });
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
  autoImport: async (
    files: Array<{ file: File; label?: string; provider?: string }> | FileList | File[],
    sourceType: 'card' | 'bank',
  ) => {
    const fd = new FormData();
    const items = Array.from(files as ArrayLike<unknown>).map((f) =>
      f instanceof File ? { file: f, label: '', provider: '' } : (f as { file: File; label?: string; provider?: string }),
    );
    // Send label + provider fields immediately before each file so the server pairs them.
    for (const { file, label, provider } of items) {
      fd.append('label', label ?? '');
      fd.append('provider', provider ?? '');
      fd.append('file', file);
    }
    const res = await fetch(`/api/import/auto?sourceType=${sourceType}`, { method: 'POST', body: fd });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Import failed');
    return res.json() as Promise<{
      results: Array<{
        filename: string;
        format?: string;
        provider?: string | null;
        accountLabel?: string | null;
        period?: string | null;
        duplicate?: boolean;
        imported?: number;
        skipped?: number;
        needsManual?: boolean;
        detail?: string | null;
        error?: string;
      }>;
      dedup: { merges: number; mergedRows: number; alerts: number };
    }>;
  },
  batches: () => req<{ batches: any[] }>('/api/import/batches'),
  deleteBatch: (id: string) => req(`/api/import/batches/${id}`, { method: 'DELETE' }),
  clearBatches: (sourceType: 'email' | 'bank' | 'card') =>
    req<{ ok: boolean; deleted: number }>('/api/import/clear', {
      method: 'POST',
      body: JSON.stringify({ sourceType }),
    }),
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

  // Manual receipt attachments
  listAttachments: (txnId: string) =>
    req<{ attachments: Array<{ id: string; filename: string; mimeType: string; size: number; createdAt: string }> }>(
      `/api/transactions/${txnId}/attachments`,
    ),
  uploadAttachment: async (txnId: string, file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch(`/api/transactions/${txnId}/attachments`, { method: 'POST', body: fd });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Upload failed');
    return res.json() as Promise<{ id: string; filename: string; mimeType: string; size: number }>;
  },
  deleteAttachment: (attId: string) => req(`/api/attachments/${attId}`, { method: 'DELETE' }),
  attachmentFileUrl: (attId: string) => `/api/attachments/file/${attId}`,
  // OCR a receipt photo/PDF and auto-create a (deduped) transaction from it.
  scanReceipt: async (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch('/api/receipts', { method: 'POST', body: fd });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error ?? 'Could not scan receipt');
    return body as {
      transactionId: string;
      extracted: { merchant: string | null; date: string | null; amount: number | null; currency: string; invoiceNumber: string | null };
      dedup: { merges: number; mergedRows: number; alerts: number };
      merged: boolean;
    };
  },

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
    req<{ alerts: DoubleChargeAlert[]; exactCount: number; sameMerchantCount: number }>(
      `/api/dedup/alerts${status ? `?status=${status}` : ''}`,
    ),
  mergeExactDuplicates: () =>
    req<{ merged: number; groups: number }>('/api/dedup/merge-exact', { method: 'POST' }),
  mergeSimilar: () => req<{ merged: number; groups: number }>('/api/dedup/merge-similar', { method: 'POST' }),
  resolveAlert: (id: string, status: 'confirmed' | 'dismissed') =>
    req(`/api/dedup/alerts/${id}/resolve`, { method: 'POST', body: JSON.stringify({ status }) }),
  mergeAlert: (id: string) => req<{ ok: boolean; primary: string | null }>(`/api/dedup/alerts/${id}/merge`, { method: 'POST' }),
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
  recommendations: () => req<RecommendationReport>('/api/insights/recommendations'),
  accounts: () => req<{ accounts: Account[] }>('/api/accounts'),
  currencies: () => req<{ currencies: Array<{ currency: string; count: number }> }>('/api/currencies'),

  // Email
  emailStatus: () =>
    req<{
      gmail: { configured: boolean; connected: boolean };
      outlook: { configured: boolean; connected: boolean };
      imap: { configured: boolean };
      settings: any;
    }>('/api/email/status'),
  emailSettings: () => req<any>('/api/email/settings'),
  updateEmailSettings: (body: unknown) =>
    req('/api/email/settings', { method: 'PUT', body: JSON.stringify(body) }),
  gmailAuthUrl: () => req<{ url: string }>('/api/email/gmail/auth-url'),
  gmailDisconnect: () => req('/api/email/gmail/disconnect', { method: 'POST' }),
  outlookAuthUrl: () => req<{ url: string }>('/api/email/outlook/auth-url'),
  outlookDisconnect: () => req('/api/email/outlook/disconnect', { method: 'POST' }),
  scanEmail: (body: { provider?: 'gmail' | 'outlook' | 'imap'; maxResults?: number } = {}) =>
    req<{ messagesScanned: number; transactionsCreated: number; skippedExisting: number; dedup: unknown }>(
      '/api/email/scan',
      { method: 'POST', body: JSON.stringify(body) },
    ),
  testEmail: (body: { provider?: 'gmail' | 'outlook' | 'imap' } = {}) =>
    req<EmailTestResult>('/api/email/test', { method: 'POST', body: JSON.stringify(body) }),

  // LLM
  llmStatus: () => req<{ configured: boolean; enabled: boolean; note: string }>('/api/llm/status'),
  setLlm: (enabled: boolean) => req('/api/llm/settings', { method: 'PUT', body: JSON.stringify({ enabled }) }),
  llmCategorize: () =>
    req<{ count: number; recategorized: number; classified: Record<string, string> }>('/api/llm/categorize', {
      method: 'POST',
    }),

  // Direct bank/card connection (israeli-bank-scrapers)
  scrapeProviders: () =>
    req<{
      encryptedAtRest: boolean;
      providers: Array<{
        key: string;
        label: string;
        sourceType: string;
        fields: Array<{ key: string; label: string; type: 'text' | 'password' }>;
        connected: boolean;
      }>;
    }>('/api/scrape/providers'),
  saveScrapeCredentials: (provider: string, credentials: Record<string, string>) =>
    req('/api/scrape/credentials', { method: 'POST', body: JSON.stringify({ provider, credentials }) }),
  deleteScrapeCredentials: (provider: string) =>
    req(`/api/scrape/credentials/${provider}`, { method: 'DELETE' }),
  runScrape: (provider: string, months?: number) =>
    req<{ accountsScanned: number; transactionsCreated: number; skippedExisting: number; fromDate: string }>(
      '/api/scrape/run',
      { method: 'POST', body: JSON.stringify({ provider, months }) },
    ),

  // Relabel a card's type for already-imported data (e.g. a Cal-format Diners card).
  setBatchProvider: (id: string, provider: string) =>
    req<{ ok: boolean; updated: number }>(`/api/import/batches/${id}/provider`, {
      method: 'PUT',
      body: JSON.stringify({ provider }),
    }),
  setBatchPeriod: (id: string, period: string) =>
    req<{ ok: boolean }>(`/api/import/batches/${id}/period`, { method: 'PUT', body: JSON.stringify({ period }) }),
  setBatchLabel: (id: string, label: string) =>
    req<{ ok: boolean; updated: number }>(`/api/import/batches/${id}/label`, { method: 'PUT', body: JSON.stringify({ label }) }),
  duplicateBatches: () =>
    req<{
      groups: Array<
        Array<{ id: string; filename: string | null; provider: string | null; accountLabel: string | null; period: string | null; rowCount: number; total: number; createdAt: string }>
      >;
    }>('/api/import/duplicates'),
  cleanDuplicateBatches: () =>
    req<{ ok: boolean; deleted: number }>('/api/import/duplicates/clean', { method: 'POST' }),

  // Credit-card reconciliation (bank settlement line ↔ itemized card charges)
  reconcile: () =>
    req<{
      matches: Array<{
        settlement: { id: string; date: string; amount: number; provider: string | null; merchant: string };
        matched: {
          provider: string | null;
          accountLabel: string | null;
          itemCount: number;
          sum: number;
          diff: number;
          status: 'exact' | 'close';
          items: Array<{ id: string; date: string; amount: number; merchant: string }>;
        } | null;
        nearest?: { provider: string | null; accountLabel: string | null; sum: number; diff: number } | null;
        status: 'matched' | 'unmatched';
      }>;
      settlementCount: number;
      matchedCount: number;
      settlementTotal: number;
      matchedCardTotal: number;
      unassignedCardTotal: number;
      unassignedCardCount: number;
      unmatchedSettlementTotal: number;
      missing: Array<{
        date: string;
        month: string;
        family: 'isracard' | 'cal';
        provider: string | null;
        amount: number;
        likelyFee: boolean;
        nearest: { accountLabel: string | null; diff: number } | null;
        cards: string[];
      }>;
    }>('/api/reconcile'),

  // Settings / data
  settings: () => req<any>('/api/settings'),
  setCurrency: (currency: string) =>
    req('/api/settings/currency', { method: 'PUT', body: JSON.stringify({ currency }) }),
  setDedup: (body: unknown) => req('/api/settings/dedup', { method: 'PUT', body: JSON.stringify(body) }),
  setAnomaly: (body: unknown) => req('/api/settings/anomaly', { method: 'PUT', body: JSON.stringify(body) }),
  setSalaryPayers: (payers: string[]) =>
    req<{ payers: string[]; tagged: number }>('/api/settings/salary', {
      method: 'PUT',
      body: JSON.stringify({ payers }),
    }),
  wipe: () => req('/api/wipe', { method: 'POST', body: JSON.stringify({ confirm: 'DELETE' }) }),
};
