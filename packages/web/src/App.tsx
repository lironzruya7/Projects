import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { Dashboard } from './pages/Dashboard';
import { ImportPage } from './pages/Import';
import { Transactions } from './pages/Transactions';
import { Duplicates } from './pages/Duplicates';
import { Rules } from './pages/Rules';
import { Insights } from './pages/Insights';
import { Settings } from './pages/Settings';

const NAV = [
  { to: '/dashboard', label: 'Dashboard', icon: '◧' },
  { to: '/transactions', label: 'Transactions', icon: '≣' },
  { to: '/import', label: 'Import', icon: '⇪' },
  { to: '/duplicates', label: 'Duplicates', icon: '⧉' },
  { to: '/insights', label: 'Insights', icon: '✦' },
  { to: '/rules', label: 'Categories', icon: '⚑' },
  { to: '/settings', label: 'Settings', icon: '⚙' },
];

export default function App(): JSX.Element {
  return (
    <div className="min-h-screen flex">
      <aside className="w-56 shrink-0 border-r border-edge bg-panel/50 flex flex-col">
        <div className="px-5 py-4 border-b border-edge">
          <div className="text-lg font-semibold text-ink">Finance</div>
          <div className="text-xs text-muted">local-first aggregator</div>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                  isActive ? 'bg-brand/20 text-brand' : 'text-muted hover:text-ink hover:bg-panel2'
                }`
              }
            >
              <span className="w-4 text-center">{n.icon}</span>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="p-4 text-xs text-muted border-t border-edge">
          All data stays on your machine.
        </div>
      </aside>

      <main className="flex-1 min-w-0 overflow-x-hidden">
        <div className="max-w-6xl mx-auto p-6">
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/transactions" element={<Transactions />} />
            <Route path="/import" element={<ImportPage />} />
            <Route path="/duplicates" element={<Duplicates />} />
            <Route path="/insights" element={<Insights />} />
            <Route path="/rules" element={<Rules />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}
