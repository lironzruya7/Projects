import { Fragment, useEffect, useRef, useState } from 'react';
import type { Category, LedgerEntry } from '../api/client';
import { api } from '../api/client';
import { formatDate, formatMoney, formatMonthLong } from '../lib/format';
import { categoryColor } from '../lib/colors';
import { accountColor, accountLabel } from '../lib/accounts';
import { Badge, Bidi, Button } from './ui';

/** Small colored chip naming the account/card a source came from. */
function AccountChip({ provider, sourceType }: { provider: string | null; sourceType: string }): JSX.Element {
  const color = accountColor(provider, sourceType);
  return (
    <span
      className="text-[10px] px-1.5 py-0.5 rounded-full font-medium whitespace-nowrap"
      style={{ background: `${color}22`, color }}
    >
      {accountLabel(provider, sourceType)}
    </span>
  );
}

function attachmentUrl(s: { id: string; sourceType: string; sourceRef: string | null }): string | null {
  const parts = (s.sourceRef ?? '').split(':');
  if (s.sourceType === 'email' && (parts[0] === 'gmail' || parts[0] === 'outlook') && parts.length >= 3) {
    return `/api/attachments/${s.id}`;
  }
  return null;
}

export function TransactionTable({
  entries,
  categories,
  onChanged,
}: {
  entries: LedgerEntry[];
  categories: Category[];
  onChanged?: () => void;
}): JSX.Element {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [receiptsFor, setReceiptsFor] = useState<string | null>(null);

  if (entries.length === 0) {
    return <div className="text-muted text-sm py-8 text-center">No transactions match.</div>;
  }

  return (
    <div className="divide-y divide-edge/40">
      {entries.map((e, i) => {
        const color = categoryColor(e.category);
        const isOpen = expanded === e.id;
        const month = e.date.slice(0, 7);
        const showMonth = i === 0 || entries[i - 1]!.date.slice(0, 7) !== month;
        return (
          <Fragment key={e.id}>
            {showMonth && (
              <div className="sticky top-0 z-10 -mx-4 px-4 py-1.5 bg-surface/95 backdrop-blur border-y border-edge/60 text-xs font-medium text-muted uppercase tracking-wide">
                {formatMonthLong(month)}
              </div>
            )}
            <div className="flex items-start gap-3 py-2.5">
              <span className="w-1.5 h-9 rounded-full shrink-0 mt-0.5" style={{ background: color }} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <Bidi className="font-medium truncate">{e.merchantNormalized || e.merchantRaw || '(unknown)'}</Bidi>
                  {e.sourceCount > 1 && (
                    <button className="text-brand text-xs shrink-0" onClick={() => setExpanded(isOpen ? null : e.id)}>
                      <Badge tone="good">×{e.sourceCount} {isOpen ? '▲' : '▼'}</Badge>
                    </button>
                  )}
                  {attachmentUrl(e) && (
                    <a
                      href={attachmentUrl(e)!}
                      target="_blank"
                      rel="noreferrer"
                      className="text-brand text-xs shrink-0"
                      onClick={(ev) => ev.stopPropagation()}
                    >
                      📄
                    </a>
                  )}
                  <button
                    className={`text-xs shrink-0 ${receiptsFor === e.id ? 'text-brand' : 'text-muted'}`}
                    title="Receipts"
                    onClick={() => setReceiptsFor(receiptsFor === e.id ? null : e.id)}
                  >
                    📎
                  </button>
                </div>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <span className="text-muted text-xs">{formatDate(e.date)}</span>
                  {distinctAccounts(e).map((a) => (
                    <AccountChip key={`${a.provider}|${a.sourceType}`} provider={a.provider} sourceType={a.sourceType} />
                  ))}
                  {editing === e.id ? (
                    <CategoryPicker
                      categories={categories}
                      current={e.category}
                      onPick={async (cat, applyToMerchant) => {
                        await api.recategorize(e.id, cat, applyToMerchant);
                        setEditing(null);
                        onChanged?.();
                      }}
                      onCancel={() => setEditing(null)}
                    />
                  ) : (
                    <button
                      onClick={() => setEditing(e.id)}
                      className="text-xs px-2 py-0.5 rounded-full font-medium"
                      style={{ background: `${color}22`, color }}
                    >
                      {e.category ?? 'uncategorized'}
                      {e.categorySource === 'llm' && ' ·AI'}
                    </button>
                  )}
                </div>
              </div>
              <div className={`text-right whitespace-nowrap font-semibold ${e.amount < 0 ? 'text-ink' : 'text-emerald-400'}`}>
                {formatMoney(e.amount, e.currency, { sign: true })}
                {e.currency !== 'ILS' && <span className="text-[10px] text-muted ml-1 align-middle">{e.currency}</span>}
              </div>
            </div>

            {isOpen && (
              <div className="bg-panel2/30 rounded-lg px-3 py-2 mb-2 space-y-1.5">
                <div className="text-xs text-muted">Merged from {e.sourceCount} sources:</div>
                {e.sources.map((s) => (
                  <div key={s.id} className="flex items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2 min-w-0">
                      <AccountChip provider={s.sourceProvider} sourceType={s.sourceType} />
                      <Bidi className="truncate">{s.merchantRaw}</Bidi>
                      <span className="text-muted whitespace-nowrap">{formatDate(s.date)}</span>
                      {attachmentUrl(s) && (
                        <a href={attachmentUrl(s)!} target="_blank" rel="noreferrer" className="text-brand shrink-0">
                          📄 PDF
                        </a>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span>{formatMoney(s.amount, s.currency, { sign: true })}</span>
                      {s.mergedInto && (
                        <button
                          className="text-muted hover:text-rose-400"
                          onClick={async () => {
                            await api.unmerge(s.id);
                            onChanged?.();
                          }}
                        >
                          unmerge
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {receiptsFor === e.id && <ReceiptsPanel txnId={e.id} />}
          </Fragment>
        );
      })}
    </div>
  );
}

/** Attach / view manual receipt photos & PDFs for a transaction. */
function ReceiptsPanel({ txnId }: { txnId: string }): JSX.Element {
  const [items, setItems] = useState<Array<{ id: string; filename: string; mimeType: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function load(): Promise<void> {
    setLoading(true);
    try {
      const r = await api.listAttachments(txnId);
      setItems(r.attachments);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [txnId]);

  async function upload(file: File | undefined): Promise<void> {
    if (!file) return;
    setBusy(true);
    setErr(null);
    try {
      await api.uploadAttachment(txnId, file);
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-panel2/30 rounded-lg px-3 py-2 mb-2">
      <div className="text-xs text-muted mb-2">Receipts</div>
      {err && <div className="text-rose-400 text-xs mb-2">{err}</div>}
      {loading ? (
        <div className="text-muted text-xs">Loading…</div>
      ) : (
        <div className="flex flex-wrap gap-2 mb-2">
          {items.map((a) => (
            <div key={a.id} className="relative">
              <a href={api.attachmentFileUrl(a.id)} target="_blank" rel="noreferrer" title={a.filename}>
                {a.mimeType.startsWith('image/') ? (
                  <img src={api.attachmentFileUrl(a.id)} className="w-16 h-16 object-cover rounded-lg border border-edge" />
                ) : (
                  <div className="w-16 h-16 rounded-lg border border-edge flex items-center justify-center text-2xl">📄</div>
                )}
              </a>
              <button
                className="absolute -top-1.5 -right-1.5 bg-rose-600 text-white rounded-full w-5 h-5 text-xs leading-none"
                title="Delete receipt"
                onClick={async () => {
                  await api.deleteAttachment(a.id);
                  await load();
                }}
              >
                ×
              </button>
            </div>
          ))}
          {items.length === 0 && <div className="text-muted text-xs self-center">No receipts yet.</div>}
        </div>
      )}

      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => upload(e.target.files?.[0])}
      />
      <input
        ref={fileRef}
        type="file"
        accept="image/*,application/pdf"
        className="hidden"
        onChange={(e) => upload(e.target.files?.[0])}
      />
      <div className="flex gap-2">
        <Button variant="subtle" disabled={busy} onClick={() => cameraRef.current?.click()}>
          📷 Take photo
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => fileRef.current?.click()}>
          📎 Upload file
        </Button>
      </div>
    </div>
  );
}

/** Distinct accounts across a ledger entry's sources (provider + type). */
function distinctAccounts(e: LedgerEntry): Array<{ provider: string | null; sourceType: string }> {
  const seen = new Map<string, { provider: string | null; sourceType: string }>();
  for (const s of e.sources) {
    const key = `${s.sourceProvider ?? ''}|${s.sourceType}`;
    if (!seen.has(key)) seen.set(key, { provider: s.sourceProvider, sourceType: s.sourceType });
  }
  return [...seen.values()];
}

function CategoryPicker({
  categories,
  current,
  onPick,
  onCancel,
}: {
  categories: Category[];
  current: string | null;
  onPick: (cat: string | null, applyToMerchant: boolean) => void;
  onCancel: () => void;
}): JSX.Element {
  const [applyToMerchant, setApply] = useState(true);
  return (
    <span className="inline-flex items-center gap-1">
      <select
        autoFocus
        defaultValue={current ?? ''}
        className="bg-panel2 border border-edge rounded px-2 py-0.5 text-xs"
        onChange={(ev) => onPick(ev.target.value || null, applyToMerchant)}
      >
        <option value="">uncategorized</option>
        {categories.map((c) => (
          <option key={c.name} value={c.name}>
            {c.name}
          </option>
        ))}
      </select>
      <label className="text-[10px] text-muted flex items-center gap-0.5" title="Create a rule for this merchant">
        <input type="checkbox" checked={applyToMerchant} onChange={(e) => setApply(e.target.checked)} />
        rule
      </label>
      <button className="text-muted text-xs" onClick={onCancel}>
        ✕
      </button>
    </span>
  );
}
