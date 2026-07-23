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
import type { DashboardSummary, Forecast } from '../api/client';
import { api } from '../api/client';
import { Donut, type DonutDatum } from '../components/Donut';
import { Bidi, Card, Skeleton, StatCard } from '../components/ui';
import { categoryColor } from '../lib/colors';
import { accountColor, accountLabel } from '../lib/accounts';
import { addMonths, currencySymbol, formatMoney, formatMonth, formatMonthLong } from '../lib/format';

// CSS variables resolve against the themed DOM, so the tooltip re-themes for free.
const TOOLTIP_STYLE = {
  background: 'rgb(var(--panel))',
  border: '1px solid rgb(var(--edge))',
  borderRadius: 10,
  color: 'rgb(var(--ink))',
};

/** Read theme-dependent chart colors (axis ticks, gridlines) from CSS variables.
 *  Recharts takes these as SVG stroke props, which don't resolve var(), so we
 *  read the computed values and recompute when the theme attribute flips. */
function useChartColors(): { axis: string; grid: string } {
  const read = (): { axis: string; grid: string } => {
    if (typeof window === 'undefined') return { axis: '#64748b', grid: '#e2e8f0' };
    const s = getComputedStyle(document.documentElement);
    return {
      axis: s.getPropertyValue('--chart-axis').trim() || '#64748b',
      grid: s.getPropertyValue('--chart-grid').trim() || '#e2e8f0',
    };
  };
  const [colors, setColors] = useState(read);
  useEffect(() => {
    const obs = new MutationObserver(() => setColors(read()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);
  return colors;
}

export function Dashboard(): JSX.Element {
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [month, setMonth] = useState<string | undefined>(undefined);
  const [curFilter, setCurFilter] = useState<string | undefined>(undefined);
  const chart = useChartColors();
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
  if (!data) return <DashboardSkeleton />;

  const { totals, currency } = data;
  const empty = data.counts.ledger === 0;
  // Income / net for the reference month (income split into salary vs other).
  const refFlow = data.cashFlow.find((c) => c.month === data.referenceMonth);
  const incomeThisMonth = data.income?.total ?? refFlow?.income ?? 0;
  const netThisMonth = refFlow?.net ?? incomeThisMonth - totals.thisMonth;
  const incomeSub =
    data.income && data.income.salary > 0
      ? `${formatMoney(data.income.salary, currency)} salary${data.income.other > 0.5 ? ` · ${formatMoney(data.income.other, currency)} other` : ''}`
      : 'tap to see deposits';
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
          <div className="text-4xl mb-3">📊</div>
          <div className="text-lg mb-1 font-medium">No data yet</div>
          <div className="text-muted text-sm mb-4">
            Upload a bank, card, or PayPal export — or connect email — to see your money at a glance.
          </div>
          <div className="flex items-center justify-center gap-2">
            <button
              onClick={() => nav('/import')}
              className="bg-brand text-brandink font-medium px-4 py-2 rounded-lg text-sm active:scale-[0.97] transition-transform"
            >
              Import a statement
            </button>
            <button
              onClick={() => nav('/settings')}
              className="border border-edge text-ink px-4 py-2 rounded-lg text-sm hover:border-brand transition-colors"
            >
              Connect email
            </button>
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
          sub={incomeSub}
          onClick={() => nav(`/transactions?from=${data.referenceMonth}-01&to=${data.referenceMonth}-31&flow=in`)}
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

      {/* Current balance + month-end forecast */}
      <ForecastCard f={data.forecast} nav={nav} />

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
                  <span className="tnum text-muted text-xs whitespace-nowrap">{formatMoney(c.amount, currency)}</span>
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
                <div className="tnum text-xl font-semibold mt-1">{formatMoney(c.expense, c.currency)}</div>
                {c.income > 0 && (
                  <div className="tnum text-xs text-emerald-400 mt-0.5">+ {formatMoney(c.income, c.currency)} in</div>
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
                    <span className="tnum text-muted whitespace-nowrap">{formatMoney(a.amount, currency)}</span>
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
            <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} vertical={false} />
            <XAxis dataKey="month" tickFormatter={formatMonth} stroke={chart.axis} fontSize={11} tickMargin={6} />
            <YAxis stroke={chart.axis} fontSize={11} width={52} tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : v)} />
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
            <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} vertical={false} />
            <XAxis dataKey="month" tickFormatter={formatMonth} stroke={chart.axis} fontSize={11} tickMargin={6} />
            <YAxis stroke={chart.axis} fontSize={11} width={52} tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : v)} />
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
                    <span className="tnum text-muted whitespace-nowrap">{formatMoney(m.amount, currency)}</span>
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

/** Current bank balance + projected end-of-month balance, with the breakdown
 *  behind the estimate. Updates on every dashboard load (i.e. every ledger change). */
