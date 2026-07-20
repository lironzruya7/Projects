import { Fragment, useState } from 'react';
import type { Category, LedgerEntry } from '../api/client';
import { api } from '../api/client';
import { formatDate, formatMoney } from '../lib/format';
import { Badge, Bidi, Button } from './ui';

function sourceTone(t: string): 'bank' | 'card' | 'email' {
  return t === 'bank' ? 'bank' : t === 'card' ? 'card' : 'email';
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

  if (entries.length === 0) {
    return <div className="text-muted text-sm py-8 text-center">No transactions match.</div>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-muted text-left border-b border-edge">
            <th className="py-2 pr-2 font-medium">Date</th>
            <th className="py-2 pr-2 font-medium">Merchant</th>
            <th className="py-2 pr-2 font-medium">Category</th>
            <th className="py-2 pr-2 font-medium">Source</th>
            <th className="py-2 pl-2 font-medium text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <Fragment key={e.id}>
              <tr className="border-b border-edge/50 hover:bg-panel2/40">
                <td className="py-2 pr-2 whitespace-nowrap text-muted">{formatDate(e.date)}</td>
                <td className="py-2 pr-2">
                  <div className="flex items-center gap-2">
                    {e.sourceCount > 1 && (
                      <button
                        className="text-brand text-xs"
                        onClick={() => setExpanded(expanded === e.id ? null : e.id)}
                        title={`${e.sourceCount} sources merged`}
                      >
                        {expanded === e.id ? '▼' : '▶'}
                      </button>
                    )}
                    <Bidi className="font-medium">{e.merchantNormalized || e.merchantRaw || '(unknown)'}</Bidi>
                    {e.sourceCount > 1 && <Badge tone="good">×{e.sourceCount}</Badge>}
                  </div>
                  {e.description && e.description !== e.merchantRaw && (
                    <Bidi className="text-muted text-xs">{e.description}</Bidi>
                  )}
                </td>
                <td className="py-2 pr-2">
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
                      className="text-left"
                      onClick={() => setEditing(e.id)}
                      title="Click to recategorize"
                    >
                      {e.category ? (
                        <span className="px-2 py-0.5 rounded bg-panel2 text-ink">{e.category}</span>
                      ) : (
                        <span className="text-muted italic">uncategorized</span>
                      )}
                      {e.categorySource === 'llm' && <span className="ml-1 text-xs text-amber-300">AI</span>}
                    </button>
                  )}
                </td>
                <td className="py-2 pr-2">
                  <div className="flex gap-1 flex-wrap">
                    {e.sourceTypes.map((t) => (
                      <Badge key={t} tone={sourceTone(t)}>
                        {t}
                      </Badge>
                    ))}
                  </div>
                </td>
                <td className={`py-2 pl-2 text-right whitespace-nowrap font-medium ${e.amount < 0 ? 'text-ink' : 'text-emerald-400'}`}>
                  {formatMoney(e.amount, e.currency, { sign: true })}
                </td>
              </tr>
              {expanded === e.id && (
                <tr className="bg-panel2/30">
                  <td colSpan={5} className="px-4 py-2">
                    <div className="text-xs text-muted mb-1">Merged from {e.sourceCount} sources:</div>
                    <div className="space-y-1">
                      {e.sources.map((s) => (
                        <div key={s.id} className="flex items-center justify-between gap-3 text-xs">
                          <div className="flex items-center gap-2">
                            <Badge tone={sourceTone(s.sourceType)}>{s.sourceType}</Badge>
                            <span className="text-muted">{s.sourceProvider ?? ''}</span>
                            <Bidi>{s.merchantRaw}</Bidi>
                            <span className="text-muted">{formatDate(s.date)}</span>
                            <span className="text-muted">{s.sourceRef}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span>{formatMoney(s.amount, s.currency, { sign: true })}</span>
                            {s.mergedInto && (
                              <Button
                                variant="ghost"
                                onClick={async () => {
                                  await api.unmerge(s.id);
                                  onChanged?.();
                                }}
                              >
                                unmerge
                              </Button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
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
    <div className="flex items-center gap-1">
      <select
        autoFocus
        defaultValue={current ?? ''}
        className="bg-panel2 border border-edge rounded px-2 py-1 text-sm"
        onChange={(ev) => onPick(ev.target.value || null, applyToMerchant)}
      >
        <option value="">uncategorized</option>
        {categories.map((c) => (
          <option key={c.name} value={c.name}>
            {c.name}
          </option>
        ))}
      </select>
      <label className="text-xs text-muted flex items-center gap-1" title="Create a rule for this merchant">
        <input type="checkbox" checked={applyToMerchant} onChange={(e) => setApply(e.target.checked)} />
        rule
      </label>
      <button className="text-muted text-xs" onClick={onCancel}>
        ✕
      </button>
    </div>
  );
}
