import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { Badge, Button, Card, Spinner } from '../components/ui';

export function Settings(): JSX.Element {
  const [settings, setSettings] = useState<any>(null);
  const [email, setEmail] = useState<any>(null);
  const [llm, setLlm] = useState<{ configured: boolean; enabled: boolean; note: string } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load(): Promise<void> {
    const [s, e, l] = await Promise.all([api.settings(), api.emailStatus(), api.llmStatus()]);
    setSettings(s);
    setEmail(e);
    setLlm(l);
  }
  useEffect(() => {
    void load();
  }, []);

  if (!settings || !email || !llm) return <Spinner label="Loading settings…" />;

  async function connectGmail(): Promise<void> {
    try {
      const { url } = await api.gmailAuthUrl();
      window.open(url, '_blank', 'width=520,height=640');
      setMsg('Complete the Google consent in the popup, then click "Refresh status".');
    } catch (e) {
      setMsg((e as Error).message);
    }
  }

  async function scan(): Promise<void> {
    setBusy(true);
    setMsg('Scanning email… this can take a minute.');
    try {
      const r = await api.scanEmail();
      setMsg(`Scanned ${r.messagesScanned} emails · created ${r.transactionsCreated} transactions · skipped ${r.skippedExisting} already-imported.`);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const emailSettings = email.settings ?? {};

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Settings</h1>
      {msg && <Card className="border-brand/40"><div className="text-sm text-brand">{msg}</div></Card>}

      {/* General */}
      <Card>
        <h3 className="font-medium mb-3">General</h3>
        <label className="block max-w-xs">
          <span className="text-xs text-muted">Default currency</span>
          <select
            className="input"
            value={settings.currency}
            onChange={async (e) => {
              await api.setCurrency(e.target.value);
              await load();
              setMsg('Currency updated.');
            }}
          >
            {['ILS', 'USD', 'EUR', 'GBP'].map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>
      </Card>

      {/* Email scanning */}
      <Card>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-medium">Email scanning</h3>
          <div className="flex gap-2 items-center">
            {email.gmail.connected ? <Badge tone="good">Gmail connected</Badge> :
              email.gmail.configured ? <Badge tone="warn">Gmail not connected</Badge> :
              <Badge>Gmail not configured</Badge>}
            {email.imap.configured && <Badge tone="good">IMAP ready</Badge>}
          </div>
        </div>

        {!email.gmail.configured && !email.imap.configured && (
          <p className="text-sm text-muted mb-3">
            Set <code>GMAIL_CLIENT_ID</code> / <code>GMAIL_CLIENT_SECRET</code> in <code>.env</code> (see README for
            Google OAuth setup), or configure IMAP. Then restart the server.
          </p>
        )}

        <div className="flex flex-wrap gap-2 mb-4">
          {email.gmail.configured && !email.gmail.connected && (
            <Button onClick={connectGmail}>Connect Gmail</Button>
          )}
          {email.gmail.connected && (
            <Button variant="ghost" onClick={async () => { await api.gmailDisconnect(); await load(); }}>
              Disconnect Gmail
            </Button>
          )}
          <Button variant="ghost" onClick={load}>Refresh status</Button>
          {(email.gmail.connected || email.imap.configured) && (
            <Button onClick={scan} disabled={busy}>{busy ? 'Scanning…' : 'Scan email now'}</Button>
          )}
        </div>

        <EmailSettingsForm
          value={emailSettings}
          onSave={async (v) => {
            await api.updateEmailSettings(v);
            await load();
            setMsg('Email search settings saved.');
          }}
        />
      </Card>

      {/* LLM */}
      <Card>
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-medium">AI categorization (optional)</h3>
          {llm.configured ? <Badge tone="good">API key set</Badge> : <Badge>No API key</Badge>}
        </div>
        <p className="text-sm text-muted mb-3">{llm.note}</p>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={llm.enabled}
              disabled={!llm.configured}
              onChange={async (e) => { await api.setLlm(e.target.checked); await load(); }}
            />
            Enable LLM categorization
          </label>
          {llm.enabled && (
            <Button
              onClick={async () => {
                setBusy(true);
                try {
                  const r = await api.llmCategorize();
                  setMsg(`Classified ${r.count} merchants · ${r.recategorized} transactions updated.`);
                } catch (e) {
                  setMsg((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
              disabled={busy}
            >
              Categorize unknown merchants
            </Button>
          )}
        </div>
      </Card>

      {/* Dedup tuning */}
      <Card>
        <h3 className="font-medium mb-3">Duplicate matching</h3>
        <DedupForm
          value={settings.dedup}
          onSave={async (v) => { await api.setDedup(v); await api.rebuildDedup(); await load(); setMsg('Matching settings saved and duplicates rebuilt.'); }}
        />
      </Card>

      {/* Data */}
      <Card>
        <h3 className="font-medium mb-3">Your data</h3>
        <div className="flex flex-wrap gap-2">
          <a href="/api/export/json" className="px-3 py-1.5 rounded-lg text-sm bg-panel2 hover:bg-edge">Export JSON</a>
          <a href="/api/export/csv" className="px-3 py-1.5 rounded-lg text-sm bg-panel2 hover:bg-edge">Export CSV</a>
          <Button
            variant="danger"
            onClick={async () => {
              if (prompt('This deletes ALL transactions, imports, rules and tokens. Type DELETE to confirm.') === 'DELETE') {
                await api.wipe();
                setMsg('All data wiped.');
                await load();
              }
            }}
          >
            Wipe all data
          </Button>
        </div>
        <p className="text-xs text-muted mt-2">Everything is stored locally in a SQLite file. No cloud sync.</p>
      </Card>
    </div>
  );
}

function EmailSettingsForm({ value, onSave }: { value: any; onSave: (v: any) => void }): JSX.Element {
  const [keywords, setKeywords] = useState<string>((value.keywords ?? []).join(', '));
  const [domains, setDomains] = useState<string>((value.senderDomains ?? []).join(', '));
  const [lookbackDays, setLookback] = useState<number>(value.lookbackDays ?? 90);
  const [maxResults, setMax] = useState<number>(value.maxResults ?? 50);

  return (
    <div className="space-y-2 border-t border-edge pt-3">
      <label className="block">
        <span className="text-xs text-muted">Keywords (HE + EN, comma-separated)</span>
        <input className="input" value={keywords} onChange={(e) => setKeywords(e.target.value)} />
      </label>
      <label className="block">
        <span className="text-xs text-muted">Known sender domains (comma-separated)</span>
        <input className="input" value={domains} onChange={(e) => setDomains(e.target.value)} placeholder="e.g. wolt.com, עסק.co.il" />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="text-xs text-muted">Look back (days)</span>
          <input type="number" className="input" value={lookbackDays} onChange={(e) => setLookback(Number(e.target.value))} />
        </label>
        <label className="block">
          <span className="text-xs text-muted">Max emails per scan</span>
          <input type="number" className="input" value={maxResults} onChange={(e) => setMax(Number(e.target.value))} />
        </label>
      </div>
      <Button
        variant="subtle"
        onClick={() =>
          onSave({
            keywords: keywords.split(',').map((s) => s.trim()).filter(Boolean),
            senderDomains: domains.split(',').map((s) => s.trim()).filter(Boolean),
            lookbackDays: Number(lookbackDays),
            maxResults: Number(maxResults),
          })
        }
      >
        Save search settings
      </Button>
    </div>
  );
}

function DedupForm({ value, onSave }: { value: any; onSave: (v: any) => void }): JSX.Element {
  const [v, setV] = useState({
    amountTolerancePct: value.amountTolerancePct ?? 0.5,
    amountToleranceMinor: value.amountToleranceMinor ?? 1,
    dateWindowDays: value.dateWindowDays ?? 3,
    merchantThreshold: value.merchantThreshold ?? 0.85,
  });
  const field = (k: keyof typeof v, label: string, step: number) => (
    <label className="block">
      <span className="text-xs text-muted">{label}</span>
      <input type="number" step={step} className="input" value={v[k]} onChange={(e) => setV({ ...v, [k]: Number(e.target.value) })} />
    </label>
  );
  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {field('amountTolerancePct', 'Amount tolerance %', 0.1)}
        {field('amountToleranceMinor', 'Min tolerance (minor units)', 1)}
        {field('dateWindowDays', 'Date window (days)', 1)}
        {field('merchantThreshold', 'Merchant similarity (0–1)', 0.05)}
      </div>
      <Button variant="subtle" className="mt-3" onClick={() => onSave(v)}>Save & rebuild</Button>
    </div>
  );
}
