import {
  type ButtonHTMLAttributes,
  type ReactNode,
  useEffect,
} from 'react';
import { Loader2, X, type LucideIcon } from 'lucide-react';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'quiet';
  size?: 'sm' | 'md';
  icon?: LucideIcon;
  busy?: boolean;
  children?: ReactNode;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon: Icon,
  busy = false,
  className = '',
  disabled,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type="button"
      className={`studio-button ${variant} ${size} ${className}`.trim()}
      disabled={disabled || busy}
      {...rest}
    >
      {busy ? (
        <Loader2 size={size === 'sm' ? 13 : 15} className="spin" aria-hidden />
      ) : Icon ? (
        <Icon size={size === 'sm' ? 13 : 15} aria-hidden />
      ) : null}
      {children}
    </button>
  );
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  size?: number;
  busy?: boolean;
}

export function IconButton({
  icon: Icon,
  label,
  active = false,
  size = 16,
  busy = false,
  className = '',
  disabled,
  ...rest
}: IconButtonProps) {
  return (
    <button
      type="button"
      className={`studio-icon-button ${active ? 'active' : ''} ${className}`.trim()}
      title={label}
      aria-label={label}
      disabled={disabled || busy}
      {...rest}
    >
      {busy ? <Loader2 size={size} className="spin" aria-hidden /> : <Icon size={size} aria-hidden />}
    </button>
  );
}

export function Badge({
  children,
  tone = 'neutral',
  className = '',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'muted';
  className?: string;
}) {
  return <span className={`studio-badge ${tone} ${className}`.trim()}>{children}</span>;
}

export function Section({
  title,
  eyebrow,
  count,
  action,
  children,
  className = '',
}: {
  title: ReactNode;
  eyebrow?: string;
  count?: number;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`inspector-section ${className}`.trim()}>
      <header className="inspector-section-head">
        <div>
          {eyebrow ? <div className="section-eyebrow">{eyebrow}</div> : null}
          <h3>
            {title}
            {count != null ? <span className="section-count">{count}</span> : null}
          </h3>
        </div>
        {action ? <div className="section-action">{action}</div> : null}
      </header>
      {children}
    </section>
  );
}

export function Stat({
  label,
  value,
  icon: Icon,
  tone = 'neutral',
}: {
  label: string;
  value: ReactNode;
  icon?: LucideIcon;
  tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger';
}) {
  return (
    <div className={`studio-stat ${tone}`}>
      {Icon ? (
        <span className="studio-stat-icon">
          <Icon size={15} aria-hidden />
        </span>
      ) : null}
      <span className="studio-stat-value">{value}</span>
      <span className="studio-stat-label">{label}</span>
    </div>
  );
}

export function Field({
  label,
  hint,
  error,
  required,
  children,
  wide = false,
}: {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  required?: boolean;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <label className={`studio-field ${wide ? 'wide' : ''}`.trim()}>
      <span className="studio-field-label">
        {label}
        {required ? <em>*</em> : null}
      </span>
      {children}
      {error ? <span className="studio-field-error">{error}</span> : hint ? <span className="studio-field-hint">{hint}</span> : null}
    </label>
  );
}

export function Modal({
  title,
  subtitle,
  icon: Icon,
  onClose,
  children,
  footer,
  width = 560,
  busy = false,
}: {
  title: string;
  subtitle?: string;
  icon?: LucideIcon;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
  busy?: boolean;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [busy, onClose]);

  return (
    <div
      className="studio-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div
        className="studio-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{ maxWidth: width }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="studio-modal-head">
          <div className="studio-modal-heading">
            {Icon ? (
              <span className="studio-modal-icon">
                <Icon size={18} aria-hidden />
              </span>
            ) : null}
            <div>
              <h2>{title}</h2>
              {subtitle ? <p>{subtitle}</p> : null}
            </div>
          </div>
          <IconButton icon={X} label="Close" onClick={onClose} disabled={busy} />
        </header>
        <div className="studio-modal-body">{children}</div>
        {footer ? <footer className="studio-modal-footer">{footer}</footer> : null}
      </div>
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="studio-spinner">
      <Loader2 size={24} className="spin" aria-hidden />
      {label ? <span>{label}</span> : null}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="studio-kbd">{children}</kbd>;
}
