import { useEffect, useState } from 'react';
import type { Category, CategoryRule } from '../api/client';
import { api } from '../api/client';
import { Badge, Bidi, Button, Card, Spinner } from '../components/ui';
import { categoryColor } from '../lib/colors';

export function Rules(): JSX.Element {
  const [categories, setCategories] = useState<Category[]>([]);
  const [rules, setRules] = useState<CategoryRule[]>([]);
  const [merchants, setMerchants] = useState<Array<{ merchant: string; count: number }>>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  const [pattern, setPattern] = useState('');
  const [ruleCat, setRuleCat] = useState('');
  const [matchType, setMatchType] = useState<'contains' | 'exact' | 'regex'>('contains');
  const [newCat, setNewCat] = useState('');

  async function load(): Promise<void> {
    setLoading(true);
    const [c, r, m] = await Promise.all([
      api.categories(),
      api.rules(),
      fetch('/api/insights/merchants').then((x) => x.json()),
    ]);
    setCategories(c.categories);
    setRules(r.rules);
    setMerchants(m.merchants ?? []);
    if (!ruleCat && c.categories[0]) setRuleCat(c.categories[0].name);
    setLoading(false);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function addRule(): Promise<void> {
    if (!pattern.trim() || !ruleCat) return;
    const res = await api.addRule(pattern.trim(), ruleCat, matchType);
    setMsg(`Rule added · ${res.recategorized} transactions recategorized.`);
    setPattern('');
    await load();
  }

  const uncategorizedMerchants = merchants.filter(
    (m) => !rules.some((r) => r.match_type === 'exact' && r.pattern === m.merchant),
  );

  if (loading) return <Spinner label="Loading categories…" />;

  return (
    <div className="space-y-4">
      <h1 className="hidden md:block text-2xl font-semibold">Categories & rules</h1>
      {msg && <Card className="border-brand/40"><div className="text-sm text-brand">{msg}</div></Card>}

      <Card>
        <h3 className="font-medium mb-3">Categories</h3>
        <div className="flex flex-wrap gap-2 mb-3">
          {categories.map((c) => {
            const color = categoryColor(c.name);
            return (
              <span
                key={c.name}
                className="flex items-center gap-1.5 rounded-full pl-2 pr-1 py-1 text-sm font-medium"
                style={{ background: `${color}22`, color }}
              >
                <span className="w-2 h-2 rounded-full" style={{ background: color }} />
                {c.name}
                {c.is_builtin === 0 && (
                  <button
                    className="opacity-70 hover:opacity-100 w-4"
                    onClick={async () => {
                      if (confirm(`Delete category "${c.name}"? Transactions become uncategorized.`)) {
                        await api.deleteCategory(c.name);
                        await load();
                      }
                    }}
                  >
                    ×
                  </button>
                )}
              </span>
            );
          })}
        </div>
        <div className="flex gap-2">
          <input
            className="input flex-1"
            placeholder="New category name"
            value={newCat}
            onChange={(e) => setNewCat(e.target.value)}
          />
          <Button
            onClick={async () => {
              if (newCat.trim()) {
                await api.addCategory(newCat.trim());
                setNewCat('');
                await load();
              }
            }}
          >
            Add
          </Button>
        </div>
      </Card>

      <Card>
        <h3 className="font-medium mb-3">Add a rule</h3>
        <div className="space-y-2">
          <input
            className="input"
            placeholder="Merchant text to match (e.g. שופרסל, wolt)"
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
          />
          <div className="grid grid-cols-2 gap-2">
            <select className="input" value={matchType} onChange={(e) => setMatchType(e.target.value as any)}>
              <option value="contains">contains</option>
              <option value="exact">exact</option>
              <option value="regex">regex</option>
            </select>
            <select className="input" value={ruleCat} onChange={(e) => setRuleCat(e.target.value)}>
              {categories.map((c) => (
                <option key={c.name} value={c.name}>{c.name}</option>
              ))}
            </select>
          </div>
          <div className="flex gap-2">
            <Button onClick={addRule} className="flex-1">Add rule</Button>
            <Button
              variant="ghost"
              onClick={async () => {
                const r = await api.recategorizeAll();
                setMsg(`${r.recategorized} transactions recategorized.`);
                await load();
              }}
            >
              Re-apply all
            </Button>
          </div>
        </div>
      </Card>

      <Card>
        <h3 className="font-medium mb-3">Rules ({rules.length})</h3>
        {rules.length === 0 ? (
          <div className="text-muted text-sm">No rules yet. Add one above, or recategorize a transaction to create one.</div>
        ) : (
          <div className="divide-y divide-edge/40">
            {rules.map((r) => {
              const color = categoryColor(r.category);
              return (
                <div key={r.id} className="flex items-center gap-2 py-2">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} />
                  <div className="flex-1 min-w-0">
                    <Bidi className="font-medium truncate block">{r.pattern}</Bidi>
                    <div className="text-xs text-muted flex items-center gap-2">
                      <span>{r.match_type}</span>
                      <span style={{ color }}>{r.category}</span>
                      {r.source === 'llm' && <Badge tone="email">AI</Badge>}
                    </div>
                  </div>
                  <button
                    className="text-muted hover:text-rose-400 text-sm shrink-0"
                    onClick={async () => {
                      await api.deleteRule(r.id);
                      await load();
                    }}
                  >
                    delete
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {uncategorizedMerchants.length > 0 && (
        <Card>
          <h3 className="font-medium mb-3">Merchants without an exact rule ({uncategorizedMerchants.length})</h3>
          <div className="flex flex-wrap gap-2">
            {uncategorizedMerchants.slice(0, 40).map((m) => (
              <button
                key={m.merchant}
                className="bg-panel2 rounded-full px-3 py-1 text-xs hover:bg-edge active:scale-95 transition-transform"
                onClick={() => setPattern(m.merchant)}
                title="Tap to fill the rule pattern"
              >
                <Bidi>{m.merchant}</Bidi> <span className="text-muted">×{m.count}</span>
              </button>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
