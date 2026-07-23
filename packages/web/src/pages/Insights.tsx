import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Anomaly, BudgetsReport, Goal, RecommendationReport, RecurringItem, UpcomingReport } from '../api/client';
import { api } from '../api/client';
import { Bidi, Button, Card, Skeleton, StatCard } from '../components/ui';
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
  const [upcoming, setUpcoming] = useState<UpcomingReport | null>(null);
  const [budgets, setBudgets] = useState<BudgetsReport | null>(null);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const nav = useNavigate();

  useEffect(() => {
    Promise.all([api.recurring(), api.anomalies(), api.recommendations(), api.upcoming(), api.budgets(), api.goals()]).then(
      ([r, a, rc, up, bg, gl]) => {
        setRecurring(r.recurring);
        setAnomalies(a.anomalies);
        setRec(rc);
        setUpcoming(up);
        setBudgets(bg);
        setGoals(gl.goals);
        setLoading(false);
      },
    );
  }, []);

  if (loading) return <InsightsSkeleton />;

  const monthlyTotal = recurring.reduce((s, r) => s + r.monthlyCost, 0);
  const annualTotal = recurring.reduce((s, r) => s + r.annualCost, 0);
  const cur = rec?.currency ?? 'ILS';

  return (
    <div className="space-y-4">
      <h1 className="hidden md:block text-2xl font-semibold">Insights & recommendations</h1>

      <GoalsCard goals={goals} onChange={setGoals} />

      {budgets && budgets.items.length > 0 && <BudgetsCard report={budgets} onChange={setBudgets} />}

      {upcoming && upcoming.items.length > 0 && (
        <Card>
          <div className="flex items-center justify-between mb-1">
            <h3 className="font-medium">📅 Upcoming bills</h3>
            <span className="tnum text-sm text-muted">{formatMoney(upcoming.total, upcoming.currency)} in ~6 weeks</span>
          </div>
          {upcoming.lowPoint && upcoming.startingBalance != null && (
            <p className={`text-xs mb-2 ${upcoming.lowPoint.balance < 0 ? 'text-expense' : 'text-muted'}`}>
              Tightest day: {formatDate(upcoming.lowPoint.date)} → projected balance{' '}
              <span className="tnum font-medium">{formatMoney(upcoming.lowPoint.balance, upcoming.currency)}</span>
            </p>
          )}
          <div className="divide-y divide-edge/40">
            {upcoming.items.map((b, i) => {
              const color = categoryColor(b.category);
              return (
                <button
                  key={i}
                  onClick={() => nav(`/transactions?merchant=${encodeURIComponent(b.merchant)}`)}
                  className="w-full flex items-center gap-3 py-2 text-left active:scale-[0.997] transition-transform"
                >
                  <span className="w-1.5 h-8 rounded-full shrink-0" style={{ background: color }} />
                  <div className="flex-1 min-w-0">
                    <Bidi className="text-sm font-medium truncate block">{b.merchant}</Bidi>
                    <div className="text-xs text-muted">{formatDate(b.date)}{b.category ? ` · ${b.category}` : ''}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="tnum text-sm font-semibold text-expense">-{formatMoney(b.amount, upcoming.currency)}</div>
                    {b.balanceAfter != null && (
                      <div className={`tnum text-[10px] ${b.balanceAfter < 0 ? 'text-expense' : 'text-muted'}`}>
                        → {formatMoney(b.balanceAfter, upcoming.currency)}
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </Card>
      )}

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
                        <div className="tnum text-emerald-400 font-semibold text-sm">-{formatMoney(r.monthlySaving, cur)}</div>
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
                        <span className="tnum text-muted whitespace-nowrap">{formatMoney(c.monthlyAvg, cur)}/mo</span>
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
                      <span className="tnum text-sm font-semibold">{formatMoney(g.monthlyCost, cur)}<span className="text-muted text-xs">/mo</span></span>
                    </div>
                    <div className="space-y-1">
                      {g.merchants.map((m) => (
                        <button
                          key={m.merchant}
                          onClick={() => nav(`/transactions?merchant=${encodeURIComponent(m.merchant)}`)}
                          className="w-full flex items-center justify-between gap-2 text-xs"
                        >
                          <Bidi className="truncate text-muted">{m.merchant}</Bidi>
                          <span className="tnum whitespace-nowrap">{formatMoney(m.monthlyCost, cur)}/mo · {m.count} charge{m.count === 1 ? '' : 's'}</span>
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
                    <div className="flex items-center gap-2">
                      <Bidi className="font-medium truncate">{r.merchant}</Bidi>
                      {r.priceChangePct != null && (
                        <span
                          className="text-[10px] rounded-full px-1.5 py-0.5 font-semibold shrink-0"
                          style={{ color: r.priceChangePct > 0 ? 'var(--expense)' : 'var(--income)', border: `1px solid ${r.priceChangePct > 0 ? 'var(--expense)' : 'var(--income)'}` }}
                          title={`was ${formatMoney(r.avgAmount, r.currency)}, now ${formatMoney(r.currentAmount, r.currency)}`}
                        >
                          {r.priceChangePct > 0 ? '↑' : '↓'} {Math.abs(r.priceChangePct)}%
                        </span>
                      )}
                      {r.isNew && (
                        <span className="text-[10px] rounded-full px-1.5 py-0.5 font-medium shrink-0" style={{ color: 'var(--warning)', border: '1px solid var(--warning)' }} title="First charge is recent — could be a converted free trial">
                          new
                        </span>
                      )}
                    </div>
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
                    <div className="tnum font-semibold">{formatMoney(r.monthlyCost, r.currency)}<span className="text-muted text-xs">/mo</span></div>
                    <div className="tnum text-xs text-muted">{formatMoney(r.annualCost, r.currency)}/yr</div>
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
                    <div className="tnum font-semibold">{formatMoney(a.amount)}</div>
                    <div className="tnum text-xs text-muted">{formatDate(a.date)}</div>
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

/** Shaped placeholder shown while insights are computed. */
function InsightsSkeleton(): JSX.Element {
  return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-64 hidden md:block" />
      <div className="grid grid-cols-2 gap-3">
        <Skeleton className="h-24 rounded-2xl" />
        <Skeleton className="h-24 rounded-2xl" />
      </div>
      <Skeleton className="h-40 rounded-xl" />
      <Skeleton className="h-56 rounded-xl" />
    </div>
  );
}

/** Monthly category budgets: progress bar per category + an inline editable limit. */
function BudgetsCard({ report, onChange }: { report: BudgetsReport; onChange: (r: BudgetsReport) => void }): JSX.Element {
  const cur = report.currency;
  const budgeted = report.items.filter((b) => b.limit > 0);
  const totalLimit = budgeted.reduce((s, b) => s + b.limit, 0);
  const totalSpent = budgeted.reduce((s, b) => s + b.spent, 0);
  return (
    <Card>
      <div className="flex items-center justify-between mb-1">
        <h3 className="font-medium">🎯 Budgets</h3>
        {totalLimit > 0 && (
          <span className={`tnum text-sm ${totalSpent > totalLimit ? 'text-expense' : 'text-muted'}`}>
            {formatMoney(totalSpent, cur)} / {formatMoney(totalLimit, cur)}
          </span>
        )}
      </div>
      <p className="text-xs text-muted mb-3">Set a monthly limit per category — leave blank to remove.</p>
      <div className="space-y-2.5">
        {report.items.map((b) => (
          <BudgetRow key={b.category} b={b} cur={cur} onSaved={onChange} />
        ))}
      </div>
    </Card>
  );
}

function BudgetRow({
  b,
  cur,
  onSaved,
}: {
  b: BudgetsReport['items'][number];
  cur: string;
  onSaved: (r: BudgetsReport) => void;
}): JSX.Element {
  const [value, setValue] = useState(b.limit > 0 ? String(b.limit) : '');
  const [busy, setBusy] = useState(false);
  const color = categoryColor(b.category);
  const pct = b.limit > 0 ? Math.min(100, b.pct) : 0;
  async function save(): Promise<void> {
    const n = Number(value);
    if ((b.limit === 0 && !value) || n === b.limit) return;
    setBusy(true);
    try {
      onSaved(await api.setBudget(b.category, Number.isFinite(n) ? n : 0));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <div className="flex items-center gap-2 text-sm mb-1">
        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} />
        <span className="flex-1 truncate">{b.category}</span>
        <span className={`tnum text-xs ${b.over ? 'text-expense' : 'text-muted'}`}>
          {formatMoney(b.spent, cur)}{b.limit > 0 ? ` / ${formatMoney(b.limit, cur)}` : ''}
        </span>
        <input
          className="input w-20 !mt-0 text-xs text-right"
          inputMode="numeric"
          placeholder="limit"
          value={value}
          disabled={busy}
          onChange={(e) => setValue(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
      </div>
      {b.limit > 0 && (
        <div className="h-2 bg-panel2 rounded-full overflow-hidden">
          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: b.over ? 'var(--expense)' : color }} />
        </div>
      )}
    </div>
  );
}

function anomalyMeta(type: Anomaly['type']): { label: string; color: string } {
  if (type === 'spike') return { label: 'spike', color: '#fb7185' };
  if (type === 'new_merchant') return { label: 'new', color: '#fbbf24' };
  return { label: 'double?', color: '#f472b6' };
}

/** Savings goals: target + optional deadline, progress from net cashflow since start. */
function GoalsCard({ goals, onChange }: { goals: Goal[]; onChange: (g: Goal[]) => void }): JSX.Element {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (): Promise<void> => {
    const targetAmount = Number(amount);
    if (!name.trim() || !targetAmount || targetAmount <= 0) return;
    setBusy(true);
    try {
      const r = await api.addGoal({ name: name.trim(), targetAmount, targetDate: date || null });
      onChange(r.goals);
      setName(''); setAmount(''); setDate(''); setAdding(false);
    } finally { setBusy(false); }
  };
  const remove = async (id: string): Promise<void> => {
    const r = await api.deleteGoal(id);
    onChange(r.goals);
  };

  return (
    <Card>
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-medium">🎯 Savings goals</h3>
        <button className="text-brand text-sm" onClick={() => setAdding((v) => !v)}>{adding ? 'Cancel' : '+ Add goal'}</button>
      </div>

      {adding && (
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 mb-3">
          <input className="input" placeholder="Name (e.g. Emergency fund)" value={name} onChange={(e) => setName(e.target.value)} />
          <input className="input" type="number" inputMode="numeric" placeholder="Target amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <Button onClick={submit} disabled={busy}>Save</Button>
        </div>
      )}

      {goals.length === 0 ? (
        <div className="text-muted text-sm">No goals yet. Add one to track progress from your net savings.</div>
      ) : (
        <div className="space-y-3">
          {goals.map((g) => {
            const color = g.onTrack === false ? 'var(--expense)' : 'var(--income)';
            return (
              <div key={g.id}>
                <div className="flex items-center justify-between text-sm mb-1">
                  <span className="font-medium">{g.name}</span>
                  <span className="tnum text-muted">
                    {formatMoney(g.saved, g.currency)} / {formatMoney(g.target_amount, g.currency)} ({g.pct}%)
                    <button className="ml-2 text-muted hover:text-rose-400" title="Delete" onClick={() => remove(g.id)}>✕</button>
                  </span>
                </div>
                <div className="h-2 bg-panel2 rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${g.pct}%`, background: color }} />
                </div>
                <div className="text-xs text-muted mt-0.5 flex flex-wrap gap-x-3">
                  <span>~{formatMoney(g.monthlyRate, g.currency)}/mo saved</span>
                  {g.etaMonths != null && <span>· ETA ~{g.etaMonths} mo</span>}
                  {g.etaMonths == null && g.pct < 100 && <span>· not saving yet</span>}
                  {g.target_date && <span>· by {formatDate(g.target_date)} {g.onTrack === true ? '· on track ✓' : g.onTrack === false ? '· behind' : ''}</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
