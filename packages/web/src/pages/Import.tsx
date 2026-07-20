import { useEffect, useRef, useState } from 'react';
import type { AmountMode, ColumnMapping, ImportPreview } from '../api/client';
import { api } from '../api/client';
import { Badge, Bidi, Button, Card, Spinner } from '../components/ui';
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

  const header = state?.preview.header ?? [];
  const colOptions = ['', ...header];

  return (
    <div className="space-y-4">
      <h1 className="hidden md:block text-2xl font-semibold">Import bank / card exports</h1>
      <p className="text-muted text-sm">
        Upload a CSV or XLSX. Columns are auto-detected for Bank Yahav, Isracard, and Cal — adjust the mapping if
        needed. The mapping is remembered per file format, so re-imports are one click.
      </p>

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
                  <span>{b.filename ?? b.note}</span>
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
