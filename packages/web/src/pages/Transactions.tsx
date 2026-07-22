import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { Category, Account, LedgerEntry } from '../api/client';
import { api } from '../api/client';
import { TransactionTable } from '../components/TransactionTable';
import { Button, Card, Skeleton } from '../components/ui';
import { accountLabel } from '../lib/accounts';
import { categoryColor } from '../lib/colors';
import { formatMoney } from '../lib/format';

export function Transactions(): JSX.Element {
  const [params, setParams] = useSearchParams();
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [currencies, setCurrencies] = useState<Array<{ currency: string; count: number }>>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(params.get('search') ?? '');
  // Default to grouping the ledger by category (collapsible) so it's a tidy
  // summary you expand on demand, not one endless flat list.
  const [groupBy, setGroupBy] = useState<'category' | 'date'>('category');

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

  // Spend / income per currency (summing across currencies is meaningless).
  // Transfers are internal money movements (e.g. a bank paying off a credit
  // card) — counting them would double-count the itemized card charges, so they
  // are excluded from spend, income and net, exactly like the dashboard/insights
  // do. Card "positives" are refunds, not income, so they're excluded too.
  const spendByCur = new Map<string, number>();
  const incomeByCur = new Map<string, number>();
  let hasTransfers = false;
  for (const e of entries) {
    if (e.category === 'Transfers') { hasTransfers = true; continue; }
    if (e.amount < 0) spendByCur.set(e.currency, (spendByCur.get(e.currency) ?? 0) + Math.abs(e.amount));
    else if (e.sourceType !== 'card') incomeByCur.set(e.currency, (incomeByCur.get(e.currency) ?? 0) + e.amount);
  }
  const spendParts = [...spendByCur.entries()].sort((a, b) => b[1] - a[1]).map(([c, v]) => formatMoney(v, c));
  const incomeParts = [...incomeByCur.entries()].sort((a, b) => b[1] - a[1]).map(([c, v]) => formatMoney(v, c));
  // Net per currency: income − spend, shown only when there is income to net against.
  const netCurrencies = [...new Set([...spendByCur.keys(), ...incomeByCur.keys()])];
  const netParts = netCurrencies
    .map((c) => (incomeByCur.get(c) ?? 0) - (spendByCur.get(c) ?? 0))
    .map((v, i) => formatMoney(v, netCurrencies[i]!, { sign: true }));

  const activeFilters = Object.entries(filters).filter(([, v]) => v);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="hidden md:block text-2xl font-semibold">Transactions</h1>
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

              className="bg-panel2 border border-edge rounded-lg px-2 py-1.5 text-sm text-ink"
              value={filters.from ?? ''}
              onChange={(e) => setFilter('from', e.target.value || undefined)}
            />
          </label>
          <label className="flex items-center gap-1 text-xs text-muted">
            to
            <input
              type="date"

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

      {/* Final totals for the current filter — the "how much in this view" answer. */}
      {!loading && (
        <Card>
          <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
            <div>
              <div className="text-[11px] text-muted uppercase tracking-wide">Total spend</div>
              <div className="tnum text-2xl font-semibold text-expense leading-tight">
                {spendParts.length ? spendParts.map((p) => `-${p}`).join(' · ') : formatMoney(0)}
              </div>
              {hasTransfers && <div className="text-[10px] text-muted mt-0.5">excludes transfers</div>}
            </div>
            {incomeParts.length > 0 && (
              <div>
                <div className="text-[11px] text-muted uppercase tracking-wide">Income</div>
                <div className="tnum text-2xl font-semibold text-income leading-tight">
                  {incomeParts.map((p) => `+${p}`).join(' · ')}
                </div>
              </div>
            )}
            {incomeParts.length > 0 && (
              <div>
                <div className="text-[11px] text-muted uppercase tracking-wide">Net</div>
                <div className="tnum text-2xl font-semibold text-ink leading-tight">{netParts.join(' · ')}</div>
              </div>
            )}
            <div className="tnum ml-auto text-sm text-muted self-center">{entries.length} entries</div>
          </div>
        </Card>
      )}

      {/* View switch: grouped-by-category (default) vs a flat date-sorted list. */}
      {!loading && entries.length > 0 && (
        <div className="flex items-center gap-1 text-sm">
          <span className="text-xs text-muted mr-1">View:</span>
          <button
            onClick={() => setGroupBy('category')}
            className={`px-3 py-1 rounded-full border transition-colors ${groupBy === 'category' ? 'border-brand text-brand bg-brand/10' : 'border-edge text-muted'}`}
          >
            By category
          </button>
          <button
            onClick={() => setGroupBy('date')}
            className={`px-3 py-1 rounded-full border transition-colors ${groupBy === 'date' ? 'border-brand text-brand bg-brand/10' : 'border-edge text-muted'}`}
          >
            By date
          </button>
        </div>
      )}

      <Card>
        {loading ? (
          <LedgerSkeleton />
        ) : groupBy === 'category' ? (
          <CategoryGroups entries={entries} categories={categories} onChanged={load} />
        ) : (
          <TransactionTable entries={entries} categories={categories} onChanged={load} />
        )}
      </Card>
    </div>
  );
}

