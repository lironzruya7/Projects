import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Anomaly, RecurringItem } from '../api/client';
import { api } from '../api/client';
import { Badge, Bidi, Card, Spinner } from '../components/ui';
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
      <h1 className="text-2xl font-semibold">Insights</h1>

      <Card>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-medium">Recurring & subscriptions</h3>
          {recurring.length > 0 && (
            <div className="text-sm text-muted">
              ≈ {formatMoney(monthlyTotal)}/mo · {formatMoney(annualTotal)}/yr
            </div>
          )}
        </div>
        {recurring.length === 0 ? (
          <div className="text-muted text-sm">No recurring charges detected yet (needs 3+ regular charges from a merchant).</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted text-left border-b border-edge">
                  <th className="py-2 pr-2 font-medium">Merchant</th>
                  <th className="py-2 pr-2 font-medium">Every</th>
                  <th className="py-2 pr-2 font-medium">Amount</th>
                  <th className="py-2 pr-2 font-medium">Next expected</th>
                  <th className="py-2 pr-2 font-medium text-right">Monthly</th>
                  <th className="py-2 pl-2 font-medium text-right">Annual</th>
                </tr>
              </thead>
              <tbody>
                {recurring.map((r) => (
                  <tr
                    key={r.merchant}
                    className="border-b border-edge/40 hover:bg-panel2/40 cursor-pointer"
                    onClick={() => nav(`/transactions?merchant=${encodeURIComponent(r.merchant)}`)}
                  >
                    <td className="py-2 pr-2">
                      <Bidi className="font-medium">{r.merchant}</Bidi>
                      {r.category && <span className="ml-2 text-xs text-muted">{r.category}</span>}
                    </td>
                    <td className="py-2 pr-2 text-muted">{r.intervalDays}d</td>
                    <td className="py-2 pr-2">{formatMoney(r.avgAmount, r.currency)}</td>
                    <td className="py-2 pr-2 text-muted">{formatDate(r.nextExpected)}</td>
                    <td className="py-2 pr-2 text-right">{formatMoney(r.monthlyCost, r.currency)}</td>
                    <td className="py-2 pl-2 text-right text-muted">{formatMoney(r.annualCost, r.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <h3 className="font-medium mb-3">Anomalies</h3>
        {anomalies.length === 0 ? (
          <div className="text-muted text-sm">Nothing unusual detected.</div>
        ) : (
          <div className="space-y-2">
            {anomalies.map((a, i) => (
              <div
                key={i}
                className="flex items-center justify-between border-b border-edge/40 py-2 text-sm cursor-pointer hover:bg-panel2/40"
                onClick={() => a.type === 'double_charge' ? nav('/duplicates') : nav(`/transactions?merchant=${encodeURIComponent(a.merchant)}`)}
              >
                <div className="flex items-center gap-2">
                  <AnomalyBadge type={a.type} />
                  <Bidi className="font-medium">{a.merchant || '(unknown)'}</Bidi>
                  <span className="text-muted text-xs">{a.detail}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span>{formatMoney(a.amount)}</span>
                  <span className="text-muted text-xs">{formatDate(a.date)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function AnomalyBadge({ type }: { type: Anomaly['type'] }): JSX.Element {
  if (type === 'spike') return <Badge tone="warn">spike</Badge>;
  if (type === 'new_merchant') return <Badge tone="email">new</Badge>;
  return <Badge tone="warn">double?</Badge>;
}
