import type { ReactNode } from 'react';
import { hasHebrew } from '../lib/format';

/** Render text with correct direction for Hebrew/RTL even inside an LTR layout. */
export function Bidi({ children, className = '' }: { children: string; className?: string }): JSX.Element {
  return (
    <span dir={hasHebrew(children) ? 'rtl' : 'ltr'} className={`rtl-aware inline-block ${className}`}>
      {children}
    </span>
  );
}

export function Card({
  children,
  className = '',
  onClick,
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}): JSX.Element {
  return (
    <div className={`bg-panel border border-edge rounded-xl p-4 ${className}`} onClick={onClick}>
      {children}
    </div>
  );
}

export function StatCard({
  label,
  value,
  sub,
  accent,
  tint = '#38bdf8',
  icon,
  onClick,
}: {
  label: string;
  value: string;
  sub?: ReactNode;
  accent?: 'up' | 'down' | 'neutral';
  tint?: string;
  icon?: ReactNode;
  onClick?: () => void;
}): JSX.Element {
  const accentColor =
    accent === 'up' ? 'text-rose-400' : accent === 'down' ? 'text-emerald-400' : 'text-ink';
  return (
    <div
      className={`relative overflow-hidden bg-panel border border-edge rounded-2xl p-4 ${
        onClick ? 'cursor-pointer active:scale-[0.98] hover:border-brand transition-all' : ''
      }`}
      onClick={onClick}
      style={{ background: `linear-gradient(135deg, ${tint}14, transparent 60%)` }}
    >
      <div className="absolute left-0 top-0 h-full w-1" style={{ background: tint }} />
      <div className="flex items-center justify-between">
        <div className="text-muted text-xs uppercase tracking-wide">{label}</div>
        {icon && <span className="text-lg opacity-80" style={{ color: tint }}>{icon}</span>}
      </div>
      <div className={`text-2xl font-semibold mt-1 ${accentColor}`}>{value}</div>
      {sub && <div className="text-muted text-sm mt-1">{sub}</div>}
    </div>
  );
}

export function Badge({ children, tone = 'default' }: { children: ReactNode; tone?: 'default' | 'bank' | 'card' | 'email' | 'warn' | 'good' }): JSX.Element {
  const tones: Record<string, string> = {
    default: 'bg-panel2 text-muted',
    bank: 'bg-sky-500/20 text-sky-300',
    card: 'bg-violet-500/20 text-violet-300',
    email: 'bg-amber-500/20 text-amber-300',
    warn: 'bg-rose-500/20 text-rose-300',
    good: 'bg-emerald-500/20 text-emerald-300',
  };
  return <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${tones[tone]}`}>{children}</span>;
}

export function Button({
  children,
  onClick,
  variant = 'primary',
  disabled,
  type = 'button',
  className = '',
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'ghost' | 'danger' | 'subtle';
  disabled?: boolean;
  type?: 'button' | 'submit';
  className?: string;
}): JSX.Element {
  const variants: Record<string, string> = {
    primary: 'bg-brand text-slate-900 hover:bg-sky-300 font-medium',
    ghost: 'bg-transparent border border-edge text-ink hover:border-brand',
    subtle: 'bg-panel2 text-ink hover:bg-edge',
    danger: 'bg-rose-600 text-white hover:bg-rose-500',
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`px-3 py-1.5 rounded-lg text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${variants[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

export function Spinner({ label }: { label?: string }): JSX.Element {
  return (
    <div className="flex items-center gap-2 text-muted text-sm">
      <div className="w-4 h-4 border-2 border-edge border-t-brand rounded-full animate-spin" />
      {label}
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
}): JSX.Element | null {
  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div
        className={`bg-panel border border-edge rounded-xl p-5 mt-12 w-full ${wide ? 'max-w-3xl' : 'max-w-lg'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">{title}</h3>
          <button onClick={onClose} className="text-muted hover:text-ink text-xl leading-none">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
