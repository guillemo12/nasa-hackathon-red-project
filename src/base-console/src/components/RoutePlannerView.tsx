import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Download,
  Play,
  Radio,
  Route as RouteIcon,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { CANONICAL_WAYPOINTS, TRIANGULO_GEOJSON } from '@/data/missionData';
import { fetchChaosMode } from '@/engine/apiClient';
import { runChaosModeMonteCarlo } from '@/engine/p3Bridge';
import type { ChaosRunResult } from '@/types/mission';

interface RoutePlannerViewProps {
  onApproveOfflinePlan: () => void | Promise<void>;
  zenohSynced: boolean;
  onNotify?: (title: string, detail?: string, tone?: 'cyan' | 'green' | 'amber' | 'red') => void;
}

export const RoutePlannerView: React.FC<RoutePlannerViewProps> = ({
  onApproveOfflinePlan,
  zenohSynced,
  onNotify,
}) => {
  const [chaosActive, setChaosActive] = useState(true);
  const [seed, setSeed] = useState(20261114);
  const [chaosResult, setChaosResult] = useState<ChaosRunResult>(() =>
    runChaosModeMonteCarlo(20261114, 100)
  );
  const [chaosFromApi, setChaosFromApi] = useState(false);
  const [isRunningChaos, setIsRunningChaos] = useState(false);
  const [selectedWpId, setSelectedWpId] = useState<'BASE' | 'WP1' | 'WP2' | 'WP3'>('WP2');

  useEffect(() => {
    let active = true;
    setIsRunningChaos(true);
    fetchChaosMode(seed, 100).then(({ result, fromApi }) => {
      if (active) {
        setChaosResult(result);
        setChaosFromApi(fromApi);
        setIsRunningChaos(false);
      }
    });
    return () => {
      active = false;
    };
  }, [seed]);

  const handleDownloadGeoJson = () => {
    const blob = new Blob([JSON.stringify(TRIANGULO_GEOJSON, null, 2)], {
      type: 'application/geo+json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'triangulo_supervivencia_melas_eva07.geojson';
    a.click();
    URL.revokeObjectURL(url);
    onApproveOfflinePlan();
  };

  return (
    <div className="space-y-4">
      {/* Header & Mode Toggle */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 font-mono-tech text-[11px] text-[#00FFA3]">
            <span className="w-2 h-2 rounded-full bg-[#00FFA3]" />
            SIMULADOR METABÓLICO D* LITE · MELAS SW BASIN · SOL 142
          </div>
          <h1 className="text-xl font-bold text-white tracking-tight">
            Planificación de Incursión &amp; Resiliencia
          </h1>
        </div>

        <div className="flex items-center gap-1 bg-[#111622] p-1 rounded-lg border border-[#1E2738] font-mono-tech text-xs">
          <button
            type="button"
            onClick={() => setChaosActive(false)}
            className={`px-3 py-1.5 rounded-md transition ${
              !chaosActive ? 'bg-[#1D2638] text-[#00F5D4]' : 'text-slate-400 hover:text-white'
            }`}
          >
            Ruta Nominal
          </button>
          <button
            type="button"
            onClick={() => setChaosActive(true)}
            className={`px-3 py-1.5 rounded-md flex items-center gap-1.5 transition ${
              chaosActive ? 'bg-[#FF9100]/20 text-[#FF9100] border border-[#FF9100]/40' : 'text-slate-400 hover:text-white'
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-[#FF9100]" />
            Chaos Mode (100 Sim)
          </button>
        </div>
      </div>

      {/* Top 4 KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3.5">
        <div className="bg-[#111622] border border-[#1E2738] rounded-xl p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between font-mono-tech text-[11px] text-slate-400">
            <span>PERÍMETRO TOTAL</span>
            <RouteIcon className="w-4 h-4 text-slate-500" />
          </div>
          <div className="font-mono-tech text-3xl font-extrabold text-white my-2">
            4.90 <span className="text-sm font-normal text-slate-400">KM</span>
          </div>
          <div className="font-mono-tech text-[11px] text-[#00FFA3]">
            ● Desnivel máximo +196 m (Base→WP2)
          </div>
        </div>

        <div className="bg-[#111622] border border-[#1E2738] rounded-xl p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between font-mono-tech text-[11px] text-slate-400">
            <span>DURACIÓN EVA-07</span>
            <Clock className="w-4 h-4 text-slate-500" />
          </div>
          <div className="font-mono-tech text-3xl font-extrabold text-white my-2">
            165 <span className="text-sm font-normal text-slate-400">MIN</span>
          </div>
          <div className="font-mono-tech text-[11px] text-slate-400">
            Salida 14:45 LMST · O₂ fin 71.8%
          </div>
        </div>

        <div className="bg-[#111622] border border-[#1E2738] rounded-xl p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between font-mono-tech text-[11px] text-slate-400">
            <span>LÍMITE RETORNO BASE</span>
            <AlertTriangle className="w-4 h-4 text-[#FF9100]" />
          </div>
          <div className="font-mono-tech text-3xl font-extrabold text-[#FF9100] my-2">
            48 <span className="text-sm font-normal text-[#FF9100]/80">MIN</span>
          </div>
          <div className="font-mono-tech text-[11px] text-slate-400">
            Regla SPE: máx 2.0 mSv (15 min cielo abierto)
          </div>
        </div>

        {/* Corredor de Marcha: all 4 canonical waypoints */}
        <div className="bg-[#111622] border border-[#1E2738] rounded-xl p-3.5 space-y-2">
          <div className="flex items-center justify-between font-mono-tech text-[10px]">
            <span className="text-slate-400">CORREDOR DE MARCHA</span>
            <span className="text-[#00FFA3] font-semibold">4 HITOS FIJOS</span>
          </div>
          <div className="space-y-1.5 text-[11px]">
            {CANONICAL_WAYPOINTS.map((wp, idx) => {
              const tag =
                wp.id === 'BASE'
                  ? { txt: 'INICIO', cls: 'bg-[#00FFA3]/15 text-[#00FFA3]' }
                  : wp.id === 'WP1'
                    ? { txt: 'ISRU ≥12%', cls: 'bg-[#00F5D4]/15 text-[#00F5D4]' }
                    : wp.id === 'WP2'
                      ? { txt: 'RAMPA 22°', cls: 'bg-[#FF9100]/20 text-[#FF9100]' }
                      : { txt: 'REFUGIO 8m', cls: 'bg-[#00FFA3]/20 text-[#00FFA3]' };
              return (
                <button
                  key={wp.id}
                  type="button"
                  onClick={() => {
                    setSelectedWpId(wp.id);
                    onNotify?.(`Hito ${wp.shortLabel}`, `${wp.geology} · SVF ${wp.svfScenario} · TIU ${wp.tiu}`, 'cyan');
                  }}
                  className={`w-full text-left flex items-center justify-between gap-2 rounded-lg px-2 py-1 border transition cursor-pointer ${
                    selectedWpId === wp.id
                      ? 'bg-[#1D2638] border-[#00F5D4]/60'
                      : 'bg-[#0B0E14]/80 border-[#1E2738] hover:border-slate-500'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-200 truncate">
                      {idx + 1}. {wp.shortLabel}
                    </div>
                    <div className="font-mono-tech text-[9.5px] text-slate-500">
                      {(wp.distFromBaseM / 1000).toFixed(2)} km · {wp.elevMolaM} m
                    </div>
                  </div>
                  <span className={`px-1.5 py-0.5 rounded font-mono-tech text-[9.5px] font-bold shrink-0 ${tag.cls}`}>
                    {tag.txt}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Elevation Profile + Zenoh NLOS Coverage + Vital Consumables */}
      <div className="bg-[#111622] border border-[#1E2738] rounded-xl p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="font-mono-tech text-xs font-bold text-slate-200">
              TOPOGRAFÍA &amp; DEMANDA METABÓLICA · MELAS CHASMA SW BASIN
            </div>
            <div className="text-[11px] text-slate-400">
              Perfil CTX 20m (-1,660m a -1,464m) sincronizado con modelo Pandolf-Mars (170 kg)
            </div>
          </div>
          <div className="flex items-center gap-4 font-mono-tech text-[10px]">
            <span className="text-[#00F5D4]">● WP1 ISRU (447 W)</span>
            <span className="text-[#FF9100]">● WP2 Pico 22° (1,073 W / 3.2 L/m)</span>
            <span className="text-[#00FFA3]">● WP3 Alcoba (SVF 0.15)</span>
          </div>
        </div>

        {/* SVG Elevation & Metabolic Curve */}
        <div className="w-full h-48 bg-[#0B0E14] border border-[#1E2738] rounded-lg p-2">
          <svg viewBox="0 0 800 170" className="w-full h-full">
            <defs>
              <linearGradient id="elevFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#00F5D4" stopOpacity="0.25" />
                <stop offset="100%" stopColor="#0B0E14" stopOpacity="0.0" />
              </linearGradient>
            </defs>
            {/* Grid lines */}
            <line x1="50" y1="30" x2="770" y2="30" stroke="#1E2738" strokeDasharray="3 3" />
            <line x1="50" y1="80" x2="770" y2="80" stroke="#1E2738" strokeDasharray="3 3" />
            <line x1="50" y1="130" x2="770" y2="130" stroke="#1E2738" strokeDasharray="3 3" />

            <text x="8" y="34" fill="#64748b" fontSize="10" fontFamily="JetBrains Mono">-1460m</text>
            <text x="8" y="84" fill="#64748b" fontSize="10" fontFamily="JetBrains Mono">-1560m</text>
            <text x="8" y="134" fill="#64748b" fontSize="10" fontFamily="JetBrains Mono">-1660m</text>

            {/* Area & Path: Base(60,130) -> WP1(270,91) -> WP2(455,32) -> WP3(545,60) -> Base(755,130) */}
            <path
              d="M60,130 L270,91 L455,32 L545,60 L755,130 L755,150 L60,150 Z"
              fill="url(#elevFill)"
            />
            <polyline
              points="60,130 270,91 455,32 545,60 755,130"
              fill="none"
              stroke="#00F5D4"
              strokeWidth="2.5"
            />
            {/* Escape vector WP2 -> WP3 highlighted in Bio-Green */}
            <line x1="455" y1="32" x2="545" y2="60" stroke="#00FFA3" strokeWidth="3.5" />

            {/* Waypoint Dots & Labels */}
            {[
              { id: 'BASE', cx: 60, cy: 130, fill: '#e2e8f0' },
              { id: 'WP1', cx: 270, cy: 91, fill: '#00F5D4' },
              { id: 'WP2', cx: 455, cy: 32, fill: '#FF9100' },
              { id: 'WP3', cx: 545, cy: 60, fill: '#00FFA3' },
            ].map((pt) => (
              <g key={pt.id}>
                {selectedWpId === pt.id && (
                  <circle cx={pt.cx} cy={pt.cy} r="10" fill="none" stroke={pt.fill} strokeWidth="2" strokeOpacity="0.65" />
                )}
                <circle cx={pt.cx} cy={pt.cy} r={selectedWpId === pt.id ? 6.5 : 5} fill={pt.fill} />
              </g>
            ))}
            <text x="60" y="158" textAnchor="middle" fill="#cbd5e1" fontSize="9.5" fontFamily="JetBrains Mono">
              Base Alpha (0.0km)
            </text>
            <text x="270" y="78" textAnchor="middle" fill="#00F5D4" fontSize="9.5" fontFamily="JetBrains Mono">
              WP1 Sulfatos (1.5km)
            </text>
            <text x="455" y="18" textAnchor="middle" fill="#FF9100" fontSize="9.5" fontFamily="JetBrains Mono" fontWeight="700">
              WP2 Talud 22° · 1,073 W
            </text>
            <text x="620" y="48" textAnchor="middle" fill="#00FFA3" fontSize="9.5" fontFamily="JetBrains Mono" fontWeight="700">
              WP3 Refugio (SVF 0.15)
            </text>

            <circle cx="755" cy="130" r="4.5" fill="#94a3b8" />
            <text x="745" y="158" textAnchor="end" fill="#94a3b8" fontSize="9.5" fontFamily="JetBrains Mono">
              Retorno L4 (4.9km)
            </text>
          </svg>
        </div>

        {/* Selected Waypoint Telemetry Detail Strip */}
        {(() => {
          const wp = CANONICAL_WAYPOINTS.find((w) => w.id === selectedWpId);
          if (!wp) return null;
          return (
            <div className="flex flex-wrap items-center justify-between gap-2 bg-[#0B0E14] border border-[#1E2738] rounded-lg px-3 py-2 font-mono-tech text-[11px]">
              <span className="text-[#00F5D4] font-bold">
                HITO ACTIVO: {wp.shortLabel} ({wp.lat.toFixed(4)}°, {wp.lonE.toFixed(4)}°E)
              </span>
              <span className="text-slate-300">
                Elev: {wp.elevMolaM}m · Pendiente: {wp.rampSlopeDeg ?? wp.slopeLocalDeg}° · TIU: {wp.tiu} · SVF: {wp.svfScenario}
              </span>
              <span className="text-slate-400">{wp.geology}</span>
            </div>
          );
        })()}

        {/* Clean Non-Clipped Eclipse Zenoh NLOS Coverage Bar */}
        <div className="bg-[#0B0E14] border border-[#1E2738] rounded-lg p-3 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2 font-mono-tech text-[11px]">
            <span className="flex items-center gap-1.5 text-slate-200 font-bold">
              <Radio className="w-3.5 h-3.5 text-[#00F5D4]" />
              COBERTURA DE ENLACE ECLIPSE ZENOH / SOMBRA NLOS (PARED SW)
            </span>
            <span className="text-slate-400">Corte NLOS T+92m · Recuperación T+158m</span>
          </div>
          <div className="grid grid-cols-12 h-6 rounded-md overflow-hidden font-mono-tech text-[10px] font-bold">
            <div className="col-span-5 bg-[#00FFA3] text-[#0B0E14] flex items-center justify-center px-2 truncate">
              100% LOS (-63 dBm)
            </div>
            <div className="col-span-3 bg-[#FFE600] text-[#0B0E14] flex items-center justify-center px-2 truncate">
              DIFRACCIÓN (-95 dBm)
            </div>
            <div className="col-span-4 bg-[#FF1744] text-white flex items-center justify-center px-2 truncate">
              0% CORTE NLOS (CANYON-TRN OFFLINE)
            </div>
          </div>
        </div>

        {/* Consumables Strip */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 font-mono-tech text-xs">
          <div className="bg-[#0B0E14] border border-[#1E2738] rounded-lg p-2.5">
            <div className="flex justify-between text-[11px] mb-1">
              <span className="text-slate-400">Oxígeno Primario (O₂)</span>
              <span className="text-[#00FFA3] font-bold">71.8% fin EVA (800g)</span>
            </div>
            <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
              <div className="w-[72%] h-full bg-[#00FFA3]" />
            </div>
          </div>
          <div className="bg-[#0B0E14] border border-[#1E2738] rounded-lg p-2.5">
            <div className="flex justify-between text-[11px] mb-1">
              <span className="text-slate-400">Refrigeración LCVG (SWME)</span>
              <span className="text-[#00F5D4] font-bold">76% / 4.5 kg</span>
            </div>
            <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
              <div className="w-[76%] h-full bg-[#00F5D4]" />
            </div>
          </div>
          <div className="bg-[#0B0E14] border border-[#1E2738] rounded-lg p-2.5">
            <div className="flex justify-between text-[11px] mb-1">
              <span className="text-slate-400">Batería Traje Li-Ion</span>
              <span className="text-[#00FFA3] font-bold">91% / 1,000 Wh</span>
            </div>
            <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
              <div className="w-[91%] h-full bg-[#00FFA3]" />
            </div>
          </div>
        </div>
      </div>

      {/* Binary Contingency Evaluation (Chaos Mode Monte Carlo 100x) or Nominal Summary */}
      {!chaosActive ? (
        <div className="bg-[#111622] border border-[#00F5D4]/30 rounded-xl p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className="px-2 py-0.5 rounded bg-[#00F5D4]/15 text-[#00F5D4] font-mono-tech text-[10px] font-bold">
                PERFIL NOMINAL EVA-07 · SIN TORMENTA SPE
              </span>
              <h2 className="text-lg font-bold text-white mt-1">
                Corredor Nominal Aprobado (Base → WP1 → WP2 → WP3 → Base)
              </h2>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setChaosActive(true)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#FF9100]/15 border border-[#FF9100]/50 hover:bg-[#FF9100]/25 text-xs font-mono-tech text-[#FF9100] cursor-pointer"
              >
                <Play className="w-3.5 h-3.5" />
                <span>Activar Chaos Mode (100 Sim)</span>
              </button>
              <button
                type="button"
                onClick={handleDownloadGeoJson}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#00F5D4] hover:bg-[#00F5D4]/90 text-[#0B0E14] text-xs font-mono-tech font-bold cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>{zenohSynced ? 'EXPORTAR GEOJSON + SYNC OK' : 'APROBAR Y EXPORTAR GEOJSON'}</span>
              </button>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 font-mono-tech text-xs">
            <div className="bg-[#0B0E14] border border-[#1E2738] rounded-lg p-3">
              <div className="text-[10px] text-slate-400">RADIACIÓN FONDO NOMINAL</div>
              <div className="text-xl font-extrabold text-[#00FFA3] mt-1">0.18 mSv</div>
              <div className="text-[10px] text-slate-400 mt-0.5">Bajo límite NASA 2.0 mSv</div>
            </div>
            <div className="bg-[#0B0E14] border border-[#1E2738] rounded-lg p-3">
              <div className="text-[10px] text-slate-400">RETORNO BASE ALPHA</div>
              <div className="text-xl font-extrabold text-[#00FFA3] mt-1">100.0% VIABLE</div>
              <div className="text-[10px] text-slate-400 mt-0.5">4.90 km totales · 165 min</div>
            </div>
            <div className="bg-[#0B0E14] border border-[#1E2738] rounded-lg p-3">
              <div className="text-[10px] text-slate-400">VENTANA NLOS PREVISTA</div>
              <div className="text-xl font-extrabold text-[#FFE600] mt-1">T+92 → T+158</div>
              <div className="text-[10px] text-slate-400 mt-0.5">Buffer Zenoh local activo</div>
            </div>
          </div>
        </div>
      ) : (
      <div className="bg-[#111622] border border-[#1E2738] rounded-xl p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded bg-[#FF9100]/20 text-[#FF9100] font-mono-tech text-[10px] font-bold">
                SIMULACIÓN ESTOCÁSTICA · MONTE CARLO 100X (SEED {chaosResult.seed})
              </span>
              <span className="text-xs text-slate-400">
                Evento simulado: T+105 SPE (8 mSv/h) + Polvo τ=2.4 + NLOS + Talud 22°
              </span>
            </div>
            <h2 className="text-lg font-bold text-white mt-1">
              Evaluación Binaria de Contingencia (Chaos Mode · Rust WASM)
            </h2>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={isRunningChaos}
              onClick={() => {
                const nextSeed = seed + 17;
                setSeed(nextSeed);
                onNotify?.(
                  'Chaos Mode ejecutado en Rust API',
                  `100 escenarios Monte Carlo (Seed ${nextSeed})`,
                  'amber'
                );
              }}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#0B0E14] border border-[#1E2738] hover:border-[#00F5D4] text-xs font-mono-tech text-slate-200 cursor-pointer active:scale-[0.98] disabled:opacity-60"
            >
              <Play className={`w-3.5 h-3.5 text-[#00F5D4] ${isRunningChaos ? 'animate-spin' : ''}`} />
              <span>{isRunningChaos ? 'Simulando...' : 'Correr 100 Iteraciones'}</span>
            </button>
            <button
              type="button"
              onClick={handleDownloadGeoJson}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#00F5D4] hover:bg-[#00F5D4]/90 text-[#0B0E14] text-xs font-mono-tech font-bold cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{zenohSynced ? 'EXPORTAR GEOJSON + SYNC OK' : 'APROBAR Y EXPORTAR GEOJSON'}</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Option A: Return to Base (INVIABLE) */}
          <div className="bg-[#0B0E14] border border-[#FF1744]/40 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-100">A · Retorno Directo a Base Alpha</span>
              <span className="px-2 py-0.5 rounded bg-[#FF1744]/20 text-[#FF1744] font-mono-tech text-[10px] font-bold">
                INVIABLE
              </span>
            </div>
            <div className="font-mono-tech text-3xl font-extrabold text-[#FF1744]">
              {chaosResult.baseSurvivalPct}%{' '}
              <span className="text-xs font-semibold text-slate-400">PROBABILIDAD DE ÉXITO</span>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              Exposición a cielo abierto durante <strong className="text-slate-200">{chaosResult.baseTimeMin} minutos</strong> (2.5 km rodeo D* Lite).
              Dosis SPE acumulada <strong className="text-[#FF1744]">~{chaosResult.meanBaseDoseMsv} mSv</strong> ({(chaosResult.meanBaseDoseMsv / 2.0).toFixed(1)}× la regla de vuelo de 2.0 mSv).
            </p>
            <div className="grid grid-cols-2 gap-2 pt-1 font-mono-tech text-[11px] text-slate-400 border-t border-[#1E2738]">
              <span>Tiempo retorno: {chaosResult.baseTimeMin} min</span>
              <span className="text-right text-[#FF1744]">Dosis media: {chaosResult.meanBaseDoseMsv} mSv</span>
            </div>
            <div className="flex items-center gap-1.5 text-[11px] font-mono-tech text-[#FF1744]">
              <XCircle className="w-3.5 h-3.5" />
              <span>Vector descartado por protocolo Dynamic Goal Switching</span>
            </div>
          </div>

          {/* Option B: WP3 Shelter (CERTIFICADO SEGURO) */}
          <div className="bg-[#0B0E14] border border-[#00FFA3]/50 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <span className="font-semibold text-slate-100">B · Desvío a Refugio WP3 (Alcoba)</span>
              <div className="flex items-center gap-1.5">
                <span className="px-2 py-0.5 rounded bg-[#1E2738] text-[#00F5D4] font-mono-tech text-[10px]">
                  {chaosFromApi ? 'MOTOR: RUST CORE API (LIVE)' : 'MOTOR: CHAOS MODE (LOCAL)'}
                </span>
                <span className="px-2 py-0.5 rounded bg-[#00FFA3]/20 text-[#00FFA3] font-mono-tech text-[10px] font-bold">
                  CERTIFICADO SEGURO
                </span>
              </div>
            </div>
            <div className="font-mono-tech text-3xl font-extrabold text-[#00FFA3]">
              {chaosResult.wp3SurvivalPct}%{' '}
              <span className="text-xs font-semibold text-slate-400">PROBABILIDAD DE ÉXITO</span>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              Arribo cuesta abajo (600 m) en solo <strong className="text-slate-200">{chaosResult.wp3TimeMin} minutos</strong>.
              Alcoba con cornisa basáltica (<strong className="text-[#00FFA3]">SVF 0.15</strong>) atenúa el <strong className="text-[#00FFA3]">85%</strong> del flujo SPE (1.2 mSv/h).
            </p>
            <div className="grid grid-cols-2 gap-2 pt-1 font-mono-tech text-[11px] text-slate-400 border-t border-[#1E2738]">
              <span>Tiempo a refugio: {chaosResult.wp3TimeMin} min</span>
              <span className="text-right text-[#00FFA3]">Dosis EVA-07 total: ~1.40 mSv</span>
            </div>
            <div className="flex items-center justify-between text-[11px] font-mono-tech text-[#00FFA3]">
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Protocolo 07-Alpha Validado
              </span>
              <span className="flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5" />
                RECOMENDACIÓN ÓPTIMA
              </span>
            </div>
          </div>
        </div>
      </div>
      )}
    </div>
  );
};
