import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { DashboardSummary } from '../api/client';
import { api } from '../api/client';
import { Donut, type DonutDatum } from '../components/Donut';
import { Bidi, Card, Spinner, StatCard } from '../components/ui';
import { categoryColor } from '../lib/colors';
import { accountColor, accountLabel } from '../lib/accounts';
import { addMonths, currencySymbol, formatMoney, formatMonth, formatMonthLong } from '../lib/format';

const TOOLTIP_STYLE = { background: '#1e293b', border: '1px solid #334155', borderRadius: 10, color: '#e2e8f0' };

export function Dashboard(): JSX.Element {
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [month, setMonth] = useState<string | undefined>(undefined);
  const [curFilter, setCurFilter] = useState<string | undefined>(undefined);
  const nav = useNavigate();

  useEffect(() => {
    const params: Record<string, string> = {};
    if (month) params.month = month;
    if (curFilter) params.currency = curFilter;
    api
      .dashboard(params)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [month, curFilter]);

  if (error) return <Card><div className="text-rose-400">Failed to load: {error}</div></Card>;
  if (!data) return <Spinner label="Building dashboard…" />;

  const { totals, currency } = data;
  const empty = data.counts.ledger === 0;
  // Income / net for the reference month, from the cash-flow series.
  const refFlow = data.cashFlow.find((c) => c.month === data.referenceMonth);
  const incomeThisMonth = refFlow?.income ?? 0;
  const netThisMonth = refFlow?.net ?? incomeThisMonth - totals.thisMonth;
  const cur = month ?? data.referenceMonth;
  const canPrev = cur > data.range.min;
  const canNext = cur < data.range.max;
  const goToMonth = () => nav(`/transactions?from=${data.referenceMonth}-01&to=${data.referenceMonth}-31`);

  const donutData: DonutDatum[] = data.categoryBreakdown.map((c) => ({
    name: c.category,
    value: c.amount,
    color: categoryColor(c.category),
  }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="hidden md:block text-2xl font-semibold">Dashboard</h1>
        {/* Month picker */}
        <div className="flex items-center gap-1 bg-panel border border-edge rounded-full px-1.5 py-1 ml-auto">
          <button
            className="w-8 h-8 rounded-full flex items-center justify-center text-lg disabled:opacity-30 active:bg-panel2"
            disabled={!canPrev}
            onClick={() => setMonth(addMonths(cur, -1))}
            aria-label="Previous month"
          >
            ‹
          </button>
          <button
            className="min-w-[7.5rem] text-center text-sm font-medium"
            onClick={() => setMonth(undefined)}
            title="Tap to jump to the latest month"
          >
            {formatMonthLong(cur)}
          </button>
          <button
            className="w-8 h-8 rounded-full flex items-center justify-center text-lg disabled:opacity-30 active:bg-panel2"
            disabled={!canNext}
            onClick={() => setMonth(addMonths(cur, 1))}
            aria-label="Next month"
          >
            ›
          </button>
        </div>
      </div>

      {/* Currency switcher — only when more than one currency is present */}
      {data.byCurrency.length > 1 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted">Currency:</span>
          {data.byCurrency.map((c) => (
            <button
              key={c.currency}
              onClick={() => setCurFilter(c.currency)}
              className={`px-3 py-1 rounded-full text-sm border transition-colors ${
                data.activeCurrency === c.currency ? 'border-brand text-brand bg-brand/10' : 'border-edge text-muted'
              }`}
            >
              {currencySymbol(c.currency)} {c.currency}
            </button>
          ))}
        </div>
      )}

      {empty && (
        <Card className="text-center py-10">
          <div className="text-lg mb-2">No data yet</div>
          <div className="text-muted text-sm">
            Go to <span className="text-brand">Import</span> to upload an export, or connect email in{' '}
            <span className="text-brand">More → Settings</span>.
          </div>
        </Card>
      )}

      {/* Colorful stat grid — 2 cols on phone, 4 on desktop */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label="This month"
          value={formatMoney(totals.thisMonth, currency)}
          tint="#38bdf8"
          icon="₪"
          sub={
            totals.momChangePct !== null
              ? `${totals.momChangePct >= 0 ? '▲' : '▼'} ${Math.abs(totals.momChangePct).toFixed(0)}% vs last`
              : undefined
          }
          onClick={goToMonth}
        />
        <StatCard
          label="Income"
          value={formatMoney(incomeThisMonth, currency)}
          tint="#34d399"
          icon="＋"
          sub="this month"
          onClick={() => nav(`/transactions?from=${data.referenceMonth}-01&to=${data.referenceMonth}-31`)}
        />
        <StatCard
          label="Net"
          value={formatMoney(netThisMonth, currency)}
          tint={netThisMonth >= 0 ? '#34d399' : '#fb7185'}
          icon="="
          accent={netThisMonth >= 0 ? 'down' : 'up'}
          sub="income − spend"
        />
        <StatCard label="Last month" value={formatMoney(totals.lastMonth, currency)} tint="#a78bfa" icon="↩" />
        <StatCard label="3-mo avg" value={formatMoney(totals.threeMonthAvg, currency)} tint="#38bdf8" icon="≈" />
        <StatCard
          label="Alerts"
          value={String(data.counts.alerts)}
          tint="#fb7185"
          icon="⚠"
          accent={data.counts.alerts > 0 ? 'up' : 'neutral'}
          sub="double charges"
          onClick={() => nav('/duplicates')}
        />
      </div>

      {/* Interactive donut + tappable legend */}
      <Card>
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-medium">Spending · {formatMonth(data.referenceMonth)}</h3>
          <span className="text-xs text-muted">tap a slice</span>
        </div>
        {donutData.length === 0 ? (
          <Empty />
        ) : (
          <div className="flex flex-col sm:flex-row items-center gap-4">
            <div className="w-full sm:w-1/2">
              <Donut
                data={donutData}
                currency={currency}
                height={230}
                onSlice={(name) => nav(`/transactions?category=${encodeURIComponent(name)}`)}
              />
            </div>
            <div className="w-full sm:w-1/2 grid grid-cols-2 sm:grid-cols-1 gap-1.5">
              {data.categoryBreakdown.slice(0, 8).map((c) => (
                <button
                  key={c.category}
                  className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-panel2 active:scale-[0.98] transition-all"
                  onClick={() => nav(`/transactions?category=${encodeURIComponent(c.category)}`)}
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="w-3 h-3 rounded-full shrink-0" style={{ background: categoryColor(c.category) }} />
                    <span className="truncate text-sm">{c.category}</span>
                  </span>
                  <span className="text-muted text-xs whitespace-nowrap">{formatMoney(c.amount, currency)}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </Card>

      {/* Currency center — totals per currency, side by side */}
      {data.byCurrency.length > 1 && (
        <Card>
          <h3 className="font-medium mb-3">By currency · {formatMonth(data.referenceMonth)}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {data.byCurrency.map((c) => (
              <button
                key={c.currency}
                onClick={() => nav(`/transactions?currency=${encodeURIComponent(c.currency)}`)}
                className={`rounded-xl border p-3 text-left active:scale-[0.98] transition-transform ${
                  data.activeCurrency === c.currency ? 'border-brand' : 'border-edge'
                }`}
              >
                <div className="text-xs text-muted flex items-center justify-between">
                  <span>{currencySymbol(c.currency)} {c.currency}</span>
                  <span>{c.count} txns</span>
                </div>
                <div className="text-xl font-semibold mt-1">{formatMoney(c.expense, c.currency)}</div>
                {c.income > 0 && (
                  <div className="text-xs text-emerald-400 mt-0.5">+ {formatMoney(c.income, c.currency)} in</div>
                )}
              </button>
            ))}
          </div>
        </Card>
      )}

      {/* Spending by account / card */}
      {data.byAccount.length > 0 && (
        <Card>
          <h3 className="font-medium mb-3">By account · {formatMonth(data.referenceMonth)}</h3>
          <div className="space-y-2.5">
            {data.byAccount.map((a) => {
              const max = data.byAccount[0]!.amount || 1;
              const color = accountColor(a.provider, a.sourceType, a.accountLabel);
              const label = accountLabel(a.provider, a.sourceType, a.accountLabel);
              return (
                <button
                  key={`${a.provider}|${a.accountLabel}|${a.sourceType}`}
                  className="w-full text-left active:scale-[0.99] transition-transform"
                  onClick={() => {
                    const p = new URLSearchParams();
                    if (a.provider) p.set('provider', a.provider);
                    else p.set('sourceType', a.sourceType);
                    if (a.accountLabel) p.set('accountLabel', a.accountLabel);
                    nav(`/transactions?${p.toString()}`);
                  }}
                >
                  <div className="flex justify-between items-center text-sm mb-1">
                    <span className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />
                      {label}
                      <span className="text-muted text-xs">· {a.count}</span>
                    </span>
                    <span className="text-muted whitespace-nowrap">{formatMoney(a.amount, currency)}</span>
                  </div>
                  <div className="h-2 bg-panel2 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${(a.amount / max) * 100}%`, background: color }} />
                  </div>
                </button>
              );
            })}
          </div>
        </Card>
      )}

      {/* Spend over time */}
      <Card>
        <h3 className="font-medium mb-3">Spend over time</h3>
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={data.spendOverTime} margin={{ left: -18, right: 6, top: 4 }}>
            <defs>
              <linearGradient id="spend" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#38bdf8" stopOpacity={0.55} />
                <stop offset="100%" stopColor="#38bdf8" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
            <XAxis dataKey="month" tickFormatter={formatMonth} stroke="#64748b" fontSize={11} tickMargin={6} />
            <YAxis stroke="#64748b" fontSize={11} width={52} tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : v)} />
            <Tooltip labelFormatter={formatMonth} formatter={(v: number) => formatMoney(v, currency)} contentStyle={TOOLTIP_STYLE} />
            <Area type="monotone" dataKey="expense" stroke="#38bdf8" strokeWidth={2} fill="url(#spend)" />
          </AreaChart>
        </ResponsiveContainer>
      </Card>

      {/* Cash flow */}
      <Card>
        <h3 className="font-medium mb-3">Cash flow</h3>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={data.cashFlow} margin={{ left: -18, right: 6, top: 4 }} barGap={2}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
            <XAxis dataKey="month" tickFormatter={formatMonth} stroke="#64748b" fontSize={11} tickMargin={6} />
            <YAxis stroke="#64748b" fontSize={11} width={52} tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : v)} />
            <Tooltip labelFormatter={formatMonth} formatter={(v: number) => formatMoney(v, currency)} contentStyle={TOOLTIP_STYLE} />
            <Bar dataKey="income" fill="#34d399" radius={[3, 3, 0, 0]} />
            <Bar dataKey="expense" fill="#fb7185" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
        <div className="flex gap-4 justify-center mt-2 text-xs">
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-400" />income</span>
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-rose-400" />expense</span>
        </div>
      </Card>

      {/* Top merchants */}
      <Card>
        <h3 className="font-medium mb-3">Top merchants · {formatMonth(data.referenceMonth)}</h3>
        {data.topMerchants.length === 0 ? (
          <Empty />
        ) : (
          <div className="space-y-2.5">
            {data.topMerchants.map((m, i) => {
              const max = data.topMerchants[0]!.amount || 1;
              const color = ['#38bdf8', '#34d399', '#fbbf24', '#f472b6', '#a78bfa'][i % 5];
              return (
                <button
                  key={m.merchant}
                  className="w-full text-left active:scale-[0.99] transition-transform"
                  onClick={() => nav(`/transactions?merchant=${encodeURIComponent(m.merchant)}`)}
                >
                  <div className="flex justify-between text-sm mb-1">
                    <Bidi className="truncate max-w-[60%]">{m.merchant || '(unknown)'}</Bidi>
                    <span className="text-muted whitespace-nowrap">{formatMoney(m.amount, currency)}</span>
                  </div>
                  <div className="h-2 bg-panel2 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${(m.amount / max) * 100}%`, background: color }} />
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}

function Empty(): JSX.Element {
  return <div className="text-muted text-sm py-8 text-center">No data for this period.</div>;
}
