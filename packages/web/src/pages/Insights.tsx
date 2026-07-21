import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Anomaly, RecommendationReport, RecurringItem } from '../api/client';
import { api } from '../api/client';
import { Bidi, Card, Spinner, StatCard } from '../components/ui';
import { categoryColor } from '../lib/colors';
import { formatDate, formatMoney } from '../lib/format';

const REC_ICON: Record<string, string> = {
  overlap: '🔁',
  recurring: '↻',
  rare: '💤',
  'top-category': '🎯',
  'spike-fee': '⚠️',
};

export function Insights(): JSX.Element {
  const [recurring, setRecurring] = useState<RecurringItem[]>([]);
  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
  const [rec, setRec] = useState<RecommendationReport | null>(null);
  const [loading, setLoading] = useState(true);
  const nav = useNavigate();

  useEffect(() => {
    Promise.all([api.recurring(), api.anomalies(), api.recommendations()]).then(([r, a, rc]) => {
      setRecurring(r.recurring);
      setAnomalies(a.anomalies);
      setRec(rc);
      setLoading(false);
    });
  }, []);

  if (loading) return <Spinner label="Analyzing…" />;

  const monthlyTotal = recurring.reduce((s, r) => s + r.monthlyCost, 0);
  const annualTotal = recurring.reduce((s, r) => s + r.annualCost, 0);
  const cur = rec?.currency ?? 'ILS';

  return (
    <div className="space-y-4">
      <h1 className="hidden md:block text-2xl font-semibold">Insights & recommendations</h1>

      {rec && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <StatCard label="Avg spend / month" value={formatMoney(rec.totalMonthlySpend, cur)} tint="#fb7185" icon="↓" sub={`over ${rec.monthsAnalyzed} mo`} />
            <StatCard label="Possible savings / mo" value={formatMoney(rec.potentialMonthlySavings, cur)} tint="#34d399" icon="✂" sub="from tips below" />
          </div>

          {rec.recommendations.length > 0 && (
            <Card>
              <h3 className="font-medium mb-3">💡 Recommendations</h3>
              <div className="space-y-2">
                {rec.recommendations.map((r, i) => (
                  <div key={i} className="flex items-start gap-3 rounded-xl border border-edge bg-panel2/30 p-3">
                    <span className="text-xl shrink-0">{REC_ICON[r.kind] ?? '•'}</span>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium">{r.title}</div>
                      <div className="text-xs text-muted mt-0.5 rtl-aware" dir="auto">{r.detail}</div>
                    </div>
                    {r.monthlySaving > 0 && (
                      <div className="text-right shrink-0">
                        <div className="text-emerald-400 font-semibold text-sm">-{formatMoney(r.monthlySaving, cur)}</div>
                        <div className="text-[10px] text-muted">/mo</div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          )}

          {rec.topCategories.length > 0 && (
            <Card>
              <h3 className="font-medium mb-3">Where the money goes</h3>
              <div className="space-y-2.5">
                {rec.topCategories.map((c) => {
                  const color = categoryColor(c.category);
                  const max = rec.topCategories[0]!.monthlyAvg || 1;
                  return (
                    <button
                      key={c.category}
                      onClick={() => nav(`/transactions?category=${encodeURIComponent(c.category)}`)}
                      className="w-full text-left active:scale-[0.99] transition-transform"
                    >
                      <div className="flex justify-between items-center text-sm mb-1">
                        <span className="flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />
                          {c.category}
                          <span className="text-muted text-xs">· {c.pct.toFixed(0)}%</span>
                        </span>
                        <span className="text-muted whitespace-nowrap">{formatMoney(c.monthlyAvg, cur)}/mo</span>
                      </div>
                      <div className="h-2 bg-panel2 rounded-full overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${(c.monthlyAvg / max) * 100}%`, background: color }} />
                      </div>
                    </button>
                  );
                })}
              </div>
            </Card>
          )}

          {rec.serviceGroups.some((g) => g.overlapping) && (
            <Card>
              <h3 className="font-medium mb-1">Overlapping services</h3>
              <p className="text-xs text-muted mb-3">Multiple services of the same kind — candidates to consolidate.</p>
              <div className="space-y-3">
                {rec.serviceGroups.filter((g) => g.overlapping).map((g) => (
                  <div key={g.key} className="rounded-xl border border-edge bg-panel2/30 p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-medium">{g.label} <span className="text-muted text-xs">· {g.merchants.length}</span></span>
                      <span className="text-sm font-semibold">{formatMoney(g.monthlyCost, cur)}<span className="text-muted text-xs">/mo</span></span>
                    </div>
                    <div className="space-y-1">
                      {g.merchants.map((m) => (
                        <button
                          key={m.merchant}
                          onClick={() => nav(`/transactions?merchant=${encodeURIComponent(m.merchant)}`)}
                          className="w-full flex items-center justify-between gap-2 text-xs"
                        >
                          <Bidi className="truncate text-muted">{m.merchant}</Bidi>
                          <span className="whitespace-nowrap">{formatMoney(m.monthlyCost, cur)}/mo · {m.count} charge{m.count === 1 ? '' : 's'}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </>
      )}

      {recurring.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          <StatCard label="Recurring / month" value={formatMoney(monthlyTotal)} tint="#22d3ee" icon="↻" />
          <StatCard label="Recurring / year" value={formatMoney(annualTotal)} tint="#a78bfa" icon="∑" />
        </div>
      )}

      <Card>
        <h3 className="font-medium mb-3">Recurring & subscriptions</h3>
        {recurring.length === 0 ? (
          <div className="text-muted text-sm">No recurring charges detected yet (needs 3+ regular charges from a merchant).</div>
        ) : (
          <div className="space-y-2">
            {recurring.map((r) => {
              const color = categoryColor(r.category);
              return (
                <button
                  key={r.merchant}
                  onClick={() => nav(`/transactions?merchant=${encodeURIComponent(r.merchant)}`)}
                  className="w-full flex items-center gap-3 rounded-xl border border-edge bg-panel2/30 p-3 text-left active:scale-[0.99] transition-transform"
                >
                  <span className="w-1.5 h-10 rounded-full shrink-0" style={{ background: color }} />
                  <div className="flex-1 min-w-0">
                    <Bidi className="font-medium truncate block">{r.merchant}</Bidi>
                    <div className="text-xs text-muted mt-0.5 flex items-center gap-2 flex-wrap">
                      <span>every {r.intervalDays}d</span>
                      <span>· next {formatDate(r.nextExpected)}</span>
                      {r.category && (
                        <span className="px-1.5 py-0.5 rounded-full font-medium" style={{ background: `${color}22`, color }}>
                          {r.category}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-semibold">{formatMoney(r.monthlyCost, r.currency)}<span className="text-muted text-xs">/mo</span></div>
                    <div className="text-xs text-muted">{formatMoney(r.annualCost, r.currency)}/yr</div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </Card>

      <Card>
        <h3 className="font-medium mb-3">Anomalies</h3>
        {anomalies.length === 0 ? (
          <div className="text-muted text-sm">Nothing unusual detected.</div>
        ) : (
          <div className="space-y-2">
            {anomalies.map((a, i) => {
              const meta = anomalyMeta(a.type);
              return (
                <button
                  key={i}
                  onClick={() => (a.type === 'double_charge' ? nav('/duplicates') : nav(`/transactions?merchant=${encodeURIComponent(a.merchant)}`))}
                  className="w-full flex items-center gap-3 rounded-xl border border-edge bg-panel2/30 p-3 text-left active:scale-[0.99] transition-transform"
                >
                  <span className="w-1.5 h-10 rounded-full shrink-0" style={{ background: meta.color }} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs px-1.5 py-0.5 rounded-full font-medium" style={{ background: `${meta.color}22`, color: meta.color }}>
                        {meta.label}
                      </span>
                      <Bidi className="font-medium truncate">{a.merchant || '(unknown)'}</Bidi>
                    </div>
                    <div className="text-xs text-muted mt-0.5 rtl-aware" dir="auto">{a.detail}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-semibold">{formatMoney(a.amount)}</div>
                    <div className="text-xs text-muted">{formatDate(a.date)}</div>
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

function anomalyMeta(type: Anomaly['type']): { label: string; color: string } {
  if (type === 'spike') return { label: 'spike', color: '#fb7185' };
  if (type === 'new_merchant') return { label: 'new', color: '#fbbf24' };
  return { label: 'double?', color: '#f472b6' };
}
