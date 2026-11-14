import React, { useState } from 'react';
import {
  Activity,
  AlertOctagon,
  AlertTriangle,
  Compass,
  Layers,
  Mic,
  Radio,
  RotateCw,
  ShieldCheck,
  Volume2,
} from 'lucide-react';
import { EVA07_EVENTS } from '@/data/missionData';
import type { MarsRawImage } from '@/engine/apiClient';
import { classifyEvaState } from '@/engine/p3Bridge';
import type { Eva07Event } from '@/types/mission';

interface EvaHudViewProps {
  forceEmergency?: boolean;
  currentEvent: Eva07Event;
  marsImage?: MarsRawImage | null;
  onSelectTimeMin: (tMin: number) => void;
  onNotify?: (title: string, detail?: string, tone?: 'cyan' | 'green' | 'amber' | 'red') => void;
}

export const EvaHudView: React.FC<EvaHudViewProps> = ({
  forceEmergency = false,
  currentEvent,
  marsImage = null,
  onSelectTimeMin,
  onNotify,
}) => {
  const [dialPos, setDialPos] = useState<1 | 2 | 3>(forceEmergency ? 3 : 2);
  const [activeCuffZone, setActiveCuffZone] = useState<number>(2);
  const [voicePlaying, setVoicePlaying] = useState(false);
  const [showArGrid, setShowArGrid] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [isruSamples, setIsruSamples] = useState(1);

  const alertLevel = forceEmergency ? 'CRITICAL_EMERGENCY' : classifyEvaState(currentEvent);
  const isEmergency = alertLevel === 'CRITICAL_EMERGENCY';
  const isCaution = alertLevel === 'CAUTION';

  const voiceLine =
    'Alerta combinada. Retorno a Base Alpha inviable por radiación solar. Siga chevrones rumbo dos-ocho-cinco hacia refugio basáltico. Ocho minutos a paso firme.';

  const handlePlayVoice = () => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(voiceLine);
      utter.lang = 'es-ES';
      utter.rate = 1.05;
      utter.onstart = () => setVoicePlaying(true);
      utter.onend = () => setVoicePlaying(false);
      window.speechSynthesis.speak(utter);
    }
  };

  const timelinePresets = [
    { label: 'T+28 WP1 ISRU', t: 28 },
    { label: 'T+92 Corte NLOS', t: 92 },
    { label: 'T+98 Rampa 22°', t: 98 },
    { label: 'T+105 Multiemergencia', t: 105 },
    { label: 'T+114 Refugio WP3', t: 114 },
  ];

  const o2Pct = currentEvent.values.o2_remaining_pct;
  const doseMsv = currentEvent.values.dose_spe_msv;
  const powerW = Math.round(currentEvent.values.metabolic_power_w);
  const o2Rate = currentEvent.values.o2_l_min;

  return (
    <div className="space-y-4">
      {/* Interactive EVA-07 Timeline Scrubber (P1 eva07_events.json) */}
      <div className="bg-[#111622] border border-[#1E2738] rounded-xl p-3.5 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="font-mono-tech text-[10px] text-[#00F5D4] font-bold uppercase tracking-wider">
            CRONOLOGÍA EVA-07 EN VIVO (DATOS P1 · {EVA07_EVENTS.length} HITOS)
          </div>
          <div className="text-xs font-semibold text-slate-100">
            T{currentEvent.t_min >= 0 ? `+${currentEvent.t_min}` : currentEvent.t_min} min ({currentEvent.lmst} LMST) — {currentEvent.title}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 bg-[#0B0E14] border border-[#1E2738] rounded-lg px-2.5 py-1">
            <span className="font-mono-tech text-[10px] text-slate-400">T-45..+165</span>
            <input
              type="range"
              min={-45}
              max={165}
              step={1}
              value={currentEvent.t_min}
              onChange={(e) => onSelectTimeMin(Number(e.target.value))}
              className="w-28 accent-[#00F5D4] cursor-pointer"
            />
          </div>
          {timelinePresets.map((p) => (
            <button
              key={p.t}
              type="button"
              onClick={() => onSelectTimeMin(p.t)}
              className={`px-2.5 py-1 rounded-md font-mono-tech text-[10px] font-semibold border transition cursor-pointer ${
                currentEvent.t_min === p.t
                  ? p.t === 105
                    ? 'bg-[#FF1744]/25 border-[#FF1744] text-[#FF1744]'
                    : 'bg-[#00F5D4]/20 border-[#00F5D4] text-[#00F5D4]'
                  : 'bg-[#0B0E14] border-[#1E2738] text-slate-400 hover:text-white'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Main Helmet Visor HUD Container */}
      <div
        className={`relative rounded-2xl border overflow-hidden transition-colors ${
          isEmergency
            ? 'border-[#FF1744]/70 bg-gradient-to-b from-[#1a0b10] via-[#1c100d] to-[#0B0E14]'
            : 'border-[#1E2738] bg-gradient-to-b from-[#1a1512] via-[#17120e] to-[#0B0E14]'
        }`}
      >
        {/* Top Visor Status Strip */}
        <div
          className={`px-4 py-2.5 border-b flex flex-wrap items-center justify-between gap-3 font-mono-tech text-[11px] ${
            isEmergency
              ? 'bg-[#FF1744]/20 border-[#FF1744]/40 text-white'
              : 'bg-[#0B0E14]/90 border-[#1E2738] text-slate-200'
          }`}
        >
          <div className="flex flex-wrap items-center gap-4">
            <span className={`font-bold flex items-center gap-1.5 ${isEmergency ? 'text-[#FF1744]' : 'text-[#00FFA3]'}`}>
              {isEmergency ? <AlertOctagon className="w-4 h-4" /> : <Compass className="w-4 h-4 text-[#00F5D4]" />}
              {isEmergency
                ? 'AUTÓNOMO EDGE (CANYON-TRN OFFLINE)'
                : 'CANYON-TRN: LOCKED (RMS 0.04m)'}
            </span>
            <span>AZM: {isEmergency ? '285° OESTE' : '034° NNE'}</span>
            <span>MET {currentEvent.lmst}</span>
            <span>SOL 142</span>
          </div>

          <div className="flex items-center gap-3">
            {showArGrid && (
              <g opacity="0.35">
                {[120, 240, 360, 480, 600, 720].map((x) => (
                  <line key={`vx-${x}`} x1={x} y1={90} x2={x} y2={320} stroke="#00F5D4" strokeWidth="0.7" strokeDasharray="4 4" />
                ))}
                {[150, 200, 250, 300].map((y) => (
                  <line key={`hy-${y}`} x1={0} y1={y} x2={900} y2={y} stroke="#00F5D4" strokeWidth="0.7" strokeDasharray="4 4" />
                ))}
              </g>
            )}
            {isEmergency ? (
              <>
                <span className="text-[#FFE600] font-bold">
                  SPE: {Math.max(8.0, currentEvent.values.spe_ext_rate_cal_msv_h).toFixed(1)} mSv/h · VENTANA: 15 MIN
                </span>
                <span className="px-2 py-0.5 rounded bg-[#FF1744] text-white font-bold text-[10px]">
                  PROTOCOLO 07-ALPHA ACTIVO
                </span>
              </>
            ) : (
              <span className={`flex items-center gap-1.5 font-bold ${isCaution ? 'text-[#FFE600]' : 'text-[#00FFA3]'}`}>
                <Radio className="w-3.5 h-3.5" />
                ZENOH {currentEvent.values.radio_class} ({currentEvent.values.radio_rssi_dbm.toFixed(0)} dBm)
              </span>
            )}
          </div>
        </div>

        {/* Barra Superior "Walkback Limit Dual" (zero overlapping badges!) */}
        <div className="px-4 py-3 bg-[#0B0E14]/85 border-b border-[#1E2738]">
          {isEmergency ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="flex items-center justify-between bg-[#1a0d12] border border-[#FF1744]/50 rounded-xl px-4 py-2.5">
                <div>
                  <div className="font-mono-tech text-xs font-bold text-[#FF1744] line-through">
                    RETORNO BASE ALPHA: INVIABLE
                  </div>
                  <div className="font-mono-tech text-[10px] text-slate-400">
                    48 MIN · DOSIS PROYECTADA 6.4 mSv (&gt;2.0 mSv LÍMITE)
                  </div>
                </div>
                <span className="px-2 py-0.5 rounded bg-[#FF1744]/20 text-[#FF1744] font-mono-tech text-[10px] font-bold">
                  VETO RAD
                </span>
              </div>

              <div className="flex items-center justify-between bg-[#08261a] border border-[#00FFA3]/60 rounded-xl px-4 py-2.5">
                <div>
                  <div className="font-mono-tech text-xs font-bold text-[#00FFA3]">
                    RUTA ACTIVA: REFUGIO WP3 BASALTO
                  </div>
                  <div className="font-mono-tech text-[10px] text-slate-200">
                    VECTOR 344° / 285° · 600 m · TECHO &gt;5m (SVF 0.15)
                  </div>
                </div>
                <div className="text-right font-mono-tech">
                  <div className="text-lg font-extrabold text-[#00FFA3]">8 MIN</div>
                  <div className="text-[9.5px] text-slate-300">MARGEN SEGURO</div>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2 font-mono-tech text-xs">
                <div className="flex items-center gap-3">
                  <span className="text-slate-400">CONSUMIBLES O₂ / PLSS:</span>
                  <span className="text-lg font-extrabold text-[#00FFA3]">{o2Pct.toFixed(1)}%</span>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-[#00FFA3]/15 text-[#00FFA3]">
                    DOSIS SPE: {doseMsv.toFixed(2)} / 2.00 mSv
                  </span>
                </div>
                <div className="flex items-center gap-4 text-[11px]">
                  <span className="text-[#FF9100] font-semibold">PNR RETORNO BASE: 48 MIN</span>
                  <span className="text-[#00F5D4] font-semibold">ESCAPE WP3: 8 MIN (600m)</span>
                </div>
              </div>
              <div className="relative h-3 rounded-full bg-slate-800 overflow-hidden">
                <div
                  style={{ width: `${Math.min(100, o2Pct)}%` }}
                  className="h-full bg-gradient-to-r from-[#00FFA3] to-[#00F5D4] transition-all"
                />
                {/* Marca 1: PNR Base */}
                <div className="absolute top-0 bottom-0 left-[58%] w-0.5 bg-[#FF9100]" />
                {/* Marca 2: Escape WP3 */}
                <div className="absolute top-0 bottom-0 left-[82%] w-0.5 bg-[#00F5D4]" />
              </div>
              <div className="flex justify-between font-mono-tech text-[10px] text-slate-400">
                <span>0% (Agotamiento)</span>
                <span className="text-[#FF9100]">▲ Marca 1: Límite Retorno Base</span>
                <span className="text-[#00F5D4]">▲ Marca 2: Margen Escape WP3 (+1.8h)</span>
              </div>
            </div>
          )}
        </div>

        {/* Center AR Visor Viewport */}
        <div className="relative min-h-[430px] flex flex-col items-center justify-between gap-4 p-5 overflow-hidden">
          {/* Real NASA Mars 2020 Raw Image Backdrop */}
          {marsImage && (
            <>
              <img
                src={marsImage.proxyUrl}
                alt={marsImage.imageid}
                className={`absolute inset-0 w-full h-full object-cover pointer-events-none transition-all ${
                  isEmergency ? 'opacity-45 blur-[2px] sepia hue-rotate-[-20deg] brightness-75' : 'opacity-65 brightness-90'
                }`}
              />
              <div
                className={`absolute inset-0 pointer-events-none ${
                  isEmergency
                    ? 'bg-gradient-to-b from-[#2b090d]/70 via-[#3b150c]/45 to-[#0B0E14]/90'
                    : 'bg-gradient-to-b from-[#0B0E14]/55 via-transparent to-[#0B0E14]/85'
                }`}
              />
              <div className="pointer-events-none absolute top-2 right-3 z-10 font-mono-tech text-[9.5px] px-2 py-0.5 rounded bg-[#0B0E14]/75 border border-[#1E2738] text-slate-300">
                NASA MARS 2020 · SOL {marsImage.sol} · {marsImage.instrument}
              </div>
            </>
          )}
          {/* Conformal AR Path Overlay (transparent over real NASA Mars 2020 image) */}
          <svg
            viewBox="0 0 900 320"
            preserveAspectRatio="none"
            className="absolute inset-0 w-full h-full pointer-events-none"
          >
            {!marsImage && (
              <>
                <path
                  d="M0,140 L120,90 L240,125 L390,75 L520,115 L690,65 L820,105 L900,85 L900,320 L0,320 Z"
                  fill={isEmergency ? '#2a120d' : '#261d17'}
                  opacity="0.7"
                />
                <path
                  d="M0,190 L220,175 L450,185 L700,170 L900,185 L900,320 L0,320 Z"
                  fill={isEmergency ? '#1c0b08' : '#19130f'}
                />
              </>
            )}

            {showArGrid && (
              <g opacity="0.35">
                {[120, 240, 360, 480, 600, 720].map((x) => (
                  <line key={`vx-${x}`} x1={x} y1={90} x2={x} y2={320} stroke="#00F5D4" strokeWidth="0.7" strokeDasharray="4 4" />
                ))}
                {[150, 200, 250, 300].map((y) => (
                  <line key={`hy-${y}`} x1={0} y1={y} x2={900} y2={y} stroke="#00F5D4" strokeWidth="0.7" strokeDasharray="4 4" />
                ))}
              </g>
            )}
            {isEmergency ? (
              /* Emergency AR Dynamic Amber/Red Chevrons guiding to WP3 */
              <g>
                <polyline points="410,290 450,260 490,290" fill="none" stroke="#FF1744" strokeWidth="5" strokeLinecap="round" />
                <polyline points="418,255 450,228 482,255" fill="none" stroke="#FF9100" strokeWidth="4.5" strokeLinecap="round" />
                <polyline points="426,222 450,198 474,222" fill="none" stroke="#FFE600" strokeWidth="4" strokeLinecap="round" />
              </g>
            ) : (
              /* Nominal Conformal AR Path in Electric Cyan (#00F5D4) */
              <g>
                <line
                  x1="450"
                  y1="315"
                  x2="450"
                  y2="125"
                  stroke={isCaution ? '#FFE600' : '#00F5D4'}
                  strokeWidth="4"
                  strokeDasharray="12 8"
                />
                <circle cx="450" cy="125" r="7" fill={isCaution ? '#FFE600' : '#00F5D4'} />
              </g>
            )}
          </svg>

          {/* Center Waypoint / Single-Alert Fusion Overlay */}
          {isEmergency ? (
            <div className="relative z-10 mt-4 mb-10 max-w-xl w-full bg-[#0B0E14]/92 border-2 border-[#FF1744] rounded-2xl px-5 py-4 text-center shadow-[0_0_40px_rgba(255,23,68,0.35)] space-y-2">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#FF1744]/20 text-[#FF1744] font-mono-tech text-xs font-bold">
                <AlertTriangle className="w-4 h-4" />
                TRIAJE DE ALERTA ÚNICA · ANTI-PÁNICO
              </div>
              <h2 className="font-mono-tech text-lg sm:text-xl font-extrabold text-white">
                ALERTA FUSIONADA: EVACUAR A REFUGIO WP3
              </h2>
              <p className="font-mono-tech text-xs text-[#FFE600]">
                SPE CRÍTICO (8.0 mSv/h) + VIENTO POLVO τ={currentEvent.values.dust_tau.toFixed(1)} + CORTE NLOS + TALUD 22°
              </p>
              <div className="flex flex-wrap items-center justify-center gap-3 pt-1 font-mono-tech text-xs">
                <span className="px-3 py-1 rounded-lg bg-[#00FFA3]/15 border border-[#00FFA3]/50 text-[#00FFA3] font-bold">
                  BLINDAJE BASALTO 85% (SVF 0.15)
                </span>
                <span className="px-3 py-1 rounded-lg bg-[#111622] border border-[#1E2738] text-white font-bold">
                  RUMBO 285° · 600 m · 8 MIN
                </span>
              </div>
            </div>
          ) : (
            <div className="relative z-10 mt-6 px-3.5 py-1.5 rounded-xl bg-[#0B0E14]/85 border border-[#00F5D4]/60 font-mono-tech text-xs text-[#00F5D4] font-bold">
              WP1 // SULFATOS ISRU · 420 m · AZM 034° · CRISM ≥12% H₂O
            </div>
          )}

          {/* Bottom Visor Corners */}
          <div className="relative z-10 w-full flex flex-wrap items-end justify-between gap-3">
            {showArGrid && (
              <g opacity="0.35">
                {[120, 240, 360, 480, 600, 720].map((x) => (
                  <line key={`vx-${x}`} x1={x} y1={90} x2={x} y2={320} stroke="#00F5D4" strokeWidth="0.7" strokeDasharray="4 4" />
                ))}
                {[150, 200, 250, 300].map((y) => (
                  <line key={`hy-${y}`} x1={0} y1={y} x2={900} y2={y} stroke="#00F5D4" strokeWidth="0.7" strokeDasharray="4 4" />
                ))}
              </g>
            )}
            {isEmergency ? (
              <>
                <div className="bg-[#0B0E14]/90 border border-[#FF9100]/50 rounded-xl px-4 py-2.5 font-mono-tech">
                  <div className="text-[10px] text-[#FF9100] font-bold">ACCIÓN INMEDIATA</div>
                  <div className="text-sm font-extrabold text-white">CAMINAR 8 MIN AL REFUGIO WP3</div>
                </div>

                <div className="bg-[#0B0E14]/90 border border-[#00F5D4]/50 rounded-xl px-4 py-2.5 max-w-md space-y-1">
                  <div className="flex items-center justify-between gap-3 font-mono-tech text-[10px]">
                    <span className="flex items-center gap-1.5 text-[#00F5D4] font-bold">
                      <Mic className="w-3.5 h-3.5" />
                      COPILOTO IA (CANDLE + WHISPER-RS · 8s)
                    </span>
                    <button
                      type="button"
                      onClick={handlePlayVoice}
                      className="flex items-center gap-1 px-2 py-0.5 rounded bg-[#00F5D4]/20 text-[#00F5D4] hover:bg-[#00F5D4]/30 cursor-pointer"
                    >
                      <Volume2 className="w-3 h-3" />
                      <span>{voicePlaying ? 'Reproduciendo...' : 'Oír Voz'}</span>
                    </button>
                  </div>
                  <p className="text-[11px] italic text-slate-200 leading-snug">“{voiceLine}”</p>
                </div>

                <div className="bg-[#0B0E14]/90 border border-[#FF9100]/50 rounded-xl px-4 py-2.5 font-mono-tech text-right">
                  <div className="text-[10px] text-[#00FFA3] font-bold">CADENCIA DE ESCAPE</div>
                  <div className="text-sm font-extrabold text-white">88 PASOS/MIN · 285° OESTE</div>
                </div>
              </>
            ) : (
              <>
                <div className="bg-[#0B0E14]/85 border border-[#1E2738] rounded-xl px-4 py-2.5 font-mono-tech text-xs space-y-1">
                  <div className="text-[10px] text-[#00FFA3] font-bold flex items-center gap-1.5">
                    <Activity className="w-3.5 h-3.5" />
                    FISIOLOGÍA (PANDOLF-MARS)
                  </div>
                  <div className="flex items-center gap-4">
                    <span>POT: <strong className="text-white">{powerW} W</strong></span>
                    <span>O₂: <strong className="text-[#00F5D4]">{o2Rate.toFixed(2)} L/min</strong></span>
                    <span>TRAJE: <strong className="text-[#00FFA3]">29.6 kPa</strong></span>
                  </div>
                </div>

                <div className="bg-[#0B0E14]/85 border border-[#1E2738] rounded-xl px-4 py-2.5 font-mono-tech text-xs space-y-1 text-right">
                  <div className="text-[10px] text-slate-400 font-bold">TERRENO &amp; CADENCIA</div>
                  <div className="flex items-center gap-4">
                    <span>PASO: <strong className="text-white">74 SPM</strong></span>
                    <span>INCL: <strong className="text-[#00FFA3]">6.2°</strong></span>
                    <span>TIU: <strong className="text-[#00F5D4]">410 (η 1.0)</strong></span>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Wrist Cuff Display Unit (7-inch Ruggedized Panel with Oversized Buttons for Pressurized Gloves) */}
      <div className="bg-[#111622] border border-[#1E2738] rounded-2xl p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="font-mono-tech text-sm font-extrabold text-white">
                xEMU-04 CUFF INTERFACE
              </span>
              <span className="px-2 py-0.5 rounded bg-[#1E2738] font-mono-tech text-[10px] text-slate-300">
                7-INCH RUGGED MIL-SPEC PANEL
              </span>
            </div>
            <div className="text-xs text-slate-400 mt-0.5">
              Dra. Elena Rostova · Melas Chasma EVA-07 · Botones sobredimensionados (&gt;30 mm) para guantes RMG
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              const next = (dialPos === 3 ? 1 : dialPos + 1) as 1 | 2 | 3;
              setDialPos(next);
              if (next === 1) {
                setShowArGrid((g) => !g);
                onNotify?.('Dial Posición 1: HUD MODE', 'Malla AR h3o / pendientes alternada', 'cyan');
              } else if (next === 2) {
                onNotify?.('Dial Posición 2: WAYPOINT LOCK', 'Anclaje Canyon-TRN hacia WP1/WP2', 'cyan');
              } else {
                onNotify?.('Dial Posición 3: SOS EGRESS WP3', 'Activando evacuación autónoma a Refugio WP3', 'red');
                onSelectTimeMin(105);
              }
            }}
            className="flex items-center gap-2.5 bg-[#0B0E14] border border-[#1E2738] hover:border-[#00F5D4] rounded-xl px-3.5 py-2 cursor-pointer active:scale-[0.98]"
          >
            <RotateCw className="w-4 h-4 text-[#00F5D4]" />
            <div className="text-left font-mono-tech">
              <div className="text-[10px] text-slate-400">DIAL ROTATORIO MECÁNICO (14 N·cm)</div>
              <div className="text-xs font-bold text-white">
                POSICIÓN {dialPos} DE 3 ·{' '}
                {dialPos === 1 ? 'HUD MODE' : dialPos === 2 ? 'WAYPOINT LOCK' : 'SOS EGRESS WP3'}
              </div>
            </div>
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            {
              id: 1,
              title: 'ZONA [01] CAPAS HUD',
              sub: 'Malla h3o & Gradiente Pendiente',
              icon: Layers,
              danger: false,
            },
            {
              id: 2,
              title: `ZONA [02] REGISTRAR ISRU (${isruSamples})`,
              sub: 'Espectro CRISM ≥12% H₂O',
              icon: ShieldCheck,
              danger: false,
            },
            {
              id: 3,
              title: 'ZONA [03] DIAGNÓSTICO',
              sub: 'PLSS O₂ / LCVG SWME / Zenoh',
              icon: Activity,
              danger: false,
            },
            {
              id: 4,
              title: 'ZONA [04] EGRESO / ABORT',
              sub: 'Dynamic Goal Switch -> WP3 (8m)',
              icon: AlertTriangle,
              danger: true,
            },
          ].map((btn) => {
            const Icon = btn.icon;
            const selected = activeCuffZone === btn.id;
            return (
              <button
                key={btn.id}
                type="button"
                onClick={() => {
                  setActiveCuffZone(btn.id);
                  if (btn.id === 1) {
                    setShowArGrid((g) => !g);
                    onNotify?.('Capas HUD alternadas', showArGrid ? 'Malla AR oculta' : 'Malla AR h3o visible', 'cyan');
                  } else if (btn.id === 2) {
                    const nextN = isruSamples + 1;
                    setIsruSamples(nextN);
                    onNotify?.(`Muestra ISRU #${nextN} registrada`, 'Kieserita ≥12% H₂O · Guardada en log local', 'green');
                  } else if (btn.id === 3) {
                    setShowDiagnostics((d) => !d);
                    onNotify?.('Diagnóstico xEMU-04', 'PLSS 29.6 kPa · SWME 4.5kg · Canyon-TRN 0.04m', 'cyan');
                  } else if (btn.id === 4) {
                    onNotify?.('Protocolo Egreso WP3 activado', 'Dynamic Goal Switching -> Refugio Basalto (8 min)', 'red');
                    onSelectTimeMin(105);
                  }
                }}
                className={`p-3.5 rounded-xl border text-left transition cursor-pointer active:scale-[0.98] flex flex-col justify-between min-h-[92px] ${
                  btn.danger
                    ? 'bg-[#FF1744]/20 border-[#FF1744]/70 hover:bg-[#FF1744]/30'
                    : selected
                      ? 'bg-[#00F5D4]/10 border-[#00F5D4]/60'
                      : 'bg-[#0B0E14] border-[#1E2738] hover:border-slate-500'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className={`font-mono-tech text-xs font-bold ${btn.danger ? 'text-[#FF1744]' : 'text-white'}`}>
                    {btn.title}
                  </span>
                  <Icon className={`w-4 h-4 ${btn.danger ? 'text-[#FF1744]' : 'text-[#00F5D4]'}`} />
                </div>
                <div className="text-[11px] text-slate-300 mt-2 leading-snug">{btn.sub}</div>
              </button>
            );
          })}
        </div>

        {showDiagnostics && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 pt-2 border-t border-[#1E2738] font-mono-tech text-[11px]">
            <div className="bg-[#0B0E14] border border-[#1E2738] rounded-lg px-3 py-2">
              <div className="text-[9.5px] text-slate-400">O₂ PRIMARIO</div>
              <div className="text-[#00FFA3] font-bold">{o2Pct.toFixed(1)}% · {currentEvent.values.o2_remaining_g.toFixed(0)} g</div>
            </div>
            <div className="bg-[#0B0E14] border border-[#1E2738] rounded-lg px-3 py-2">
              <div className="text-[9.5px] text-slate-400">REFRIGERACIÓN SWME</div>
              <div className="text-[#00F5D4] font-bold">76% · 4.5 kg LCVG</div>
            </div>
            <div className="bg-[#0B0E14] border border-[#1E2738] rounded-lg px-3 py-2">
              <div className="text-[9.5px] text-slate-400">DOSIS SPE ACUM.</div>
              <div className={doseMsv > 2 ? 'text-[#FF1744] font-bold' : 'text-[#00FFA3] font-bold'}>
                {doseMsv.toFixed(2)} / 2.00 mSv
              </div>
            </div>
            <div className="bg-[#0B0E14] border border-[#1E2738] rounded-lg px-3 py-2">
              <div className="text-[9.5px] text-slate-400">MUESTRAS ISRU</div>
              <div className="text-[#00F5D4] font-bold">{isruSamples} registradas (WP1)</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
