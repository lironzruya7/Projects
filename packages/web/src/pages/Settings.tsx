import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type EmailTestResult, type NotifyConfigView } from '../api/client';
import { Badge, Bidi, Button, Card, Spinner } from '../components/ui';
import { formatDate, formatMoney } from '../lib/format';

export function Settings(): JSX.Element {
  const [settings, setSettings] = useState<any>(null);
  const [email, setEmail] = useState<any>(null);
  const [llm, setLlm] = useState<{ configured: boolean; enabled: boolean; note: string } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [testResult, setTestResult] = useState<EmailTestResult | null>(null);

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

  async function connectOutlook(): Promise<void> {
    try {
      const { url } = await api.outlookAuthUrl();
      window.open(url, '_blank', 'width=520,height=640');
      setMsg('Complete the Microsoft consent in the popup, then click "Refresh status".');
    } catch (e) {
      setMsg((e as Error).message);
    }
  }

  async function scan(provider?: 'gmail' | 'outlook' | 'imap'): Promise<void> {
    setBusy(true);
    setMsg(`Scanning ${provider ?? 'all'} email… this can take a minute.`);
    try {
      const r = await api.scanEmail(provider ? { provider } : {});
      setMsg(`Scanned ${r.messagesScanned} emails · created ${r.transactionsCreated} transactions · skipped ${r.skippedExisting} already-imported.`);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function runTest(provider: 'gmail' | 'outlook' | 'imap'): Promise<void> {
    setBusy(true);
    setTestResult(null);
    setMsg(`Testing ${provider} connection…`);
    try {
      const r = await api.testEmail({ provider });
      setTestResult(r);
      setMsg(
        r.found === 0
          ? `Connected, but no emails matched your search. Try widening the keywords or look-back window below.`
          : `Connected ✓ — ${provider} returned ${r.found} matching emails (nothing imported).`,
      );
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const emailSettings = email.settings ?? {};

  return (
    <div className="space-y-4">
      <h1 className="hidden md:block text-2xl font-semibold">Settings</h1>
      {msg && <Card className="border-brand/40"><div className="text-sm text-brand">{msg}</div></Card>}

      {/* Quick links (mobile reaches these via More) */}
      <div className="grid grid-cols-2 gap-3">
        <Link to="/duplicates" className="rounded-2xl p-4 border border-edge bg-panel active:scale-[0.98] transition-transform" style={{ background: 'linear-gradient(135deg, #fb718514, transparent 60%)' }}>
          <div className="text-lg">⧉</div>
          <div className="font-medium mt-1">Duplicates</div>
          <div className="text-xs text-muted">review double charges</div>
        </Link>
        <Link to="/rules" className="rounded-2xl p-4 border border-edge bg-panel active:scale-[0.98] transition-transform" style={{ background: 'linear-gradient(135deg, #34d39914, transparent 60%)' }}>
          <div className="text-lg">⚑</div>
          <div className="font-medium mt-1">Categories</div>
          <div className="text-xs text-muted">rules & category list</div>
        </Link>
      </div>

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

      {/* Notifications */}
      <NotifyCard onMsg={setMsg} />

      {/* Direct bank/card connection */}
      <DirectConnectCard />

      {/* Email scanning */}
      <Card>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-medium">Email scanning</h3>
          {email.imap.configured && <Badge tone="good">IMAP ready</Badge>}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
          {/* Gmail account */}
          <ProviderCard
            title="Gmail"
            configured={email.gmail.configured}
            connected={email.gmail.connected}
            hint="Set GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET in .env (see README → Google OAuth setup)."
            onConnect={connectGmail}
            onDisconnect={async () => { await api.gmailDisconnect(); await load(); }}
            onTest={() => runTest('gmail')}
            onScan={() => scan('gmail')}
            busy={busy}
          />
          {/* Outlook / Microsoft account */}
          <ProviderCard
            title="Outlook / Microsoft"
            configured={email.outlook.configured}
            connected={email.outlook.connected}
            hint="Set OUTLOOK_CLIENT_ID / OUTLOOK_CLIENT_SECRET in .env (see README → Microsoft/Outlook setup)."
            onConnect={connectOutlook}
            onDisconnect={async () => { await api.outlookDisconnect(); await load(); }}
            onTest={() => runTest('outlook')}
            onScan={() => scan('outlook')}
            busy={busy}
          />
        </div>

        <div className="flex flex-wrap gap-2 mb-4">
          <Button variant="ghost" onClick={load}>Refresh status</Button>
          {(email.gmail.connected || email.outlook.connected || email.imap.configured) && (
            <Button onClick={() => scan()} disabled={busy}>
              {busy ? 'Scanning…' : 'Scan all connected accounts'}
            </Button>
          )}
        </div>

        {testResult && (
          <div className="border border-edge rounded-lg p-3 mb-4 bg-panel2/30">
            <div className="text-sm mb-2">
              <span className="font-medium capitalize">{testResult.provider}</span> found{' '}
              <span className="text-brand">{testResult.found}</span> matching emails · nothing imported.
              <span className="text-muted"> Query: <code className="text-xs">{testResult.query || '(recent)'}</code></span>
            </div>
            {testResult.samples.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-muted text-left border-b border-edge">
                      <th className="py-1 pr-2 font-medium">Date</th>
                      <th className="py-1 pr-2 font-medium">From</th>
                      <th className="py-1 pr-2 font-medium">Subject</th>
                      <th className="py-1 pr-2 font-medium">Att.</th>
                      <th className="py-1 pl-2 font-medium text-right">Would extract</th>
                    </tr>
                  </thead>
                  <tbody>
                    {testResult.samples.map((s, i) => (
                      <tr key={i} className="border-b border-edge/40">
                        <td className="py-1 pr-2 whitespace-nowrap text-muted">{formatDate(s.date)}</td>
                        <td className="py-1 pr-2"><Bidi>{s.from}</Bidi></td>
                        <td className="py-1 pr-2 max-w-[220px] truncate"><Bidi>{s.subject}</Bidi></td>
                        <td className="py-1 pr-2 text-muted">{s.attachments || '—'}</td>
                        <td className="py-1 pl-2 text-right">
                          {s.extractedAmount != null ? (
                            <span className="text-emerald-400">{formatMoney(s.extractedAmount, s.currency ?? 'ILS')}</span>
                          ) : (
                            <span className="text-muted">no amount in body</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="text-xs text-muted mt-2">
                  “Would extract” previews the body only. Attachments (PDF/images) are parsed during a real scan.
                </div>
              </div>
            ) : (
              <div className="text-xs text-muted">No emails matched — widen the keywords or look-back window below.</div>
            )}
          </div>
        )}

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

      {/* Salary payer names */}
      <Card>
        <h3 className="font-medium mb-1">Salary transfers</h3>
        <p className="text-xs text-muted mb-3">
          Incoming bank transfers whose name contains any of these are tagged as <b>Income</b> (salary). Comma-separated.
        </p>
        <SalaryForm
          initial={(settings.salary?.payers ?? ['רותם', 'לירון']).join(', ')}
          onSave={async (payers) => {
            const r = await api.setSalaryPayers(payers);
            await load();
            setMsg(`Salary names saved · tagged ${r.tagged} transfer(s) as Income.`);
          }}
        />
      </Card>

      {/* Dedup tuning */}
      <Card>
        <h3 className="font-medium mb-3">Duplicate matching</h3>
        <DedupForm
          value={settings.dedup}
          onSave={async (v) => { await api.setDedup(v); await api.rebuildDedup(); await load(); setMsg('Matching settings saved and duplicates rebuilt.'); }}
        />
      </Card>

      {/* Financial report */}
      <Card>
        <h3 className="font-medium mb-1">Financial report</h3>
        <p className="text-xs text-muted mb-3">
          A full month-by-month report — income, expenses, categories, recurring subscriptions, recommendations and every
          transaction. The <b>Markdown</b> version is ideal to hand to another AI for analysis; <b>PDF</b> is the tidy printable one.
        </p>
        <div className="flex flex-wrap gap-2">
          <a href="/api/export/report.pdf" target="_blank" rel="noreferrer" className="px-3 py-1.5 rounded-lg text-sm bg-brand text-brandink hover:opacity-90">📄 Report PDF</a>
          <a href="/api/export/report.md" className="px-3 py-1.5 rounded-lg text-sm bg-panel2 hover:bg-edge">🤖 For AI (Markdown)</a>
          <a href="/api/export/json" className="px-3 py-1.5 rounded-lg text-sm bg-panel2 hover:bg-edge">🤖 For AI (JSON)</a>
          <a href="/api/export/report.html" target="_blank" rel="noreferrer" className="px-3 py-1.5 rounded-lg text-sm bg-panel2 hover:bg-edge">🌐 HTML</a>
        </div>
      </Card>

      {/* Data */}
      <Card>
        <h3 className="font-medium mb-1">Raw data</h3>
        <p className="text-xs text-muted mb-3">Plain transaction dumps (the full organized report is above).</p>
        <div className="flex flex-wrap gap-2">
          <a href="/api/export/json?flat=1" className="px-3 py-1.5 rounded-lg text-sm bg-panel2 hover:bg-edge">Transactions JSON</a>
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

function DirectConnectCard(): JSX.Element {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.scrapeProviders>> | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [creds, setCreds] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [debugShot, setDebugShot] = useState<string | null>(null);
  const [months, setMonths] = useState(3);

  async function load(): Promise<void> {
    setData(await api.scrapeProviders());
  }
  useEffect(() => {
    void load();
  }, []);

  if (!data) return <Card><Spinner label="Loading providers…" /></Card>;

  return (
    <Card>
      <div className="flex items-center justify-between mb-2 gap-2">
        <h3 className="font-medium">Direct connection (banks & cards)</h3>
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted flex items-center gap-1">
            history
            <select
              className="bg-panel2 border border-edge rounded px-1.5 py-0.5 text-xs"
              value={months}
              onChange={(e) => setMonths(Number(e.target.value))}
            >
              <option value={1}>1 mo</option>
              <option value={3}>3 mo</option>
              <option value={6}>6 mo</option>
              <option value={12}>12 mo</option>
            </select>
          </label>
          {data.encryptedAtRest ? <Badge tone="good">encrypted</Badge> : <Badge tone="warn">set key</Badge>}
        </div>
      </div>
      <p className="text-xs text-muted mb-3">
        Pull transactions straight from Bank Yahav / Isracard / Cal by logging in with your credentials (a headless
        browser does it locally). Credentials stay on this machine{data.encryptedAtRest ? ', encrypted at rest' : ''}.
      </p>
      {msg && <div className={`text-sm mb-2 ${msg.ok ? 'text-emerald-400' : 'text-rose-400'}`}>{msg.text}</div>}
      {debugShot && (
        <div className="mb-2">
          <a href={debugShot} target="_blank" rel="noreferrer" className="text-brand text-sm underline">
            🖼 See what the browser saw when it failed
          </a>
        </div>
      )}

      <div className="space-y-2">
        {data.providers.map((p) => (
          <div key={p.key} className="border border-edge rounded-lg p-3 bg-panel2/30">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{p.label}</span>
              <div className="flex items-center gap-2">
                {p.connected ? <Badge tone="good">saved</Badge> : <Badge>not set</Badge>}
                {p.connected && (
                  <Button
                    variant="subtle"
                    disabled={busy === p.key}
                    onClick={async () => {
                      setBusy(p.key);
                      setDebugShot(null);
                      setMsg({ ok: true, text: `Syncing ${p.label} (${months} mo)… this can take a minute (logging in).` });
                      try {
                        const r = await api.runScrape(p.key, months);
                        setMsg({ ok: true, text: `${p.label}: added ${r.transactionsCreated} txns · skipped ${r.skippedExisting} existing (since ${r.fromDate}).` });
                      } catch (e) {
                        setMsg({ ok: false, text: `${p.label}: ${(e as Error).message}` });
                        setDebugShot(`/api/scrape/debug/${p.key}?t=${Date.now()}`);
                      } finally {
                        setBusy(null);
                      }
                    }}
                  >
                    {busy === p.key ? 'Syncing…' : 'Sync now'}
                  </Button>
                )}
                <Button variant="ghost" onClick={() => { setOpen(open === p.key ? null : p.key); setCreds({}); }}>
                  {p.connected ? 'Update' : 'Connect'}
                </Button>
              </div>
            </div>

            {open === p.key && (
              <div className="mt-3 space-y-2">
                {p.fields.map((f) => (
                  <label key={f.key} className="block">
                    <span className="text-xs text-muted">{f.label}</span>
                    <input
                      className="input"
                      type={f.type === 'password' ? 'password' : 'text'}
                      autoComplete="off"
                      value={creds[f.key] ?? ''}
                      onChange={(e) => setCreds({ ...creds, [f.key]: e.target.value })}
                    />
                  </label>
                ))}
                <div className="flex gap-2">
                  <Button
                    onClick={async () => {
                      try {
                        await api.saveScrapeCredentials(p.key, creds);
                        setOpen(null);
                        setMsg({ ok: true, text: `${p.label} credentials saved. Click "Sync now".` });
                        await load();
                      } catch (e) {
                        setMsg({ ok: false, text: (e as Error).message });
                      }
                    }}
                  >
                    Save
                  </Button>
                  {p.connected && (
                    <Button
                      variant="ghost"
                      onClick={async () => {
                        await api.deleteScrapeCredentials(p.key);
                        setOpen(null);
                        setMsg({ ok: true, text: `${p.label} credentials removed.` });
                        await load();
                      }}
                    >
                      Remove
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

function ProviderCard({
  title,
  configured,
  connected,
  hint,
  onConnect,
  onDisconnect,
  onTest,
  onScan,
  busy,
}: {
  title: string;
  configured: boolean;
  connected: boolean;
  hint: string;
  onConnect: () => void;
  onDisconnect: () => void;
  onTest: () => void;
  onScan: () => void;
  busy: boolean;
}): JSX.Element {
  return (
    <div className="border border-edge rounded-lg p-3 bg-panel2/30">
      <div className="flex items-center justify-between mb-2">
        <span className="font-medium">{title}</span>
        {connected ? (
          <Badge tone="good">connected</Badge>
        ) : configured ? (
          <Badge tone="warn">not connected</Badge>
        ) : (
          <Badge>not configured</Badge>
        )}
      </div>
      {!configured ? (
        <p className="text-xs text-muted">{hint}</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {!connected && <Button onClick={onConnect}>Connect</Button>}
          {connected && (
            <>
              <Button variant="subtle" onClick={onTest} disabled={busy}>Test connection</Button>
              <Button onClick={onScan} disabled={busy}>Scan</Button>
              <Button variant="ghost" onClick={onDisconnect}>Disconnect</Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function EmailSettingsForm({ value, onSave }: { value: any; onSave: (v: any) => void }): JSX.Element {
  const [keywords, setKeywords] = useState<string>((value.keywords ?? []).join(', '));
  const [domains, setDomains] = useState<string>((value.senderDomains ?? []).join(', '));
  const [lookbackDays, setLookback] = useState<number>(value.lookbackDays ?? 90);
  const [maxResults, setMax] = useState<number>(value.maxResults ?? 200);

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

function SalaryForm({ initial, onSave }: { initial: string; onSave: (payers: string[]) => Promise<void> }): JSX.Element {
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex flex-wrap gap-2 items-end">
      <input
        className="input flex-1 min-w-[200px]"
        dir="auto"
        placeholder="e.g. רותם, לירון"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <Button
        variant="subtle"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await onSave(text.split(',').map((s) => s.trim()).filter(Boolean));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? 'Saving…' : 'Save'}
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

/** Push notifications (weekly digest + alerts). Off by default; privacy-conscious. */
function NotifyCard({ onMsg }: { onMsg: (m: string) => void }): JSX.Element {
  const [cfg, setCfg] = useState<NotifyConfigView | null>(null);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    void api.notifySettings().then(setCfg);
  }, []);

  if (!cfg) return <Card><Spinner label="Loading notifications…" /></Card>;

  const save = async (patch: Partial<NotifyConfigView>): Promise<void> => {
    const next = { ...cfg, ...patch };
    setCfg(next);
    const saved = await api.saveNotify({
      enabled: next.enabled,
      channel: next.channel,
      url: next.url,
      telegramBotToken: token, // blank => server keeps existing
      telegramChatId: next.telegramChatId,
      includeAmounts: next.includeAmounts,
      largeChargeThreshold: next.largeChargeThreshold,
    });
    setCfg(saved);
    setToken('');
  };

  const test = async (): Promise<void> => {
    setBusy(true); setResult(null);
    try {
      await save({}); // persist current fields first
      const r = await api.notifyTest();
      setResult(r.ok ? 'Test sent ✓' : `Failed: ${r.detail ?? r.status}`);
    } finally { setBusy(false); }
  };
  const digest = async (): Promise<void> => {
    setBusy(true); setResult(null);
    try {
      const r = await api.notifyDigest();
      setResult(r.ok ? 'Digest sent ✓' : `Not sent: ${r.detail}`);
      onMsg(r.preview);
    } finally { setBusy(false); }
  };

  return (
    <Card>
      <div className="flex items-center justify-between mb-1">
        <h3 className="font-medium">🔔 Notifications</h3>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={cfg.enabled} onChange={(e) => save({ enabled: e.target.checked })} />
          enabled
        </label>
      </div>
      <p className="text-xs text-muted mb-3">
        Weekly spending digest + alerts, sent by a plain HTTPS POST. <b>Recommended: a self-hosted
        ntfy on your tailnet</b> so financial data stays private. ntfy.sh (public) and Telegram are
        cloud services — only use them if you accept sending data there.
      </p>

      <div className="space-y-2">
        <label className="block">
          <span className="text-xs text-muted">Channel</span>
          <select className="input" value={cfg.channel} onChange={(e) => save({ channel: e.target.value as NotifyConfigView['channel'] })}>
            <option value="ntfy">ntfy (recommended, self-host)</option>
            <option value="telegram">Telegram bot</option>
            <option value="webhook">Generic webhook</option>
          </select>
        </label>

        {cfg.channel !== 'telegram' && (
          <label className="block">
            <span className="text-xs text-muted">{cfg.channel === 'ntfy' ? 'ntfy topic URL' : 'Webhook URL'}</span>
            <input className="input" placeholder="https://ntfy.your-tailnet/finance" value={cfg.url} onChange={(e) => setCfg({ ...cfg, url: e.target.value })} onBlur={() => save({})} />
          </label>
        )}

        {cfg.channel === 'telegram' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <label className="block">
              <span className="text-xs text-muted">Bot token {cfg.telegramTokenSet && <span className="text-emerald-400">· set</span>}</span>
              <input className="input" type="password" placeholder={cfg.telegramTokenSet ? '•••••• (unchanged)' : '123456:ABC…'} value={token} onChange={(e) => setToken(e.target.value)} onBlur={() => save({})} />
            </label>
            <label className="block">
              <span className="text-xs text-muted">Chat ID</span>
              <input className="input" placeholder="123456789" value={cfg.telegramChatId} onChange={(e) => setCfg({ ...cfg, telegramChatId: e.target.value })} onBlur={() => save({})} />
            </label>
          </div>
        )}

        <label className="flex items-center gap-2 text-sm mt-1">
          <input type="checkbox" checked={cfg.includeAmounts} onChange={(e) => save({ includeAmounts: e.target.checked })} />
          <span>Include amounts in messages <span className="text-muted text-xs">(off = counts/labels only)</span></span>
        </label>
        <label className="block max-w-xs">
          <span className="text-xs text-muted">Alert on a new charge at/above (0 = off)</span>
          <input className="input" type="number" inputMode="numeric" value={cfg.largeChargeThreshold}
            onChange={(e) => setCfg({ ...cfg, largeChargeThreshold: Number(e.target.value) || 0 })} onBlur={() => save({})} />
        </label>
      </div>

      <div className="flex flex-wrap gap-2 mt-3">
        <Button variant="ghost" disabled={busy} onClick={test}>Send test</Button>
        <Button variant="subtle" disabled={busy} onClick={digest}>Send digest now</Button>
        {result && <span className="text-sm self-center text-muted">{result}</span>}
      </div>
      <p className="text-[10px] text-muted mt-2">Tip: schedule the weekly digest with a cron/pm2 job that POSTs <code>/api/notify/digest</code>.</p>
    </Card>
  );
}