/** Collapsible category sections, biggest spend first. Each header shows the
 *  category, its share, and its total; expand to see that category's entries. */
function CategoryGroups({
  entries,
  categories,
  onChanged,
}: {
  entries: LedgerEntry[];
  categories: Category[];
  onChanged: () => void;
}): JSX.Element {
  const groups = useMemo(() => {
    const map = new Map<string, LedgerEntry[]>();
    for (const e of entries) {
      const key = e.category ?? 'Uncategorized';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(e);
    }
    return [...map.entries()]
      .map(([key, list]) => {
        // Signed net per currency (so an income/salary group reads as +, not 0),
        // plus a magnitude for ordering biggest-first.
        const net = new Map<string, number>();
        let magnitude = 0;
        for (const e of list) {
          net.set(e.currency, (net.get(e.currency) ?? 0) + e.amount);
          magnitude += Math.abs(e.amount);
        }
        const sorted = [...net.entries()].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
        // Signed: income shows +…, expenses show -… (formatMoney adds the minus).
        const parts = sorted.map(([c, v]) => (v >= 0 ? `+${formatMoney(v, c)}` : formatMoney(v, c)));
        const positive = (sorted[0]?.[1] ?? 0) > 0;
        return { key, list, parts, magnitude, count: list.length, positive };
      })
      .sort((a, b) => b.magnitude - a.magnitude);
  }, [entries]);

  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (key: string): void =>
    setOpen((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  if (entries.length === 0) {
    return <div className="text-muted text-sm py-8 text-center">No transactions match.</div>;
  }

  return (
    <div className="divide-y divide-edge/40">
      {groups.map((g) => {
        const isOpen = open.has(g.key);
        const color = categoryColor(g.key);
        return (
          <div key={g.key}>
            <button
              onClick={() => toggle(g.key)}
              className="w-full flex items-center gap-3 py-3 text-left active:scale-[0.997] transition-transform"
              aria-expanded={isOpen}
            >
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} />
              <span className="font-medium">{g.key}</span>
              <span className="text-muted text-xs">{g.count}</span>
              {g.key === 'Transfers' && (
                <span className="text-[10px] text-muted border border-edge rounded-full px-1.5 py-0.5">not counted</span>
              )}
              <span className={`tnum ml-auto text-sm font-semibold whitespace-nowrap ${g.positive ? 'text-income' : 'text-expense'}`}>
                {g.parts.length ? g.parts.join(' · ') : formatMoney(0)}
              </span>
              <span className={`text-muted text-xs w-4 text-center transition-transform ${isOpen ? 'rotate-180' : ''}`}>▾</span>
            </button>
            {isOpen && (
              <div className="pb-2">
                <TransactionTable entries={g.list} categories={categories} onChanged={onChanged} />
              </div>
            )}
          </div>
        );
      })}
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
