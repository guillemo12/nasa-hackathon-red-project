import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, Pause, Play, RotateCcw, WifiOff, X } from 'lucide-react';
import type { ApiHealth } from '@/engine/apiClient';
import { P1_CONSTANTS, classify } from '@/engine/thresholds';
import { causeLabel, formatT } from '@/engine/evaModel';
import { fmt } from '@/engine/geo';
import { T_DECISION_MIN, T_START_MIN, UX_LABELS, waypoint } from '@/data/missionData';
import { LEVEL_COLOR, PALETTE, RADIO_CLASS_LEVEL, STATE_STYLE, TONE_COLOR } from '@/theme';
import type { Level } from '@/engine/thresholds';
import type { ConsoleView, Eva07Sample, SyncState, Tone } from '@/types/mission';

export interface ToastMessage {
  id: number;
  title: string;
  detail?: string;
  tone?: Tone;
}

interface ConsoleShellProps {
  activeView: ConsoleView;
  onSelectView: (view: ConsoleView) => void;
  sample: Eva07Sample;
  sync: SyncState;
  apiHealth: ApiHealth | null;
  apiChecked: boolean;
  isLive: boolean;
  onToggleLive: () => void;
  onResetClock: () => void;
  toast: ToastMessage | null;
  onDismissToast: () => void;
  children: React.ReactNode;
}

const NAV: Array<{ view: ConsoleView; label: string }> = [
  { view: '3d-console', label: 'Cartografía' },
  { view: 'route-planificator', label: 'Planificador' },
  { view: 'eva-hud-nominal', label: 'Telemetría EVA' },
];

const SYNC_LABEL: Record<SyncState['status'], { text: string; level: Level }> = {
  idle: { text: 'Pendiente', level: 'none' },
  syncing: { text: 'En curso…', level: 'none' },
  ok: { text: 'Verificada', level: 'green' },
  error: { text: 'Fallida', level: 'red' },
};

const RADIO_TEXT: Record<string, string> = { VERDE: 'bueno', AMBAR: 'débil', ROJO: 'cortado' };

/** Punto de color con su texto: el color nunca va solo. */
const Dot: React.FC<{ level: Level; pulse?: boolean }> = ({ level, pulse }) => (
  <span
    aria-hidden
    className={`inline-block w-2 h-2 rounded-full shrink-0 ${pulse ? 'hud-pulse' : ''}`}
    style={{ background: level === 'none' ? PALETTE.muted : LEVEL_COLOR[level] }}
  />
);

