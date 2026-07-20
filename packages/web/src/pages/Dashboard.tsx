import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { DashboardSummary } from '../api/client';
import { api } from '../api/client';
import { Bidi, Card, Spinner, StatCard } from '../components/ui';
import { formatMoney, formatMonth } from '../lib/format';

const PALETTE = [
  '#38bdf8', '#34d399', '#fbbf24', '#f472b6', '#a78bfa', '#fb7185',
  '#4ade80', '#facc15', '#22d3ee', '#c084fc', '#f97316', '#94a3b8',
];

export function Dashboard(): JSX.Element {
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const nav = useNavigate();

  useEffect(() => {
    api
      .dashboard()
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <Card><div className="text-rose-400">Failed to load: {error}</div></Card>;
  if (!data) return <Spinner label="Building dashboard…" />;

  const { totals, currency } = data;
  const empty = data.counts.ledger === 0;
  const goToMonth = () =>
    nav(`/transactions?from=${data.referenceMonth}-01&to=${data.referenceMonth}-31`);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <div className="text-sm text-muted">
          {data.counts.ledger} ledger entries · reference month {formatMonth(data.referenceMonth)}
        </div>
      </div>

      {empty && (
        <Card className="text-center py-10">
          <div className="text-lg mb-2">No data yet</div>
          <div className="text-muted text-sm">
            Head to <span className="text-brand">Import</span> to upload a bank or card export, or connect Gmail in{' '}
            <span className="text-brand">Settings</span>.
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <StatCard
          label="This month"
          value={formatMoney(totals.thisMonth, currency)}
          accent="neutral"
          sub={
            totals.momChangePct !== null
              ? `${totals.momChangePct >= 0 ? '▲' : '▼'} ${Math.abs(totals.momChangePct).toFixed(0)}% vs last`
              : undefined
          }
          onClick={goToMonth}
        />
        <StatCard label="Last month" value={formatMoney(totals.lastMonth, currency)} />
        <StatCard label="3-month avg" value={formatMoney(totals.threeMonthAvg, currency)} />
        <StatCard
          label="Alerts"
          value={String(data.counts.alerts)}
          accent={data.counts.alerts > 0 ? 'up' : 'neutral'}
          sub="possible double charges"
          onClick={() => nav('/duplicates')}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <h3 className="font-medium mb-3">Category breakdown · {formatMonth(data.referenceMonth)}</h3>
          {data.categoryBreakdown.length === 0 ? (
            <Empty />
          ) : (
            <div className="flex flex-col sm:flex-row items-center gap-4">
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={data.categoryBreakdown}
                    dataKey="amount"
                    nameKey="category"
                    innerRadius={55}
                    outerRadius={90}
                    paddingAngle={2}
                    onClick={(d: any) => nav(`/transactions?category=${encodeURIComponent(d.category)}`)}
                  >
                    {data.categoryBreakdown.map((_, i) => (
                      <Cell key={i} fill={PALETTE[i % PALETTE.length]} className="cursor-pointer" />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(v: number) => formatMoney(v, currency)}
                    contentStyle={TOOLTIP_STYLE}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="text-sm space-y-1 min-w-[140px]">
                {data.categoryBreakdown.slice(0, 8).map((c, i) => (
                  <button
                    key={c.category}
                    className="flex items-center justify-between gap-3 w-full hover:text-brand"
                    onClick={() => nav(`/transactions?category=${encodeURIComponent(c.category)}`)}
                  >
                    <span className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-sm" style={{ background: PALETTE[i % PALETTE.length] }} />
                      {c.category}
                    </span>
                    <span className="text-muted">{formatMoney(c.amount, currency)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </Card>

        <Card>
          <h3 className="font-medium mb-3">Spend over time</h3>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={data.spendOverTime}>
              <defs>
                <linearGradient id="spend" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#38bdf8" stopOpacity={0.5} />
                  <stop offset="100%" stopColor="#38bdf8" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="month" tickFormatter={formatMonth} stroke="#64748b" fontSize={11} />
              <YAxis stroke="#64748b" fontSize={11} width={45} />
              <Tooltip
                labelFormatter={formatMonth}
                formatter={(v: number) => formatMoney(v, currency)}
                contentStyle={TOOLTIP_STYLE}
              />
              <Area type="monotone" dataKey="expense" stroke="#38bdf8" fill="url(#spend)" />
            </AreaChart>
          </ResponsiveContainer>
        </Card>

        <Card>
          <h3 className="font-medium mb-3">Cash flow (income vs expense)</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={data.cashFlow}>
              <XAxis dataKey="month" tickFormatter={formatMonth} stroke="#64748b" fontSize={11} />
              <YAxis stroke="#64748b" fontSize={11} width={45} />
              <Tooltip
                labelFormatter={formatMonth}
                formatter={(v: number) => formatMoney(v, currency)}
                contentStyle={TOOLTIP_STYLE}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="income" fill="#34d399" />
              <Bar dataKey="expense" fill="#fb7185" />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card>
          <h3 className="font-medium mb-3">Top merchants · {formatMonth(data.referenceMonth)}</h3>
          {data.topMerchants.length === 0 ? (
            <Empty />
          ) : (
            <div className="space-y-2">
              {data.topMerchants.map((m) => {
                const max = data.topMerchants[0].amount || 1;
                return (
                  <button
                    key={m.merchant}
                    className="w-full text-left"
                    onClick={() => nav(`/transactions?merchant=${encodeURIComponent(m.merchant)}`)}
                  >
                    <div className="flex justify-between text-sm mb-0.5">
                      <Bidi>{m.merchant || '(unknown)'}</Bidi>
                      <span className="text-muted">{formatMoney(m.amount, currency)}</span>
                    </div>
                    <div className="h-1.5 bg-panel2 rounded">
                      <div className="h-full bg-brand rounded" style={{ width: `${(m.amount / max) * 100}%` }} />
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

const TOOLTIP_STYLE = { background: '#1e293b', border: '1px solid #334155', borderRadius: 8, color: '#e2e8f0' };

function Empty(): JSX.Element {
  return <div className="text-muted text-sm py-8 text-center">No data for this period.</div>;
}
