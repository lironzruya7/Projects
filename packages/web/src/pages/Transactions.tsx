import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { Account, Category, LedgerEntry } from '../api/client';
import { api } from '../api/client';
import { TransactionTable } from '../components/TransactionTable';
import { Button, Card, Skeleton } from '../components/ui';
import { accountLabel } from '../lib/accounts';
import { formatMoney } from '../lib/format';

export function Transactions(): JSX.Element {
  const [params, setParams] = useSearchParams();
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [currencies, setCurrencies] = useState<Array<{ currency: string; count: number }>>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(params.get('search') ?? '');

  const filters = {
    category: params.get('category') ?? undefined,
    sourceType: params.get('sourceType') ?? undefined,
    provider: params.get('provider') ?? undefined,
    accountLabel: params.get('accountLabel') ?? undefined,
    currency: params.get('currency') ?? undefined,
    flow: params.get('flow') ?? undefined,
    merchant: params.get('merchant') ?? undefined,
    from: params.get('from') ?? undefined,
    to: params.get('to') ?? undefined,
    search: params.get('search') ?? undefined,
    uncategorizedOnly: params.get('uncategorizedOnly') ?? undefined,
  };

  async function load(): Promise<void> {
    setLoading(true);
    const [tx, cats, accs, curs] = await Promise.all([
      api.transactions(filters),
      api.categories(),
      api.accounts(),
      api.currencies(),
    ]);
    setEntries(tx.transactions);
    setCategories(cats.categories);
    setAccounts(accs.accounts);
    setCurrencies(curs.currencies);
    setLoading(false);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.toString()]);

  function setFilter(key: string, value: string | undefined): void {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next);
  }

  // Spend per currency (summing across currencies is meaningless).
  const spendByCur = new Map<string, number>();
  for (const e of entries) {
    if (e.amount < 0) spendByCur.set(e.currency, (spendByCur.get(e.currency) ?? 0) + Math.abs(e.amount));
  }
  const spendParts = [...spendByCur.entries()].sort((a, b) => b[1] - a[1]).map(([c, v]) => formatMoney(v, c));

  const activeFilters = Object.entries(filters).filter(([, v]) => v);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="hidden md:block text-2xl font-semibold">Transactions</h1>
        <div className="tnum text-xs sm:text-sm text-muted">
          {entries.length} entries · spend {spendParts.length ? spendParts.join(' · ') : formatMoney(0)}
        </div>
      </div>

      <Card>
        <div className="flex flex-wrap gap-2 items-center">
          <input
            className="bg-panel2 border border-edge rounded-lg px-3 py-1.5 text-sm flex-1 min-w-[200px]"
            placeholder="Search merchant / description…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && setFilter('search', search || undefined)}
          />
          <select
            className="bg-panel2 border border-edge rounded-lg px-2 py-1.5 text-sm"
            value={filters.category ?? ''}
            onChange={(e) => setFilter('category', e.target.value || undefined)}
          >
            <option value="">All categories</option>
            <option value="Uncategorized">Uncategorized</option>
            {categories.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
          <select
            className="bg-panel2 border border-edge rounded-lg px-2 py-1.5 text-sm"
            value={filters.sourceType ?? ''}
            onChange={(e) => setFilter('sourceType', e.target.value || undefined)}
          >
            <option value="">All sources</option>
            <option value="bank">Bank</option>
            <option value="card">Card</option>
            <option value="email">Email</option>
            <option value="receipt">Receipt</option>
          </select>
          {accounts.some((a) => a.provider) && (
            <select
              className="bg-panel2 border border-edge rounded-lg px-2 py-1.5 text-sm"
              value={`${filters.provider ?? ''}::${filters.accountLabel ?? ''}`}
              onChange={(e) => {
                const [prov, label] = e.target.value.split('::');
                const next = new URLSearchParams(params);
                prov ? next.set('provider', prov) : next.delete('provider');
                label ? next.set('accountLabel', label) : next.delete('accountLabel');
                setParams(next);
              }}
            >
              <option value={'::'}>All accounts</option>
              {accounts
                .filter((a) => a.provider)
                .map((a) => (
                  <option key={`${a.provider}::${a.accountLabel ?? ''}`} value={`${a.provider}::${a.accountLabel ?? ''}`}>
                    {accountLabel(a.provider, a.sourceType, a.accountLabel)} ({a.count})
                  </option>
                ))}
            </select>
          )}
          {currencies.length > 1 && (
            <select
              className="bg-panel2 border border-edge rounded-lg px-2 py-1.5 text-sm"
              value={filters.currency ?? ''}
              onChange={(e) => setFilter('currency', e.target.value || undefined)}
            >
              <option value="">All currencies</option>
              {currencies.map((c) => (
                <option key={c.currency} value={c.currency}>
                  {c.currency} ({c.count})
                </option>
              ))}
            </select>
          )}
          <label className="flex items-center gap-1 text-xs text-muted">
            from
            <input
              type="date"
              style={{ colorScheme: 'dark' }}
              className="bg-panel2 border border-edge rounded-lg px-2 py-1.5 text-sm text-ink"
              value={filters.from ?? ''}
              onChange={(e) => setFilter('from', e.target.value || undefined)}
            />
          </label>
          <label className="flex items-center gap-1 text-xs text-muted">
            to
            <input
              type="date"
              style={{ colorScheme: 'dark' }}
              className="bg-panel2 border border-edge rounded-lg px-2 py-1.5 text-sm text-ink"
              value={filters.to ?? ''}
              onChange={(e) => setFilter('to', e.target.value || undefined)}
            />
          </label>
          {activeFilters.length > 0 && (
            <Button variant="ghost" onClick={() => setParams(new URLSearchParams())}>
              Clear
            </Button>
          )}
        </div>
      </Card>

      <Card>
        {loading ? <LedgerSkeleton /> : (
          <TransactionTable entries={entries} categories={categories} onChanged={load} />
        )}
      </Card>
    </div>
  );
}

/** Placeholder rows shaped like ledger entries while the list loads. */
function LedgerSkeleton(): JSX.Element {
  return (
    <div className="divide-y divide-edge/40">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-start gap-3 py-2.5">
          <Skeleton className="w-1.5 h-9 rounded-full shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0 space-y-2">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-3 w-1/3" />
          </div>
          <Skeleton className="h-4 w-16" />
        </div>
      ))}
    </div>
  );
}
