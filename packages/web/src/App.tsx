import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Dashboard } from './pages/Dashboard';
import { ImportPage } from './pages/Import';
import { Transactions } from './pages/Transactions';
import { Duplicates } from './pages/Duplicates';
import { Rules } from './pages/Rules';
import { Insights } from './pages/Insights';
import { Settings } from './pages/Settings';

const NAV = [
  { to: '/dashboard', label: 'Home', icon: '◧' },
  { to: '/transactions', label: 'Ledger', icon: '≣' },
  { to: '/import', label: 'Import', icon: '⇪' },
  { to: '/insights', label: 'Insights', icon: '✦' },
  { to: '/settings', label: 'More', icon: '⚙' },
];

// Secondary destinations reachable from the "More"/sidebar.
const SECONDARY = [
  { to: '/duplicates', label: 'Duplicates', icon: '⧉' },
  { to: '/rules', label: 'Categories', icon: '⚑' },
];

const ALL = [...NAV.slice(0, 4), ...SECONDARY, NAV[4]!];

const TITLES: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/transactions': 'Transactions',
  '/import': 'Import',
  '/insights': 'Insights',
  '/duplicates': 'Duplicates',
  '/rules': 'Categories',
  '/settings': 'Settings',
};

export default function App(): JSX.Element {
  const loc = useLocation();
  const title = TITLES[loc.pathname] ?? 'Finance';

  return (
    <div className="min-h-screen flex">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-56 shrink-0 border-r border-edge bg-panel/50 flex-col">
        <div className="px-5 py-4 border-b border-edge">
          <div className="text-lg font-semibold text-ink">Finance</div>
          <div className="text-xs text-muted">local-first aggregator</div>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {ALL.map((n) => (
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
        <div className="p-4 text-xs text-muted border-t border-edge">All data stays on your machine.</div>
      </aside>

      <main className="flex-1 min-w-0 overflow-x-hidden pb-24 md:pb-0">
        {/* Mobile top header */}
        <header className="md:hidden sticky top-0 z-30 flex items-center justify-between px-4 h-14 bg-surface/90 backdrop-blur border-b border-edge">
          <span className="text-lg font-semibold">{title}</span>
          <span className="text-xs text-muted">Finance</span>
        </header>

        <div key={loc.pathname} className="rise-in max-w-6xl mx-auto p-4 sm:p-6">
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

      {/* Mobile bottom tab bar (iOS-style) */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-panel/95 backdrop-blur border-t border-edge pb-[env(safe-area-inset-bottom)]">
        <div className="flex justify-around">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              className={({ isActive }) =>
                `flex flex-col items-center justify-center gap-0.5 flex-1 py-2 text-[11px] transition-colors ${
                  isActive ? 'text-brand' : 'text-muted'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <span className={`text-lg leading-none ${isActive ? 'scale-110' : ''} transition-transform`}>
                    {n.icon}
                  </span>
                  {n.label}
                </>
              )}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
