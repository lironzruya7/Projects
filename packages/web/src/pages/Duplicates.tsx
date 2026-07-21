import { useEffect, useState } from 'react';
import type { DoubleChargeAlert } from '../api/client';
import { api } from '../api/client';
import { Badge, Bidi, Button, Card, Spinner } from '../components/ui';
import { formatDate, formatMoney } from '../lib/format';

export function Duplicates(): JSX.Element {
  const [alerts, setAlerts] = useState<DoubleChargeAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  const [exactCount, setExactCount] = useState(0);

  async function load(): Promise<void> {
    setLoading(true);
    const res = await api.alerts(showResolved ? undefined : 'open');
    setAlerts(res.alerts);
    setExactCount(res.exactCount);
    setLoading(false);
  }

  async function mergeExact(): Promise<void> {
    setBusy(true);
    try {
      const r = await api.mergeExactDuplicates();
      setMsg(`Merged ${r.merged} exact duplicate${r.merged === 1 ? '' : 's'} into ${r.groups} entr${r.groups === 1 ? 'y' : 'ies'}.`);
      await load();
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showResolved]);

  async function rerun(): Promise<void> {
    setBusy(true);
    const r = await api.runDedup();
    setMsg(`Merged ${r.mergedRows} rows into ${r.merges} entries · ${r.alerts} new alerts.`);
    setBusy(false);
    await load();
  }

  async function resolve(id: string, status: 'confirmed' | 'dismissed'): Promise<void> {
    await api.resolveAlert(id, status);
    await load();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="hidden md:block text-2xl font-semibold">Duplicates & double charges</h1>
        <div className="flex gap-2">
          <label className="text-sm text-muted flex items-center gap-1">
            <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} />
            show resolved
          </label>
          <Button onClick={rerun} disabled={busy}>
            {busy ? 'Scanning…' : 'Re-run detection'}
          </Button>
        </div>
      </div>

      {exactCount > 0 && (
        <Card className="border-emerald-500/40 flex items-center justify-between gap-3 flex-wrap">
          <div className="text-sm">
            <span className="font-medium text-emerald-300">{exactCount} exact (100%) duplicate{exactCount === 1 ? '' : 's'}</span>{' '}
            <span className="text-muted">— same amount &amp; invoice/day+merchant. Safe to merge into one entry.</span>
          </div>
          <Button onClick={mergeExact} disabled={busy}>
            {busy ? 'Merging…' : `Merge all ${exactCount} exact duplicates`}
          </Button>
        </Card>
      )}

      <Card>
        <p className="text-sm text-muted">
          <span className="text-ink font-medium">Cross-file duplicates</span> (the same purchase seen in your bank,
          card, and email) are merged automatically into one ledger entry — expand any <Badge tone="good">×N</Badge>{' '}
          row in Transactions to see and un-merge its sources. Below are{' '}
          <span className="text-ink font-medium">suspected true double charges</span>: the same merchant billing you
          twice from the same source. These are never merged — confirm or dismiss each.
        </p>
      </Card>

      {msg && <Card className="border-brand/40"><div className="text-sm text-brand">{msg}</div></Card>}

      {loading ? (
        <Spinner label="Loading alerts…" />
      ) : alerts.length === 0 ? (
        <Card className="text-center py-10 text-muted">
          No {showResolved ? '' : 'open '}double-charge alerts. 🎉
        </Card>
      ) : (
        <div className="space-y-3">
          {alerts.map((a) => (
            <Card key={a.id} className={a.status !== 'open' ? 'opacity-60' : ''}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <Bidi className="font-medium">{a.merchant || '(unknown)'}</Bidi>
                    <span className="text-lg font-semibold text-rose-400">{formatMoney(a.amount)}</span>
                    <Badge tone="warn">{Math.round(a.similarity * 100)}% match</Badge>
                    {a.status !== 'open' && <Badge tone={a.status === 'confirmed' ? 'warn' : 'default'}>{a.status}</Badge>}
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-sm mt-2">
                    <ChargeSide label="Charge A" date={a.date_a} tx={a.a} />
                    <ChargeSide label="Charge B" date={a.date_b} tx={a.b} />
                  </div>
                </div>
                {a.status === 'open' && (
                  <div className="flex flex-col gap-2 shrink-0">
                    <Button variant="danger" onClick={() => resolve(a.id, 'confirmed')}>
                      Confirm double charge
                    </Button>
                    <Button variant="ghost" onClick={() => resolve(a.id, 'dismissed')}>
                      Dismiss
                    </Button>
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function ChargeSide({ label, date, tx }: { label: string; date: string; tx: any }): JSX.Element {
  return (
    <div className="bg-panel2/50 rounded-lg p-2">
      <div className="text-xs text-muted">{label} · {formatDate(date)}</div>
      {tx ? (
        <div className="mt-1">
          <div className="flex items-center gap-2">
            <Badge tone={tx.source_type === 'bank' ? 'bank' : tx.source_type === 'card' ? 'card' : 'email'}>
              {tx.source_type}
            </Badge>
            <span className="text-muted text-xs">{tx.source_provider ?? ''}</span>
          </div>
          <div className="text-xs text-muted mt-1 rtl-aware" dir="auto">{tx.source_ref}</div>
        </div>
      ) : (
        <div className="text-xs text-muted mt-1">transaction removed</div>
      )}
    </div>
  );
}
