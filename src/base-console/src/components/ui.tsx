// Piezas comunes de la consola. Las tres pantallas usan estas y solo estas para paneles,
// datos, estados y botones, de modo que todo se vea y se comporte igual. Ver DESIGN.md.
import React, { useId, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { Level } from '@/engine/thresholds';
import { LEVEL_COLOR, PALETTE } from '@/theme';

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

/** Punto de estado. Siempre acompaña a un texto: el color nunca informa solo. */
export const StatusDot: React.FC<{ level: Level; pulse?: boolean; className?: string }> = ({ level, pulse, className }) => (
  <span
    aria-hidden
    className={cx('inline-block w-2 h-2 rounded-full shrink-0', pulse && 'hud-pulse', className)}
    style={{ background: level === 'none' ? PALETTE.muted : LEVEL_COLOR[level] }}
  />
);

/** Color de texto de un valor: lo normal va en tinta; solo ámbar y rojo se colorean. */
export function levelTextClass(level: Level | undefined): string {
  if (level === 'red') return 'text-danger-ink';
  if (level === 'amber') return 'text-warn';
  return 'text-ink';
}

interface PanelProps {
  title?: React.ReactNode;
  /** Texto corto a la derecha del título (una cifra, un estado). */
  aside?: React.ReactNode;
  /** Si se indica, el panel se puede plegar y este es su estado inicial. */
  defaultOpen?: boolean;
  className?: string;
  bodyClassName?: string;
  children: React.ReactNode;
}

/** Panel: superficie única con título opcional. Nunca se anida un panel dentro de otro. */
export const Panel: React.FC<PanelProps> = ({ title, aside, defaultOpen, className, bodyClassName, children }) => {
  const collapsible = defaultOpen !== undefined;
  const [open, setOpen] = useState(defaultOpen ?? true);
  const id = useId();
  return (
    <section className={cx('rounded-lg border border-line bg-panel', className)}>
      {title &&
        (collapsible ? (
          <h2>
            <button
              type="button"
              aria-expanded={open}
              aria-controls={id}
              onClick={() => setOpen((o) => !o)}
              className="w-full min-h-11 flex items-center justify-between gap-3 px-4 text-left cursor-pointer rounded-lg hover:bg-raised"
            >
              <span className="text-sm font-semibold text-ink">{title}</span>
              <span className="flex items-center gap-2 t-label text-ink-3">
                {aside}
                <ChevronDown className={cx('w-4 h-4 transition-transform', open && 'rotate-180')} aria-hidden />
              </span>
            </button>
          </h2>
        ) : (
          <div className="flex items-baseline justify-between gap-3 px-4 pt-3.5">
            <h2 className="text-sm font-semibold text-ink">{title}</h2>
            {aside && <span className="t-label text-ink-3">{aside}</span>}
          </div>
        ))}
      {open && (
        <div id={id} className={cx('px-4 pb-4', title ? 'pt-2.5' : 'pt-4', bodyClassName)}>
          {children}
        </div>
      )}
    </section>
  );
};

interface StatProps {
  label: string;
  value: React.ReactNode;
  unit?: string;
  /** Nota corta bajo el valor. */
  hint?: React.ReactNode;
  level?: Level;
  /** `lg` para la cifra clave de una pantalla; por defecto, tamaño de dato (16 px). */
  size?: 'md' | 'lg';
  className?: string;
}

/** Dato con su etiqueta encima. Sin caja propia: se alinea en una rejilla o una fila. */
export const Stat: React.FC<StatProps> = ({ label, value, unit, hint, level, size = 'md', className }) => (
  <div className={cx('min-w-0', className)}>
    <div className="t-label text-ink-3">{label}</div>
    <div className={cx('tabular-nums font-semibold', size === 'lg' ? 'text-[28px] leading-9' : 't-value', levelTextClass(level))}>
      {value}
      {unit && <span className="ml-1 t-label font-normal text-ink-3">{unit}</span>}
    </div>
    {hint && <div className="t-label text-ink-3 mt-0.5">{hint}</div>}
  </div>
);

/** Fila «etiqueta — valor» para listas de datos dentro de un panel. */
export const Row: React.FC<{ label: React.ReactNode; value: React.ReactNode; level?: Level }> = ({ label, value, level }) => (
  <div className="flex items-baseline justify-between gap-4 t-label py-1">
    <span className="text-ink-3">{label}</span>
    <span className={cx('text-right tabular-nums font-medium', levelTextClass(level))}>{value}</span>
  </div>
);

type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
}

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  // Una sola acción principal por pantalla.
  primary: 'bg-accent text-accent-ink font-semibold hover:brightness-110 disabled:bg-raised disabled:text-ink-3',
  secondary: 'border border-line-strong text-ink hover:bg-raised disabled:text-ink-3 disabled:border-line',
  quiet: 'text-ink-2 hover:text-ink hover:bg-raised disabled:text-ink-3',
  danger: 'bg-danger text-white font-semibold hover:brightness-110 disabled:bg-raised disabled:text-ink-3',
};

export const Button: React.FC<ButtonProps> = ({ variant = 'secondary', size = 'md', className, type, children, ...rest }) => (
  <button
    type={type ?? 'button'}
    className={cx(
      'inline-flex items-center justify-center gap-2 rounded-md text-sm transition-colors cursor-pointer disabled:cursor-not-allowed',
      size === 'sm' ? 'min-h-8 px-2.5' : 'min-h-10 px-3.5',
      BUTTON_VARIANT[variant],
      className,
    )}
    {...rest}
  >
    {children}
  </button>
);

/** Conmutador de dos o tres opciones excluyentes (modo de lupa, capa base, ruta/simulación). */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
}: {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (v: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={cx('inline-flex rounded-md border border-line bg-ground p-0.5', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            'min-h-8 px-3 rounded text-sm cursor-pointer transition-colors',
            value === o.value ? 'bg-raised text-ink font-medium' : 'text-ink-3 hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Detalle plegado: lo secundario se queda a un clic, sin ocupar la pantalla. */
export const Disclosure: React.FC<{ summary: string; defaultOpen?: boolean; className?: string; children: React.ReactNode }> = ({
  summary,
  defaultOpen = false,
  className,
  children,
}) => {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <div className={className}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="min-h-8 inline-flex items-center gap-1.5 t-label text-ink-2 hover:text-ink cursor-pointer rounded"
      >
        <ChevronDown className={cx('w-4 h-4 transition-transform', open && 'rotate-180')} aria-hidden />
        {summary}
      </button>
      {open && (
        <div id={id} className="pt-2">
          {children}
        </div>
      )}
    </div>
  );
};

/** Aviso en línea. `level` decide el tinte; el texto va siempre en tinta. */
export const Notice: React.FC<{ level: 'amber' | 'red' | 'green' | 'none'; role?: 'alert' | 'status'; className?: string; children: React.ReactNode }> = ({
  level,
  role,
  className,
  children,
}) => (
  <div
    role={role}
    className={cx(
      'flex items-start gap-2.5 rounded-md px-3 py-2.5 text-sm text-ink',
      level === 'red' && 'bg-danger-bg',
      level === 'amber' && 'bg-warn-bg',
      level === 'green' && 'bg-ok-bg',
      level === 'none' && 'bg-raised',
      className,
    )}
  >
    <StatusDot level={level} className="mt-1.5" />
    <div className="min-w-0">{children}</div>
  </div>
);