export const ConsoleShell: React.FC<ConsoleShellProps> = ({
  activeView,
  onSelectView,
  sample,
  sync,
  apiHealth,
  apiChecked,
  isLive,
  onToggleLive,
  onResetClock,
  toast,
  onDismissToast,
  children,
}) => {
  const [diagOpen, setDiagOpen] = useState(false);
  const diagRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!toast && !diagOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (diagOpen) setDiagOpen(false);
      else onDismissToast();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toast, diagOpen, onDismissToast]);

  useEffect(() => {
    if (!diagOpen) return;
    const onDown = (e: PointerEvent) => {
      if (diagRef.current && !diagRef.current.contains(e.target as Node)) setDiagOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [diagOpen]);

  const isEvaView = activeView === 'eva-hud-nominal' || activeView === 'eva-emergency';
  const state = STATE_STYLE[sample.guardrail.state];
  const radioLevel = RADIO_CLASS_LEVEL[sample.values.radio_class] ?? 'none';
  const tauLevel = classify('dust_tau_880nm', sample.values.dust_tau);
  const apiDown = apiChecked && !apiHealth;
  const navActive = (view: ConsoleView) => (view === 'eva-hud-nominal' ? isEvaView : activeView === view);
  const preEva = sample.guardrail.state === 'PRE_EVA';

  // Posición de la astronauta en el instante del reloj.
  const from = waypoint(sample.position.from);
  const to = waypoint(sample.position.to);
  const elevApprox =
    from && to ? from.elevMolaM + (to.elevMolaM - from.elevMolaM) * sample.position.frac : null;
  const where =
    sample.position.from === sample.position.to
      ? sample.position.from
      : `Entre ${sample.position.from} y ${sample.position.to}`;

  const stateText =
    sample.guardrail.state === 'CAUTION' || sample.guardrail.state === 'MULTI_HAZARD'
      ? `${state.short}: ${causeLabel(sample)}`
      : state.label;
  // Cartografía y Planificador son pantallas de preparación: si el reloj está dentro de la EVA,
  // el estado dice de forma explícita que corresponde a ese minuto de la salida.
  const pillText = !isEvaView && !preEva ? `EVA-07 en ${formatT(sample.t_min)} · ${stateText}` : stateText;
  const alarming = sample.guardrail.state === 'EVAC_SHELTER' || sample.guardrail.state === 'MULTI_HAZARD';

  // Resumen de sistema: un solo punto en la cabecera; el detalle va en el desplegable.
  const systemLevel: Level = !apiChecked
    ? 'none'
    : apiDown || sync.status === 'error' || radioLevel === 'red'
      ? 'red'
      : radioLevel === 'amber'
        ? 'amber'
        : 'green';
  const systemText = !apiChecked
    ? 'Comprobando'
    : apiDown
      ? 'Sin motor'
      : radioLevel === 'red'
        ? 'Sin enlace'
        : radioLevel === 'amber'
          ? 'Enlace débil'
          : 'Sistema';

  const rows: Array<{ k: string; v: string; level?: Level }> = [
    {
      k: 'Enlace con el traje',
      v: `${fmt(sample.values.radio_rssi_dbm, 1)} dBm · ${RADIO_TEXT[sample.values.radio_class] ?? '—'}`,
      level: radioLevel,
    },
    {
      k: 'Posición',
      v:
        sample.position.lat !== null && sample.position.lon_e !== null
          ? `${where} · ${fmt(Math.abs(sample.position.lat), 4)}°S ${fmt(sample.position.lon_e, 4)}°E${
              elevApprox !== null ? ` · ${fmt(elevApprox)} m` : ''
            }`
          : where,
    },
    { k: 'Destino viable', v: preEva ? '—' : sample.values.viable_destination },
    {
      k: 'Motor de cálculo',
      v: !apiChecked ? 'Comprobando…' : apiHealth ? 'En línea' : 'Sin conexión',
      level: !apiChecked ? 'none' : apiHealth ? 'green' : 'red',
    },
    {
      k: 'Terreno cargado',
      v: apiHealth ? `${fmt(apiHealth.h3_res12_cells)} celdas (20 m)` : 'No disponible',
    },
    {
      k: 'Reglas de seguridad',
      v: preEva
        ? 'En espera'
        : `${state.code} · ${sample.source === 'api' ? 'calculadas por el motor' : 'copia local'}`,
      level: preEva ? undefined : sample.source === 'api' ? 'green' : 'amber',
    },
    { k: 'Sincronización del traje', v: SYNC_LABEL[sync.status].text, level: SYNC_LABEL[sync.status].level },
    {
      k: 'Atmósfera en la Base',
      v: `${fmt(P1_CONSTANTS.surface_pressure_pa_site)} Pa · polvo τ ${fmt(sample.values.dust_tau, 1)}`,
      level: tauLevel,
    },
  ];

  return (
    <div className="h-screen w-full bg-ground text-ink flex flex-col overflow-hidden">
      <a
        href="#contenido"
        className="sr-only focus:not-sr-only focus:absolute focus:z-[60] focus:top-2 focus:left-2 focus:bg-ink focus:text-ground focus:px-3 focus:py-2 focus:rounded"
      >
        Saltar al contenido
      </a>

      <header className="relative z-40 shrink-0 bg-sunken border-b border-line">
        <div className="px-3 sm:px-5 flex flex-wrap items-center gap-x-6 gap-y-1 min-h-14">
          <div className="flex items-center gap-2 shrink-0 py-2">
            <span className="w-2 h-2 rounded-full bg-accent" aria-hidden />
            <span className="text-[15px] font-semibold tracking-tight text-ink">R.E.D. Atlas</span>
            <span className="hidden xl:inline t-label text-ink-3">Melas Chasma · sol {UX_LABELS.sol}</span>
          </div>

          <nav aria-label="Pantallas" className="order-last md:order-none w-full md:w-auto flex gap-1 overflow-x-auto self-stretch">
            {NAV.map(({ view, label }) => (
              <button
                key={view}
                type="button"
                onClick={() => onSelectView(view)}
                aria-current={navActive(view) ? 'page' : undefined}
                className={`min-h-10 shrink-0 px-3 text-sm border-b-2 transition-colors cursor-pointer ${
                  navActive(view)
                    ? 'border-accent text-ink font-medium'
                    : 'border-transparent text-ink-3 hover:text-ink'
                }`}
              >
                {label}
              </button>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2 sm:gap-3 flex-wrap py-2">
            <span
              role="status"
              aria-label={`Estado: ${pillText}`}
              className={`hidden sm:flex items-center gap-2 min-h-8 px-2.5 rounded-md t-label ${
                alarming ? 'bg-danger-bg text-ink' : 'text-ink-2'
              }`}
              style={alarming ? { background: sample.guardrail.state === 'MULTI_HAZARD' ? 'var(--color-warn-bg)' : undefined } : undefined}
            >
              <span
                aria-hidden
                className={`w-2 h-2 rounded-full shrink-0 ${state.pulse ? 'hud-pulse' : ''}`}
                style={{ background: sample.guardrail.state === 'NOMINAL' ? PALETTE.green : state.color }}
              />
              <span className="font-medium">{pillText}</span>
            </span>

            <div className="flex items-center rounded-md border border-line bg-panel" aria-label="Reloj de misión">
              <button
                type="button"
                onClick={onToggleLive}
                aria-pressed={isLive}
                aria-label={isLive ? 'Pausar el reloj de la EVA' : 'Poner en marcha el reloj de la EVA'}
                title="Un minuto de misión por segundo"
                className="w-9 h-9 flex items-center justify-center rounded-l-md text-ink-2 hover:text-ink hover:bg-raised cursor-pointer"
              >
                {isLive ? <Pause className="w-4 h-4" aria-hidden /> : <Play className="w-4 h-4" aria-hidden />}
              </button>
              <div className="px-2 leading-tight tabular-nums border-x border-line">
                <div className="text-sm font-semibold text-ink">{formatT(sample.t_min)}</div>
                <div className="text-xs text-ink-3">
                  {sample.lmst} local · {isLive ? 'en marcha' : 'en pausa'}
                </div>
              </div>
              <button
                type="button"
                onClick={onResetClock}
                aria-label={`Volver al inicio (${formatT(T_START_MIN)})`}
                title={`Volver a ${formatT(T_START_MIN)}`}
                className="w-9 h-9 flex items-center justify-center rounded-r-md text-ink-3 hover:text-ink hover:bg-raised cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" aria-hidden />
              </button>
            </div>

            <div ref={diagRef} className="relative">
              <button
                type="button"
                onClick={() => setDiagOpen((o) => !o)}
                aria-expanded={diagOpen}
                aria-controls="panel-sistema"
                className="min-h-9 flex items-center gap-2 px-2.5 rounded-md border border-line bg-panel text-sm text-ink-2 hover:text-ink hover:bg-raised cursor-pointer"
              >
                <Dot level={systemLevel} />
                <span>{systemText}</span>
                <ChevronDown className={`w-4 h-4 transition-transform ${diagOpen ? 'rotate-180' : ''}`} aria-hidden />
              </button>
              {diagOpen && (
                <div
                  id="panel-sistema"
                  className="absolute right-0 top-full mt-2 w-[min(22rem,calc(100vw-1.5rem))] rounded-lg border border-line bg-panel shadow-[0_12px_32px_-8px_rgba(0,0,0,0.6)] p-4"
                >
                  <h2 className="text-sm font-semibold text-ink mb-3">Estado del sistema</h2>
                  <dl className="space-y-2.5">
                    {rows.map((row) => (
                      <div key={row.k} className="flex items-start justify-between gap-4 t-label">
                        <dt className="text-ink-3 shrink-0">{row.k}</dt>
                        <dd className="text-right text-ink tabular-nums flex items-center gap-1.5">
                          {row.level && <Dot level={row.level} />}
                          <span>{row.v}</span>
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => onSelectView('eva-emergency')}
              title={`Abre la Telemetría EVA en ${formatT(T_DECISION_MIN)}, cuando coinciden las cuatro amenazas`}
              className="min-h-9 px-3 rounded-md border border-danger/50 text-sm font-medium text-danger-ink hover:bg-danger-bg cursor-pointer"
            >
              Simular emergencia
            </button>
          </div>
        </div>
      </header>

      {apiDown && (
        <div role="alert" className="shrink-0 flex items-start gap-2.5 px-4 sm:px-5 py-2.5 bg-warn-bg border-b border-line text-sm text-ink">
          <WifiOff className="w-4 h-4 shrink-0 mt-0.5 text-warn" aria-hidden />
          <span>
            <strong className="font-semibold">Sin conexión con el motor de cálculo.</strong> Ves los datos guardados de la misión.
            El mapa 3D, la lupa, el plan de ruta, la simulación y la sincronización del traje vuelven solos cuando se
            recupere la conexión.
          </span>
        </div>
      )}

      <main id="contenido" tabIndex={-1} className="relative flex-1 min-h-0 overflow-y-auto p-3 sm:p-4 lg:p-5 focus:outline-none">
        {children}
      </main>

      {toast && (
        <div
          key={toast.id}
          role={toast.tone === 'red' ? 'alert' : 'status'}
          aria-live={toast.tone === 'red' ? 'assertive' : 'polite'}
          className="fixed top-16 right-3 sm:right-5 z-50 max-w-sm w-[calc(100%-1.5rem)] sm:w-auto rounded-lg border border-line bg-panel shadow-[0_12px_32px_-8px_rgba(0,0,0,0.6)] px-4 py-3 flex items-start gap-3"
        >
          <span
            aria-hidden
            className="mt-1.5 w-2 h-2 rounded-full shrink-0"
            style={{ background: toast.tone && toast.tone !== 'cyan' ? TONE_COLOR[toast.tone] : PALETTE.accent }}
          />
          <div className="min-w-0">
            <div className="text-sm font-semibold text-ink">{toast.title}</div>
            {toast.detail && <div className="t-label text-ink-2 mt-1">{toast.detail}</div>}
          </div>
          <button
            type="button"
            onClick={onDismissToast}
            aria-label="Cerrar aviso"
            className="shrink-0 w-8 h-8 -mr-1 -mt-1 flex items-center justify-center rounded-md text-ink-3 hover:text-ink hover:bg-raised cursor-pointer"
          >
            <X className="w-4 h-4" aria-hidden />
          </button>
        </div>
      )}
    </div>
  );
};
