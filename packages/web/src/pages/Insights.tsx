import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Anomaly, RecurringItem } from '../api/client';
import { api } from '../api/client';
import { Bidi, Card, Spinner, StatCard } from '../components/ui';
import { categoryColor } from '../lib/colors';
import { formatDate, formatMoney } from '../lib/format';

export function Insights(): JSX.Element {
  const [recurring, setRecurring] = useState<RecurringItem[]>([]);
  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
  const [loading, setLoading] = useState(true);
  const nav = useNavigate();

  useEffect(() => {
    Promise.all([api.recurring(), api.anomalies()]).then(([r, a]) => {
      setRecurring(r.recurring);
      setAnomalies(a.anomalies);
      setLoading(false);
    });
  }, []);

  if (loading) return <Spinner label="Analyzing…" />;

  const monthlyTotal = recurring.reduce((s, r) => s + r.monthlyCost, 0);
  const annualTotal = recurring.reduce((s, r) => s + r.annualCost, 0);

  return (
    <div className="space-y-4">
      <h1 className="hidden md:block text-2xl font-semibold">Insights</h1>

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
