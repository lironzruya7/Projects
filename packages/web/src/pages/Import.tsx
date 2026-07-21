import { useEffect, useRef, useState } from 'react';
import type { AmountMode, ColumnMapping, ImportPreview } from '../api/client';
import { api } from '../api/client';
import { Badge, Bidi, Button, Card, Spinner } from '../components/ui';
import { ReconcileCard } from '../components/ReconcileCard';
import { CARD_PROVIDERS } from '../lib/accounts';
import { formatDate } from '../lib/format';

interface UploadState {
  uploadId: string;
  filename: string;
  preview: ImportPreview;
  remembered: any;
}

const AMOUNT_MODES: Array<{ value: AmountMode; label: string }> = [
  { value: 'debit_credit', label: 'Separate debit / credit columns' },
  { value: 'signed', label: 'Single signed amount (− = expense)' },
  { value: 'flip_sign', label: 'Single amount, positive = expense (cards)' },
  { value: 'magnitude_type', label: 'Amount + type column decides sign' },
];

export function ImportPage(): JSX.Element {
  const [state, setState] = useState<UploadState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);
  const [batches, setBatches] = useState<any[]>([]);
  const [confirmClear, setConfirmClear] = useState<'email' | 'bank' | 'card' | null>(null);
  const [historyMsg, setHistoryMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const receiptCamRef = useRef<HTMLInputElement>(null);
  const receiptFileRef = useRef<HTMLInputElement>(null);
  const [scanBusy, setScanBusy] = useState(false);
  const [scanMsg, setScanMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const cardFilesRef = useRef<HTMLInputElement>(null);
  const bankFilesRef = useRef<HTMLInputElement>(null);
  const [autoBusy, setAutoBusy] = useState(false);
  const [autoResults, setAutoResults] = useState<Awaited<ReturnType<typeof api.autoImport>> | null>(null);
  const [cardStaged, setCardStaged] = useState<Array<{ file: File; label: string; provider: string }> | null>(null);

  // Mapping form state
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [amountMode, setAmountMode] = useState<AmountMode>('signed');
  const [dateFormat, setDateFormat] = useState('auto');
  const [sourceType, setSourceType] = useState<'bank' | 'card'>('bank');
  const [provider, setProvider] = useState('');

  async function loadBatches(): Promise<void> {
    const b = await api.batches();
    setBatches(b.batches);
  }
  useEffect(() => {
    void loadBatches();
  }, [result]);

  async function onFile(file: File): Promise<void> {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await api.previewFile(file);
      setState(res);
      const sug = res.preview.suggestion;
      const remembered = res.remembered as any;
      if (remembered) {
        setMapping(remembered.mapping);
        setAmountMode(remembered.amountMode);
        setDateFormat(remembered.dateFormat ?? 'auto');
        setSourceType(remembered.sourceType);
        setProvider(remembered.provider ?? '');
      } else {
        setMapping(sug.mapping);
        setAmountMode(sug.amountMode);
        setDateFormat(res.preview.detectedDateFormat === 'YYYY-MM-DD' ? 'YYYY-MM-DD' : res.preview.detectedDateFormat === 'MM/DD/YYYY' ? 'MM/DD/YYYY' : 'DD/MM/YYYY');
        setSourceType(sug.sourceType);
        setProvider(sug.provider ?? '');
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function commit(): Promise<void> {
    if (!state) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.commitImport({
        uploadId: state.uploadId,
        mapping,
        amountMode,
        dateFormat,
        headerRow: state.preview.headerRow,
        provider: provider || null,
        sourceType,
        saveMapping: true,
        signature: state.preview.signature,
      });
      setResult(res);
      setState(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function autoImport(files: FileList | null, sourceType: 'card' | 'bank'): Promise<void> {
    if (!files || files.length === 0) return;
    setAutoBusy(true);
    setAutoResults(null);
    setError(null);
    try {
      const res = await api.autoImport(files, sourceType);
      setAutoResults(res);
      await loadBatches();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAutoBusy(false);
    }
  }

  // Credit-card files are staged first so each can be tagged with its card
  // (blank => the server auto-detects a last-4), then imported together.
  function stageCardFiles(files: FileList | null): void {
    if (!files || files.length === 0) return;
    setCardStaged(Array.from(files).map((f) => ({ file: f, label: '', provider: '' })));
    setAutoResults(null);
    setError(null);
  }

  async function runCardImport(): Promise<void> {
    if (!cardStaged || cardStaged.length === 0) return;
    setAutoBusy(true);
    setAutoResults(null);
    setError(null);
    try {
      const res = await api.autoImport(cardStaged, 'card');
      setAutoResults(res);
      setCardStaged(null);
      await loadBatches();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAutoBusy(false);
    }
  }

  async function scanReceipt(file: File | undefined): Promise<void> {
    if (!file) return;
    setScanBusy(true);
    setScanMsg(null);
    try {
      const r = await api.scanReceipt(file);
      const amt = r.extracted.amount ?? 0;
      const cur = r.extracted.currency || 'ILS';
      const merged = r.merged ? ' · matched an existing charge and merged ✓' : '';
      setScanMsg({
        ok: true,
        text: `Added ${r.extracted.merchant ?? 'receipt'} — ${cur} ${amt.toFixed(2)}${r.extracted.date ? ` on ${r.extracted.date}` : ''}${merged}`,
      });
      await loadBatches();
    } catch (e) {
      setScanMsg({ ok: false, text: (e as Error).message });
    } finally {
      setScanBusy(false);
    }
  }

  const header = state?.preview.header ?? [];
  const colOptions = ['', ...header];

  return (
    <div className="space-y-4">
      <h1 className="hidden md:block text-2xl font-semibold">Import bank / card exports</h1>
      <p className="text-muted text-sm">
        Drop your statements below — CSV, Excel, or PDF. Upload several card files at once (all 3 cards together).
        Formats are auto-detected; the column mapping is remembered per format.
      </p>

      {/* Two quick multi-file modes */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <input ref={cardFilesRef} type="file" multiple accept=".csv,.xlsx,.xls,.xlsm,.pdf" className="hidden" onChange={(e) => stageCardFiles(e.target.files)} />
        <input ref={bankFilesRef} type="file" multiple accept=".csv,.xlsx,.xls,.xlsm,.pdf" className="hidden" onChange={(e) => autoImport(e.target.files, 'bank')} />
        <button
          disabled={autoBusy}
          onClick={() => cardFilesRef.current?.click()}
          className="rounded-2xl border-2 border-dashed border-edge hover:border-brand p-5 text-center active:scale-[0.99] transition-all disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg, #c084fc18, transparent 60%)' }}
        >
          <div className="text-2xl">💳</div>
          <div className="font-medium mt-1">Credit cards</div>
          <div className="text-xs text-muted mt-0.5">Upload several files at once · CSV / Excel / PDF</div>
        </button>
        <button
          disabled={autoBusy}
          onClick={() => bankFilesRef.current?.click()}
          className="rounded-2xl border-2 border-dashed border-edge hover:border-brand p-5 text-center active:scale-[0.99] transition-all disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg, #38bdf818, transparent 60%)' }}
        >
          <div className="text-2xl">🏦</div>
          <div className="font-medium mt-1">Bank statement</div>
          <div className="text-xs text-muted mt-0.5">Backup / cross-check · CSV / Excel / PDF</div>
        </button>
      </div>

      {/* Stage credit-card files: tag each with its card before importing */}
      {cardStaged && (
        <Card style={{ background: 'linear-gradient(135deg, #c084fc14, transparent 60%)' }}>
          <div className="font-medium mb-1">💳 Tag each card ({cardStaged.length} file{cardStaged.length > 1 ? 's' : ''})</div>
          <p className="text-xs text-muted mb-3">
            Pick the card type (Diners looks like Cal to auto-detect) and its last 4 digits, so cards don't get mixed up.
            Leave a field on Auto/blank to detect it from the file.
          </p>
          <div className="space-y-2">
            {cardStaged.map((s, i) => (
              <div key={i} className="flex items-center gap-2">
                <Bidi className="truncate flex-1 text-sm min-w-0">{s.file.name}</Bidi>
                <select
                  className="input w-28 shrink-0"
                  value={s.provider}
                  onChange={(e) =>
                    setCardStaged((prev) => prev!.map((x, j) => (j === i ? { ...x, provider: e.target.value } : x)))
                  }
                >
                  {CARD_PROVIDERS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
                <input
                  className="input w-24 shrink-0"
                  inputMode="numeric"
                  placeholder="last 4"
                  value={s.label}
                  onChange={(e) =>
                    setCardStaged((prev) => prev!.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))
                  }
                />
              </div>
            ))}
          </div>
          <div className="flex gap-2 mt-3">
            <Button onClick={runCardImport} disabled={autoBusy}>
              Import {cardStaged.length} file{cardStaged.length > 1 ? 's' : ''}
            </Button>
            <Button variant="ghost" onClick={() => setCardStaged(null)} disabled={autoBusy}>
              Cancel
            </Button>
          </div>
        </Card>
      )}

      {autoBusy && <Card><Spinner label="Reading files…" /></Card>}

      {autoResults && (
        <Card className="border-emerald-500/40">
          <div className="font-medium mb-2">
            Imported {autoResults.results.reduce((s, r) => s + (r.imported ?? 0), 0)} transactions from{' '}
            {autoResults.results.length} file(s)
          </div>
          <div className="space-y-1">
            {autoResults.results.map((r, i) => (
              <div key={i} className="flex items-center justify-between gap-2 text-sm border-b border-edge/40 py-1.5">
                <div className="flex items-center gap-2 min-w-0">
                  <Badge tone={r.format === 'pdf' ? 'warn' : 'default'}>{r.format ?? 'file'}</Badge>
                  <Bidi className="truncate">{r.filename}</Bidi>
                  {r.provider && <Badge tone="card">{r.provider}{r.accountLabel ? ` ••${r.accountLabel}` : ''}</Badge>}
                  {r.period && <span className="text-[10px] text-muted">{r.period}</span>}
                </div>
                <div className="text-xs whitespace-nowrap">
                  {r.error ? (
                    <span className="text-rose-400">{r.error}</span>
                  ) : r.duplicate ? (
                    <span className="text-amber-300">⊘ duplicate — skipped</span>
                  ) : r.needsManual ? (
                    <span className="text-amber-300">needs manual mapping</span>
                  ) : (
                    <span className="text-emerald-400">{r.imported} imported{r.skipped ? ` · ${r.skipped} skipped` : ''}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="text-xs text-muted mt-2">
            Dedup: merged {autoResults.dedup.mergedRows} rows · {autoResults.dedup.alerts} alerts. PDF rows are
            best-effort — check them in Transactions and delete the batch if a file parsed wrong.
          </div>
        </Card>
      )}

      <div className="text-xs text-muted">
        Need to map columns by hand (a new/unusual format)? Use the single-file importer below.
      </div>

      {/* Scan a receipt with the camera → OCR → auto-added & deduped */}
      <Card style={{ background: 'linear-gradient(135deg, #4ade8018, transparent 60%)' }}>
        <div className="flex items-center justify-between gap-2 mb-2">
          <h3 className="font-medium">📷 Scan a receipt</h3>
          <span className="text-xs text-muted">OCR → auto-added</span>
        </div>
        <p className="text-xs text-muted mb-3">
          Photograph a paper receipt (or pick a PDF). It's read automatically, added to your ledger, and matched
          against the card/email charge if one exists.
        </p>
        <input ref={receiptCamRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => scanReceipt(e.target.files?.[0])} />
        <input ref={receiptFileRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => scanReceipt(e.target.files?.[0])} />
        <div className="flex gap-2">
          <Button disabled={scanBusy} onClick={() => receiptCamRef.current?.click()}>
            {scanBusy ? 'Reading…' : '📷 Take photo'}
          </Button>
          <Button variant="ghost" disabled={scanBusy} onClick={() => receiptFileRef.current?.click()}>
            📎 Pick file
          </Button>
        </div>
        {scanMsg && (
          <div className={`text-sm mt-3 ${scanMsg.ok ? 'text-emerald-400' : 'text-rose-400'}`}>{scanMsg.text}</div>
        )}
      </Card>

      {error && <Card className="border-rose-500/40"><div className="text-rose-400 text-sm">{error}</div></Card>}

      {!state && (
        <Card
          className="border-dashed border-2 text-center py-12 cursor-pointer hover:border-brand"
          onClick={() => fileRef.current?.click()}
        >
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.xlsx,.xls,.xlsm"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
          />
          {busy ? <Spinner label="Reading file…" /> : (
            <>
              <div className="text-lg">Drop a file or click to browse</div>
              <div className="text-muted text-sm mt-1">.csv · .xlsx</div>
            </>
          )}
        </Card>
      )}

      {state && (
        <Card>
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="font-medium">{state.filename}</div>
              <div className="text-xs text-muted">
                {state.preview.format.toUpperCase()} · {state.preview.totalRows} rows · header row{' '}
                {state.preview.headerRow + 1}
                {state.preview.encoding ? ` · ${state.preview.encoding}` : ''}
                {state.remembered && <span className="ml-2 text-emerald-400">✓ remembered mapping</span>}
                {state.preview.suggestion.provider && !state.remembered && (
                  <span className="ml-2 text-brand">detected: {state.preview.suggestion.provider}</span>
                )}
              </div>
            </div>
            <Button variant="ghost" onClick={() => setState(null)}>
              Cancel
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
            <Field label="Source type">
              <select className="input" value={sourceType} onChange={(e) => setSourceType(e.target.value as any)}>
                <option value="bank">Bank statement</option>
                <option value="card">Credit card</option>
              </select>
            </Field>
            <Field label="Account name (shown on each transaction)">
              <input className="input" value={provider} onChange={(e) => setProvider(e.target.value)} placeholder="e.g. yahav · isracard · cal" />
            </Field>
            <Field label="Amount handling">
              <select className="input" value={amountMode} onChange={(e) => setAmountMode(e.target.value as AmountMode)}>
                {AMOUNT_MODES.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </Field>
            <Field label="Date format">
              <select className="input" value={dateFormat} onChange={(e) => setDateFormat(e.target.value)}>
                <option value="auto">Auto-detect</option>
                <option value="DD/MM/YYYY">DD/MM/YYYY</option>
                <option value="MM/DD/YYYY">MM/DD/YYYY</option>
                <option value="YYYY-MM-DD">YYYY-MM-DD (ISO)</option>
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            <MapField label="Date column" value={mapping.date} options={colOptions} onChange={(v) => setMapping({ ...mapping, date: v })} />
            {amountMode === 'debit_credit' ? (
              <>
                <MapField label="Debit column" value={mapping.debit} options={colOptions} onChange={(v) => setMapping({ ...mapping, debit: v })} />
                <MapField label="Credit column" value={mapping.credit} options={colOptions} onChange={(v) => setMapping({ ...mapping, credit: v })} />
              </>
            ) : (
              <MapField label="Amount column" value={mapping.amount} options={colOptions} onChange={(v) => setMapping({ ...mapping, amount: v })} />
            )}
            <MapField label="Merchant column" value={mapping.merchant} options={colOptions} onChange={(v) => setMapping({ ...mapping, merchant: v })} />
            <MapField label="Description column" value={mapping.description} options={colOptions} onChange={(v) => setMapping({ ...mapping, description: v })} />
            <MapField label="Currency column" value={mapping.currency} options={colOptions} onChange={(v) => setMapping({ ...mapping, currency: v })} />
            {amountMode === 'magnitude_type' && (
              <MapField label="Type column" value={mapping.type} options={colOptions} onChange={(v) => setMapping({ ...mapping, type: v })} />
            )}
          </div>

          <div className="overflow-x-auto mb-4 border border-edge rounded-lg">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-panel2">
                  {header.map((h, i) => (
                    <th key={i} className="px-2 py-1.5 text-left font-medium whitespace-nowrap">
                      <Bidi>{h || `(col ${i + 1})`}</Bidi>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {state.preview.sampleRows.map((row, ri) => (
                  <tr key={ri} className="border-t border-edge/50">
                    {header.map((_, ci) => (
                      <td key={ci} className="px-2 py-1 whitespace-nowrap"><Bidi>{row[ci] ?? ''}</Bidi></td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex justify-end gap-2">
            <Button onClick={commit} disabled={busy}>
              {busy ? 'Importing…' : 'Import transactions'}
            </Button>
          </div>
        </Card>
      )}

      {result && (
        <Card className="border-emerald-500/40">
          <div className="font-medium text-emerald-400 mb-2">
            Imported {result.imported} transactions
          </div>
          <div className="text-sm text-muted">
            Dedup: merged {result.dedup?.mergedRows ?? 0} rows into {result.dedup?.merges ?? 0} entries ·{' '}
            {result.dedup?.alerts ?? 0} double-charge alerts.
          </div>
          {result.skippedCount > 0 && (
            <details className="mt-2 text-sm">
              <summary className="cursor-pointer text-amber-300">{result.skippedCount} rows skipped (click to inspect)</summary>
              <div className="mt-2 space-y-1 max-h-48 overflow-y-auto">
                {result.skipped.map((s: any, i: number) => (
                  <div key={i} className="text-xs text-muted">
                    row {s.rowIndex}: {s.reason} — <Bidi>{(s.row ?? []).join(' | ').slice(0, 120)}</Bidi>
                  </div>
                ))}
              </div>
            </details>
          )}
        </Card>
      )}

      <ReconcileCard />

      <Card>
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h3 className="font-medium">Import history</h3>
          {batches.length > 0 && (
            <div className="flex gap-2">
              {(['email', 'bank', 'card'] as const).map((st) => {
                const count = batches.filter((b) => b.source_type === st).length;
                if (count === 0) return null;
                return (
                  <Button
                    key={st}
                    variant="ghost"
                    onClick={() => setConfirmClear(st)}
                    className={confirmClear === st ? 'border-rose-500 text-rose-300' : ''}
                  >
                    {confirmClear === st ? `Confirm delete ${count} ${st}?` : `Delete all ${st} (${count})`}
                  </Button>
                );
              })}
              {confirmClear && (
                <Button
                  variant="danger"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    setError(null);
                    try {
                      const r = await api.clearBatches(confirmClear);
                      setHistoryMsg(`Deleted ${r.deleted} ${confirmClear} import(s) and their transactions.`);
                      setConfirmClear(null);
                      await loadBatches();
                    } catch (e) {
                      setError(`Delete failed: ${(e as Error).message}`);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Yes, delete
                </Button>
              )}
              {confirmClear && (
                <Button variant="subtle" onClick={() => setConfirmClear(null)}>Cancel</Button>
              )}
            </div>
          )}
        </div>
        {historyMsg && <div className="text-emerald-400 text-sm mb-2">{historyMsg}</div>}
        {batches.length === 0 ? (
          <div className="text-muted text-sm">No imports yet.</div>
        ) : (
          <div className="space-y-1">
            {batches.map((b) => (
              <div key={b.id} className="flex items-center justify-between text-sm border-b border-edge/40 py-1.5">
                <div className="flex items-center gap-2">
                  <Badge tone={b.source_type === 'bank' ? 'bank' : b.source_type === 'card' ? 'card' : 'email'}>
                    {b.source_type}
                  </Badge>
                  {b.source_type === 'card' ? (
                    <span className="flex items-center gap-1">
                      <select
                        className="input !py-0.5 !px-1 text-xs w-24"
                        value={b.source_provider ?? ''}
                        disabled={busy}
                        onChange={async (e) => {
                          setBusy(true);
                          setError(null);
                          try {
                            await api.setBatchProvider(b.id, e.target.value);
                            setHistoryMsg('Card type updated.');
                            await loadBatches();
                          } catch (err) {
                            setError((err as Error).message);
                          } finally {
                            setBusy(false);
                          }
                        }}
                      >
                        {CARD_PROVIDERS.filter((p) => p.value).map((p) => (
                          <option key={p.value} value={p.value}>
                            {p.label}
                          </option>
                        ))}
                      </select>
                      {b.account_label && <span className="text-muted text-xs">••{b.account_label}</span>}
                    </span>
                  ) : (
                    (b.source_provider || b.account_label) && (
                      <Badge tone="card">
                        {b.source_provider ?? ''}{b.account_label ? ` ••${b.account_label}` : ''}
                      </Badge>
                    )
                  )}
                  {b.source_type === 'card' && (
                    <input
                      type="month"
                      style={{ colorScheme: 'dark' }}
                      className="input !py-0.5 !px-1 text-xs w-28"
                      title="Billing month of this file"
                      defaultValue={b.period ?? ''}
                      disabled={busy}
                      onChange={async (e) => {
                        setBusy(true);
                        setError(null);
                        try {
                          await api.setBatchPeriod(b.id, e.target.value);
                          setHistoryMsg('Month updated.');
                          await loadBatches();
                        } catch (err) {
                          setError((err as Error).message);
                        } finally {
                          setBusy(false);
                        }
                      }}
                    />
                  )}
                  <span className="truncate">{b.filename ?? b.note}</span>
                  <span className="text-muted text-xs">{b.row_count} rows · {formatDate((b.created_at ?? '').slice(0, 10))}</span>
                </div>
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    setError(null);
                    try {
                      await api.deleteBatch(b.id);
                      setHistoryMsg('Import deleted.');
                      await loadBatches();
                    } catch (e) {
                      setError(`Delete failed: ${(e as Error).message}`);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Delete
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <label className="block">
      <span className="text-xs text-muted">{label}</span>
      {children}
    </label>
  );
}

function MapField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string | null | undefined;
  options: string[];
  onChange: (v: string | null) => void;
}): JSX.Element {
  return (
    <label className="block">
      <span className="text-xs text-muted">{label}</span>
      <select className="input" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
        {options.map((o, i) => (
          <option key={i} value={o}>
            {o === '' ? '— none —' : o}
          </option>
        ))}
      </select>
    </label>
  );
}