function ForecastCard({ f, nav }: { f: Forecast; nav: (to: string) => void }): JSX.Element {
  const cur = f.currency;
  const monthName = formatMonthLong(`${f.month}-01`);
  const grew = f.projectedEndBalance != null && f.currentBalance != null && f.projectedEndBalance >= f.currentBalance;
  const asOf = f.asOf ? new Date(f.asOf).toLocaleDateString('he-IL') : null;
  return (
    <Card style={{ background: 'linear-gradient(135deg, #38bdf814, transparent 60%)' }}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-medium">💰 Balance &amp; forecast</h3>
        {f.hasBalance ? (
          <span className="text-[11px] text-muted">bank balance · as of {asOf}</span>
        ) : (
          <button onClick={() => nav('/settings')} className="text-xs text-brand">Sync bank →</button>
        )}
      </div>

      {f.hasBalance ? (
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-[11px] text-muted uppercase tracking-wide">Current balance</div>
            <div className="tnum text-2xl font-semibold leading-tight">{formatMoney(f.currentBalance ?? 0, cur)}</div>
          </div>
          <div>
            <div className="text-[11px] text-muted uppercase tracking-wide">Projected · end of {monthName}</div>
            <div className={`tnum text-2xl font-semibold leading-tight ${grew ? 'text-income' : 'text-expense'}`}>
              {formatMoney(f.projectedEndBalance ?? 0, cur)}
            </div>
          </div>
        </div>
      ) : (
        <div>
          <div className="text-[11px] text-muted uppercase tracking-wide">Projected net this month</div>
          <div className={`tnum text-2xl font-semibold leading-tight ${f.projectedNet >= 0 ? 'text-income' : 'text-expense'}`}>
            {formatMoney(f.projectedNet, cur, { sign: true })}
          </div>
          <div className="text-xs text-muted mt-1">Connect your bank in Settings to see your actual balance.</div>
        </div>
      )}

      {/* Safe-to-Spend — the "can I spend right now?" number */}
      <div className="mt-3 pt-3 border-t border-edge">
        <div className="flex items-end justify-between gap-3">
          <div>
            <div className="text-[11px] text-muted uppercase tracking-wide">Safe to spend / day</div>
            <div className={`tnum text-2xl font-semibold leading-tight ${f.safeToSpendPerDay > 0 ? 'text-ink' : 'text-expense'}`}>
              {formatMoney(f.safeToSpendPerDay, cur)}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[11px] text-muted uppercase tracking-wide">Left this month</div>
            <div className="tnum text-sm font-semibold">{formatMoney(Math.max(0, f.safeToSpendTotal), cur)}</div>
            <div className="text-[10px] text-muted">{f.daysLeftInMonth} days left · {formatMoney(f.remainingBills, cur)} bills due</div>
          </div>
        </div>
      </div>

      {/* Transparent breakdown behind the estimate */}
      <div className="mt-3 pt-3 border-t border-edge grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        <Metric label="Spent so far" value={formatMoney(f.monthToDate.spend, cur)} tone="expense" />
        <Metric label="Income so far" value={formatMoney(f.monthToDate.income, cur)} tone="income" />
        <Metric label="Expected more spend" value={formatMoney(f.expectedRemaining.spend, cur)} tone="expense" />
        <Metric label="Expected more income" value={formatMoney(f.expectedRemaining.income, cur)} tone="income" />
      </div>
      {f.simulation && (
        <div className="mt-3 pt-3 border-t border-edge">
          <div className="text-[11px] text-muted uppercase tracking-wide mb-1">Likely month-end net (simulated)</div>
          <div className="tnum text-sm">
            <span className="text-muted">P10</span> {formatMoney(f.simulation.p10, cur, { sign: true })}
            <span className="text-muted"> · median</span> {formatMoney(f.simulation.p50, cur, { sign: true })}
            <span className="text-muted"> · P90</span> {formatMoney(f.simulation.p90, cur, { sign: true })}
          </div>
          <div className={`text-xs mt-0.5 ${f.simulation.probNegativePct >= 40 ? 'text-expense' : 'text-muted'}`}>
            {f.simulation.probNegativePct}% chance you finish the month negative
          </div>
        </div>
      )}
      <div className="text-[10px] text-muted mt-2">
        Estimate — 3,000-run simulation from your recent monthly spread. Updates as new transactions arrive.
      </div>
    </Card>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone: 'income' | 'expense' }): JSX.Element {
  return (
    <div>
      <div className="text-muted">{label}</div>
      <div className={`tnum font-semibold ${tone === 'income' ? 'text-income' : 'text-expense'}`}>{value}</div>
    </div>
  );
}

/** Shaped placeholder shown while the dashboard loads — matches the real layout
 *  so the first paint doesn't jump (no lonely spinner, no layout shift). */
function DashboardSkeleton(): JSX.Element {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-40 hidden md:block" />
        <Skeleton className="h-10 w-44 rounded-full ml-auto" />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-2xl" />
        ))}
      </div>
      <Skeleton className="h-64 rounded-xl" />
      <Skeleton className="h-56 rounded-xl" />
    </div>
  );
}
