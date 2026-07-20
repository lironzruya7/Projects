import { useEffect, useState } from 'react';
import type { Category, CategoryRule } from '../api/client';
import { api } from '../api/client';
import { Badge, Bidi, Button, Card, Spinner } from '../components/ui';

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
      <h1 className="text-2xl font-semibold">Categories & rules</h1>
      {msg && <Card className="border-brand/40"><div className="text-sm text-brand">{msg}</div></Card>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <h3 className="font-medium mb-3">Categories</h3>
          <div className="flex flex-wrap gap-2 mb-3">
            {categories.map((c) => (
              <span key={c.name} className="flex items-center gap-1 bg-panel2 rounded px-2 py-1 text-sm">
                {c.name}
                {c.is_builtin === 0 && (
                  <button
                    className="text-muted hover:text-rose-400"
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
            ))}
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
            <div className="flex gap-2">
              <select className="input flex-1" value={matchType} onChange={(e) => setMatchType(e.target.value as any)}>
                <option value="contains">contains</option>
                <option value="exact">exact</option>
                <option value="regex">regex</option>
              </select>
              <select className="input flex-1" value={ruleCat} onChange={(e) => setRuleCat(e.target.value)}>
                {categories.map((c) => (
                  <option key={c.name} value={c.name}>{c.name}</option>
                ))}
              </select>
              <Button onClick={addRule}>Add</Button>
            </div>
            <Button variant="ghost" onClick={async () => { const r = await api.recategorizeAll(); setMsg(`${r.recategorized} transactions recategorized.`); await load(); }}>
              Re-apply all rules
            </Button>
          </div>
        </Card>
      </div>

      <Card>
        <h3 className="font-medium mb-3">Rules ({rules.length})</h3>
        {rules.length === 0 ? (
          <div className="text-muted text-sm">No rules yet. Add one above, or recategorize a transaction to create one.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted text-left border-b border-edge">
                  <th className="py-2 pr-2 font-medium">Pattern</th>
                  <th className="py-2 pr-2 font-medium">Match</th>
                  <th className="py-2 pr-2 font-medium">Category</th>
                  <th className="py-2 pr-2 font-medium">Source</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rules.map((r) => (
                  <tr key={r.id} className="border-b border-edge/40">
                    <td className="py-1.5 pr-2"><Bidi>{r.pattern}</Bidi></td>
                    <td className="py-1.5 pr-2 text-muted">{r.match_type}</td>
                    <td className="py-1.5 pr-2">{r.category}</td>
                    <td className="py-1.5 pr-2">
                      <Badge tone={r.source === 'llm' ? 'email' : 'default'}>{r.source}</Badge>
                    </td>
                    <td className="py-1.5 text-right">
                      <button className="text-muted hover:text-rose-400" onClick={async () => { await api.deleteRule(r.id); await load(); }}>
                        delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
                className="bg-panel2 rounded px-2 py-1 text-xs hover:bg-edge"
                onClick={() => setPattern(m.merchant)}
                title="Click to fill the rule pattern"
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
