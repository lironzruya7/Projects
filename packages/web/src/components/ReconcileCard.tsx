import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { Badge, Bidi, Button, Card, Spinner } from './ui';
import { formatDate, formatMoney } from '../lib/format';
import { accountColor, accountLabel } from '../lib/accounts';

type Recon = Awaited<ReturnType<typeof api.reconcile>>;

/**
 * Credit-card reconciliation: each bank "credit card" settlement line matched to
 * the itemized card charges that sum to it. Confirms the aggregate bank charge
 * (tagged Transfers, excluded from spend) lines up with the card detail.
 */
export function ReconcileCard({ currency = 'ILS' }: { currency?: string }): JSX.Element {
  const [data, setData] = useState<Recon | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  async function load(): Promise<void> {
    setBusy(true);
    setErr(null);
    try {
      setData(await api.reconcile());
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);

  return (
    <Card>
      <div className="flex items-center justify-between gap-2 mb-1">
        <h3 className="font-medium">🔗 Credit-card reconciliation</h3>
        <Button variant="ghost" onClick={load} disabled={busy}>
          {busy ? '…' : 'Refresh'}
        </Button>
      </div>
      <p className="text-xs text-muted mb-3">
        Your bank's aggregate “credit card” charge is matched to the itemized card purchases that sum to it. Those bank
        lines are tagged <b>Transfers</b> (excluded from spending) so nothing is counted twice.
      </p>

      {err && <div className="text-rose-400 text-sm">{err}</div>}
      {busy && !data && <Spinner label="Reconciling…" />}

      {data && (
        <>
          {data.settlementCount === 0 ? (
            <div className="text-sm text-muted">
              No bank credit-card settlement lines found yet. Import your Bank Yahav statement so its “כרטיסי אשראי”
              charges can be matched to the card detail.
            </div>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2 mb-3 text-center">
                <Stat label="Settlements" value={`${data.matchedCount}/${data.settlementCount}`} hint="matched" />
                <Stat label="Bank total" value={formatMoney(data.settlementTotal, currency)} />
                <Stat
                  label="Card not billed"
                  value={formatMoney(data.unassignedCardTotal, currency)}
                  hint={`${data.unassignedCardCount} charges`}
                  tone={data.unassignedCardCount > 0 ? 'warn' : 'ok'}
                />
              </div>

              <div className="space-y-1.5">
                {data.matches.map((m) => {
                  const color = accountColor(m.matched?.provider ?? m.settlement.provider, 'card', m.matched?.accountLabel);
                  const isOpen = open === m.settlement.id;
                  return (
                    <div key={m.settlement.id} className="border border-edge/50 rounded-lg overflow-hidden">
                      <button
                        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-left active:bg-panel2/40"
                        onClick={() => setOpen(isOpen ? null : m.settlement.id)}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          {m.status === 'matched' ? (
                            <span
                              className="text-[10px] px-1.5 py-0.5 rounded-full font-medium whitespace-nowrap"
                              style={{ background: `${color}22`, color }}
                            >
                              {accountLabel(m.matched!.provider, 'card', m.matched!.accountLabel)} · {m.matched!.itemCount}
                            </span>
                          ) : (
                            <Badge tone="warn">no match</Badge>
                          )}
                          <Bidi className="truncate text-muted">{m.settlement.merchant}</Bidi>
                          <span className="text-muted text-xs whitespace-nowrap">{formatDate(m.settlement.date)}</span>
                        </div>
                        <div className="flex items-center gap-2 whitespace-nowrap">
                          <span className="font-semibold">{formatMoney(Math.abs(m.settlement.amount), currency)}</span>
                          {m.status === 'matched' &&
                            (m.matched!.status === 'exact' ? (
                              <span className="text-emerald-400">✓</span>
                            ) : (
                              <span className="text-amber-300" title="difference">
                                Δ {formatMoney(m.matched!.diff, currency)}
                              </span>
                            ))}
                        </div>
                      </button>

                      {isOpen && m.matched && (
                        <div className="bg-panel2/30 px-3 py-2 space-y-1">
                          <div className="text-xs text-muted mb-1">
                            {m.matched.itemCount} card charges summing to {formatMoney(m.matched.sum, currency)}
                            {m.matched.diff >= 1 && ` (bank differs by ${formatMoney(m.matched.diff, currency)})`}:
                          </div>
                          {m.matched.items.map((it) => (
                            <div key={it.id} className="flex items-center justify-between gap-2 text-xs">
                              <Bidi className="truncate">{it.merchant}</Bidi>
                              <div className="flex items-center gap-2 whitespace-nowrap text-muted">
                                <span>{formatDate(it.date)}</span>
                                <span className="text-ink">{formatMoney(Math.abs(it.amount), currency)}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      {isOpen && !m.matched && (
                        <div className="bg-panel2/30 px-3 py-2 text-xs text-muted">
                          Couldn't find card charges that sum to this bank line. Either the matching card export isn't
                          imported yet, or the amounts differ (fees / foreign-currency rounding). It's still excluded from
                          spending as a Transfer.
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}
    </Card>
  );
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'ok' | 'warn';
}): JSX.Element {
  const color = tone === 'warn' ? 'text-amber-300' : tone === 'ok' ? 'text-emerald-400' : 'text-ink';
  return (
    <div className="bg-panel2/40 rounded-lg py-2">
      <div className={`font-semibold text-sm ${color}`}>{value}</div>
      <div className="text-[10px] text-muted">{label}</div>
      {hint && <div className="text-[10px] text-muted">{hint}</div>}
    </div>
  );
}
