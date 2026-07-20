import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { Account, Category, LedgerEntry } from '../api/client';
import { api } from '../api/client';
import { TransactionTable } from '../components/TransactionTable';
import { Button, Card, Spinner } from '../components/ui';
import { accountLabel } from '../lib/accounts';
import { formatMoney } from '../lib/format';

export function Transactions(): JSX.Element {
  const [params, setParams] = useSearchParams();
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(params.get('search') ?? '');

  const filters = {
    category: params.get('category') ?? undefined,
    sourceType: params.get('sourceType') ?? undefined,
    provider: params.get('provider') ?? undefined,
    merchant: params.get('merchant') ?? undefined,
    from: params.get('from') ?? undefined,
    to: params.get('to') ?? undefined,
    search: params.get('search') ?? undefined,
    uncategorizedOnly: params.get('uncategorizedOnly') ?? undefined,
  };

  async function load(): Promise<void> {
    setLoading(true);
    const [tx, cats, accs] = await Promise.all([api.transactions(filters), api.categories(), api.accounts()]);
    setEntries(tx.transactions);
    setCategories(cats.categories);
    setAccounts(accs.accounts);
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

  const total = entries.reduce((s, e) => s + (e.amount < 0 ? Math.abs(e.amount) : 0), 0);
  const income = entries.reduce((s, e) => s + (e.amount > 0 ? e.amount : 0), 0);

  const activeFilters = Object.entries(filters).filter(([, v]) => v);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="hidden md:block text-2xl font-semibold">Transactions</h1>
        <div className="text-xs sm:text-sm text-muted">
          {entries.length} entries · spend {formatMoney(total)} · income {formatMoney(income)}
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
          </select>
          {accounts.some((a) => a.provider) && (
            <select
              className="bg-panel2 border border-edge rounded-lg px-2 py-1.5 text-sm"
              value={filters.provider ?? ''}
              onChange={(e) => setFilter('provider', e.target.value || undefined)}
            >
              <option value="">All accounts</option>
              {accounts
                .filter((a) => a.provider)
                .map((a) => (
                  <option key={a.provider} value={a.provider!}>
                    {accountLabel(a.provider, a.sourceType)} ({a.count})
                  </option>
                ))}
            </select>
          )}
          {activeFilters.length > 0 && (
            <Button variant="ghost" onClick={() => setParams(new URLSearchParams())}>
              Clear
            </Button>
          )}
        </div>
      </Card>

      <Card>
        {loading ? <Spinner label="Loading transactions…" /> : (
          <TransactionTable entries={entries} categories={categories} onChanged={load} />
        )}
      </Card>
    </div>
  );
}
