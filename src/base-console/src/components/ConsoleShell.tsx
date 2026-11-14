import React, { useEffect, useState } from 'react';
import {
  Compass,
  Route,
  UserCheck,
  Radio,
  ShieldAlert,
  User,
} from 'lucide-react';
import type { ApiHealth } from '@/engine/apiClient';
import type { ConsoleView, Eva07Event } from '@/types/mission';

interface ToastMessage {
  title: string;
  detail?: string;
  tone?: 'cyan' | 'green' | 'amber' | 'red';
}

interface ConsoleShellProps {
  activeView: ConsoleView;
  onSelectView: (view: ConsoleView) => void;
  currentEvent: Eva07Event;
  zenohSynced: boolean;
  apiHealth: ApiHealth | null;
  isLive?: boolean;
  telemetryFromApi?: boolean;
  onToggleLive?: () => void;
  toast?: ToastMessage | null;
  onDismissToast?: () => void;
  children: React.ReactNode;
}

export const ConsoleShell: React.FC<ConsoleShellProps> = ({
  activeView,
  onSelectView,
  currentEvent,
  zenohSynced,
  apiHealth,
  isLive = true,
  telemetryFromApi = false,
  onToggleLive,
  toast = null,
  onDismissToast,
  children,
}) => {
  const [localTime, setLocalTime] = useState(() =>
    new Date().toLocaleTimeString('es-ES', { hour12: false })
  );

  useEffect(() => {
    const id = window.setInterval(() => {
      setLocalTime(new Date().toLocaleTimeString('es-ES', { hour12: false }));
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  const isEmergency =
    activeView === 'eva-emergency' ||
    (currentEvent.active_threats.length >= 2 && currentEvent.t_min < 114);
  const isCaution = !isEmergency && (currentEvent.active_threats.length === 1 || currentEvent.values.radio_class !== 'VERDE');

  const statusPill = isEmergency
    ? { label: 'EMERGENCIA SPE + NLOS', cls: 'bg-[#FF1744]/20 text-[#FF1744] border-[#FF1744]/50' }
    : isCaution
      ? { label: 'PRECAUCIÓN // NLOS', cls: 'bg-[#FFE600]/15 text-[#FFE600] border-[#FFE600]/40' }
      : { label: 'SOL 142 · NOMINAL', cls: 'bg-[#00FFA3]/15 text-[#00FFA3] border-[#00FFA3]/40' };

  const radioColor =
    currentEvent.values.radio_class === 'VERDE'
      ? 'text-[#00FFA3]'
      : currentEvent.values.radio_class === 'AMBAR'
        ? 'text-[#FFE600]'
        : 'text-[#FF1744]';

  return (
    <div className="h-screen w-full bg-[#0B0E14] text-slate-100 flex flex-col overflow-hidden">
      <div className="flex flex-1 min-h-0">
        {/* Left Navigation Sidebar */}
        <aside className="w-56 shrink-0 bg-[#0D1119] border-r border-[#1E2738] flex flex-col justify-between p-4 select-none overflow-y-auto">
          <div className="space-y-6">
            <div className="flex items-center gap-2.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-[#FF9100] shadow-[0_0_8px_#FF9100]" />
              <span className="font-mono-tech text-xs font-bold tracking-widest text-slate-200">
                ATLAS OPS CORE
              </span>
            </div>

            <div className="space-y-1.5">
              <div className="text-[10px] font-mono-tech uppercase tracking-widest text-slate-500 px-2 pb-1">
                Subsystems
              </div>
              <button
                type="button"
                onClick={() => onSelectView('3d-console')}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition ${
                  activeView === '3d-console'
                    ? 'bg-[#00F5D4]/15 text-[#00F5D4] border border-[#00F5D4]/40'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-white/5 border border-transparent'
                }`}
              >
                <Compass className="w-4 h-4 shrink-0" />
                <span>Cartografía 3D</span>
              </button>
              <button
                type="button"
                onClick={() => onSelectView('route-planificator')}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition ${
                  activeView === 'route-planificator'
                    ? 'bg-[#00F5D4]/15 text-[#00F5D4] border border-[#00F5D4]/40'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-white/5 border border-transparent'
                }`}
              >
                <Route className="w-4 h-4 shrink-0" />
                <span>Planificador</span>
              </button>
              <button
                type="button"
                onClick={() => onSelectView('eva-hud-nominal')}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition ${
                  activeView === 'eva-hud-nominal'
                    ? 'bg-[#00F5D4]/15 text-[#00F5D4] border border-[#00F5D4]/40'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-white/5 border border-transparent'
                }`}
              >
                <UserCheck className="w-4 h-4 shrink-0" />
                <span>Telemetría EVA</span>
              </button>
            </div>

            <div className="space-y-2 pt-2 border-t border-[#1E2738]">
              <div className="text-[10px] font-mono-tech uppercase tracking-widest text-slate-500">
                Diagnostics
              </div>
              <div className="flex items-center justify-between text-[11px] font-mono-tech">
                <span className="text-slate-500">LINK ZENOH</span>
                <span className={radioColor}>
                  {currentEvent.values.radio_rssi_dbm.toFixed(1)} dBm
                </span>
              </div>
              <div className="flex items-center justify-between text-[11px] font-mono-tech">
                <span className="text-slate-500">H3O MESH</span>
                <span className="text-[#00F5D4]">RES-12 / 9</span>
              </div>
              <div className="flex items-center justify-between text-[11px] font-mono-tech">
                <span className="text-slate-500">D* LITE</span>
                <span className={isEmergency ? 'text-[#FF1744]' : 'text-[#00FFA3]'}>
                  {isEmergency ? 'WP3 SWITCH' : 'NOMINAL'}
                </span>
              </div>
              <div className="flex items-center justify-between text-[11px] font-mono-tech">
                <span className="text-slate-500">RUST API</span>
                <span className={apiHealth ? 'text-[#00FFA3]' : 'text-[#FFE600]'}>
                  {apiHealth ? `ONLINE (${apiHealth.h3_cells_loaded} H3)` : 'FALLBACK'}
                </span>
              </div>
              <div className="flex items-center justify-between text-[11px] font-mono-tech">
                <span className="text-slate-500">SUIT SYNC</span>
                <span className={zenohSynced ? 'text-[#00FFA3]' : 'text-[#FFE600]'}>
                  {zenohSynced ? 'LOCKED' : 'PENDING'}
                </span>
              </div>
            </div>
          </div>

          <div className="bg-[#111622] border border-[#1E2738] rounded-xl p-3 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono-tech uppercase tracking-wider text-slate-400">
                Atmosphere Chasma
              </span>
              <span className="w-2 h-2 rounded-full bg-[#00FFA3]" />
            </div>
            <div className="font-mono-tech text-sm font-bold text-slate-100">
              708 Pa · -62°C
            </div>
            <div className="font-mono-tech text-[11px] text-slate-400">
              Dust opacity τ{' '}
              <span className={currentEvent.values.dust_tau >= 2 ? 'text-[#FF9100] font-bold' : 'text-slate-200'}>
                {currentEvent.values.dust_tau.toFixed(1)}
              </span>
            </div>
          </div>
        </aside>

        {/* Main Content Column */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Top Bar */}
          <header className="h-14 shrink-0 bg-[#0D1119] border-b border-[#1E2738] px-5 flex items-center justify-between gap-4">
            <div className="flex items-center gap-4 min-w-0">
              <div className="flex items-baseline gap-2 shrink-0">
                <span className="font-mono-tech text-base font-extrabold tracking-wider text-white">
                  ATLAS
                </span>
                <span className="text-[11px] font-mono-tech text-slate-400 hidden sm:inline">
                  // Melas Chasma SW Ops
                </span>
              </div>
              <span className={`px-2.5 py-0.5 rounded-full border font-mono-tech text-[11px] font-semibold shrink-0 ${statusPill.cls}`}>
                ● {statusPill.label}
              </span>
            </div>

            <div className="flex items-center gap-4 shrink-0">
              {onToggleLive && (
                <button
                  type="button"
                  onClick={onToggleLive}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border font-mono-tech text-[11px] font-bold transition cursor-pointer ${
                    isLive
                      ? telemetryFromApi
                        ? 'bg-[#00FFA3]/15 border-[#00FFA3]/50 text-[#00FFA3]'
                        : 'bg-[#FFE600]/15 border-[#FFE600]/50 text-[#FFE600]'
                      : 'bg-[#111622] border-[#1E2738] text-slate-400 hover:text-white'
                  }`}
                  title="Pausar/Reanudar flujo en tiempo real desde GET /api/eva07 (Rust API)"
                >
                  <span
                    className={`w-2 h-2 rounded-full ${
                      isLive ? (telemetryFromApi ? 'bg-[#00FFA3]' : 'bg-[#FFE600]') : 'bg-slate-500'
                    }`}
                  />
                  <span>
                    {isLive ? (telemetryFromApi ? 'EN VIVO · API' : 'EN VIVO · LOCAL') : 'PAUSA'}
                  </span>
                </button>
              )}
              <div className="text-right font-mono-tech tabular-nums min-w-[138px]">
                <div className="text-xs font-bold text-slate-100">{localTime}</div>
                <div className="text-[10px] text-slate-400">
                  LMST {currentEvent.lmst} · T{currentEvent.t_min >= 0 ? `+${Math.round(currentEvent.t_min)}` : Math.round(currentEvent.t_min)}m
                </div>
              </div>
              <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#111622] border border-[#1E2738] text-[11px] font-mono-tech text-[#00F5D4]">
                <Radio className="w-3.5 h-3.5" />
                <span>ZENOH</span>
              </div>
              <div className="flex items-center gap-2 pl-2 border-l border-[#1E2738]">
                <div className="text-right hidden md:block">
                  <div className="text-xs font-semibold text-slate-200 leading-tight">Aris Thorne</div>
                  <div className="text-[10px] font-mono-tech text-slate-500">LEAD OPERATOR</div>
                </div>
                <div className="w-8 h-8 rounded-full bg-[#FF9100]/20 border border-[#FF9100]/50 flex items-center justify-center text-[#FF9100]">
                  <User className="w-4 h-4" />
                </div>
              </div>
            </div>
          </header>

          {/* Active Screen */}
          <main className="relative flex-1 min-h-0 overflow-y-auto p-4 lg:p-5">
            {toast && (
              <div
                onClick={onDismissToast}
                className={`fixed top-16 right-5 z-50 max-w-sm rounded-xl border px-4 py-3 shadow-2xl backdrop-blur-md cursor-pointer transition-all ${
                  toast.tone === 'green'
                    ? 'bg-[#08261a]/95 border-[#00FFA3]/70 text-[#00FFA3]'
                    : toast.tone === 'red'
                      ? 'bg-[#2a0910]/95 border-[#FF1744]/80 text-[#FF1744]'
                      : toast.tone === 'amber'
                        ? 'bg-[#261b06]/95 border-[#FFE600]/70 text-[#FFE600]'
                        : 'bg-[#0B1622]/95 border-[#00F5D4]/70 text-[#00F5D4]'
                }`}
              >
                <div className="font-mono-tech text-xs font-bold">{toast.title}</div>
                {toast.detail && (
                  <div className="text-[11px] text-slate-200 mt-0.5">{toast.detail}</div>
                )}
              </div>
            )}
            {children}
          </main>

          {/* Clean Pinned Footer */}
          <footer className="h-11 shrink-0 bg-[#0D1119] border-t border-[#1E2738] px-5 flex items-center justify-between gap-4 font-mono-tech text-[11px]">
            <div className="flex items-center gap-4 min-w-0">
              <span className={`flex items-center gap-1.5 font-semibold shrink-0 ${isEmergency ? 'text-[#FF1744]' : 'text-[#00FFA3]'}`}>
                <span className={`w-2 h-2 rounded-full ${isEmergency ? 'bg-[#FF1744] animate-pulse' : 'bg-[#00FFA3]'}`} />
                {isEmergency ? 'SURVIVAL MODE ACTIVE' : 'SYSTEMS OPTIMAL'}
              </span>
              <span className="text-slate-400 truncate hidden md:inline">
                IAU_2015:49900 · 9.896°S 283.389°E · ELEV -1660m · 708 Pa
              </span>
            </div>

            <div className="flex items-center gap-4 shrink-0">
              <span className="text-slate-400 hidden sm:inline">
                CARRIER <span className={radioColor}>UHF 435 MHz ({currentEvent.values.radio_rssi_dbm.toFixed(0)} dBm)</span>
              </span>
              <span className="text-slate-400 hidden lg:inline">PROTOCOLO 07-ALPHA</span>
              <button
                type="button"
                onClick={() => onSelectView(isEmergency ? 'eva-hud-nominal' : 'eva-emergency')}
                className={`flex items-center gap-1.5 px-3 py-1 rounded font-bold text-[10px] tracking-wider transition cursor-pointer ${
                  isEmergency
                    ? 'bg-[#00FFA3] hover:bg-[#00FFA3]/90 text-[#0B0E14]'
                    : 'bg-[#FF1744] hover:bg-[#FF1744]/90 text-white'
                }`}
              >
                <ShieldAlert className="w-3.5 h-3.5" />
                <span>{isEmergency ? 'RESTAURAR NOMINAL' : 'SIMULAR ABORT / WP3'}</span>
              </button>
            </div>
          </footer>
        </div>
      </div>
    </div>
  );
};
