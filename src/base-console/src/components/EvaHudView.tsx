import React, { useEffect, useRef, useState } from 'react';
import {
  Activity,
  AlertOctagon,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Compass,
  Layers,
  MapPin,
  Mic,
  Minus,
  Plus,
  Radio,
  RotateCcw,
  RotateCw,
  ShieldCheck,
  Trash2,
  Undo2,
  Volume2,
} from 'lucide-react';
import { CANONICAL_WAYPOINTS, EVA07_EVENTS } from '@/data/missionData';
import type { MarsRawImage } from '@/engine/apiClient';
import {
  MARS_TREK_LAYERS,
  MELAS_CENTER,
  TILE_SIZE,
  getTrekTileUrl,
  haversineMarsKm,
  latLonToWorldPx,
  worldPxToLatLon,
  type MarsTrekLayerId,
} from '@/engine/marsTrekTiles';
import { classifyEvaState } from '@/engine/p3Bridge';
import type { Eva07Event } from '@/types/mission';

interface EvaHudViewProps {
  forceEmergency?: boolean;
  currentEvent: Eva07Event;
  marsImage?: MarsRawImage | null;
  marsImages?: MarsRawImage[];
  selectedImageIdx?: number;
  onChangeImageIdx?: (idx: number) => void;
  onSelectTimeMin: (tMin: number) => void;
  onNotify?: (title: string, detail?: string, tone?: 'cyan' | 'green' | 'amber' | 'red') => void;
}

interface CustomMapPoint {
  id: number;
  lat: number;
  lonE: number;
  label: string;
  kind: 'ISRU' | 'PELIGRO' | 'REFUGIO';
}

export const EvaHudView: React.FC<EvaHudViewProps> = ({
  forceEmergency = false,
  currentEvent,
  marsImage = null,
  marsImages = [],
  selectedImageIdx = 0,
  onChangeImageIdx,
  onSelectTimeMin,
  onNotify,
}) => {
  const [dialPos, setDialPos] = useState<1 | 2 | 3>(forceEmergency ? 3 : 2);
  const [voicePlaying, setVoicePlaying] = useState(false);
  const [showArGrid, setShowArGrid] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [isruSamples, setIsruSamples] = useState(1);

  // Extensible NASA JPL Mars Trek WMTS Map State
  const visorRef = useRef<HTMLDivElement | null>(null);
  const [visorSize, setVisorSize] = useState({ width: 900, height: 430 });
  const [baseLayer, setBaseLayer] = useState<MarsTrekLayerId>('viking');
  const [tileZoom, setTileZoom] = useState<number>(5);
  const [mapCenter, setMapCenter] = useState<{ lat: number; lonE: number }>(MELAS_CENTER);
  const [pointKind, setPointKind] = useState<'ISRU' | 'PELIGRO' | 'REFUGIO'>('ISRU');
  const [customPoints, setCustomPoints] = useState<CustomMapPoint[]>([]);

  const dragRef = useRef<{
    active: boolean;
    moved: boolean;
    startX: number;
    startY: number;
    origCenterWx: number;
    origCenterWy: number;
  }>({ active: false, moved: false, startX: 0, startY: 0, origCenterWx: 0, origCenterWy: 0 });

  useEffect(() => {
    const el = visorRef.current;
    if (!el) return;
    const update = () => {
      setVisorSize({
        width: el.clientWidth || 900,
        height: el.clientHeight || 430,
      });
    };
    update();
    const obs = new ResizeObserver(update);
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const centerWorld = latLonToWorldPx(mapCenter.lat, mapCenter.lonE, tileZoom);

  const latLonToScreen = (lat: number, lonE: number) => {
    const pt = latLonToWorldPx(lat, lonE, tileZoom);
    const colsPx = Math.pow(2, tileZoom + 1) * TILE_SIZE;
    let dx = pt.x - centerWorld.x;
    if (dx > colsPx / 2) dx -= colsPx;
    if (dx < -colsPx / 2) dx += colsPx;
    return {
      x: visorSize.width / 2 + dx,
      y: visorSize.height / 2 + (pt.y - centerWorld.y),
    };
  };

  const handleMapPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return;
    dragRef.current = {
      active: true,
      moved: false,
      startX: e.clientX,
      startY: e.clientY,
      origCenterWx: centerWorld.x,
      origCenterWy: centerWorld.y,
    };
  };

  const handleMapPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.active) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    if (Math.hypot(dx, dy) > 5) {
      dragRef.current.moved = true;
    }
    if (dragRef.current.moved) {
      const nextWx = dragRef.current.origCenterWx - dx;
      const nextWy = dragRef.current.origCenterWy - dy;
      setMapCenter(worldPxToLatLon(nextWx, nextWy, tileZoom));
    }
  };

  const handleMapPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.active) return;
    const wasMoved = dragRef.current.moved;
    dragRef.current.active = false;
    if (wasMoved || (e.target as HTMLElement).closest('button')) return;

    const el = visorRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const clickWx = centerWorld.x + (e.clientX - rect.left - rect.width / 2);
    const clickWy = centerWorld.y + (e.clientY - rect.top - rect.height / 2);
    const { lat, lonE } = worldPxToLatLon(clickWx, clickWy, tileZoom);

    const nextNum = customPoints.length + 1;
    const newPt: CustomMapPoint = {
      id: Date.now() + nextNum,
      lat,
      lonE,
      label: `P${nextNum}`,
      kind: pointKind,
    };
    setCustomPoints((prev) => [...prev, newPt]);
    onNotify?.(
      `Punto ${newPt.label} (${newPt.kind}) añadido`,
      `${lat.toFixed(2)}°, ${lonE.toFixed(2)}°E · Arrastra para extender el mapa`,
      newPt.kind === 'PELIGRO' ? 'red' : newPt.kind === 'REFUGIO' ? 'green' : 'cyan'
    );
  };

  const handleMapWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    setTileZoom((z) => Math.max(3, Math.min(7, z + (e.deltaY < 0 ? 1 : -1))));
  };

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

  // Compute visible Mars Trek WMTS tiles covering the current viewport
  const cols = Math.pow(2, tileZoom + 1);
  const rows = Math.pow(2, tileZoom);
  const topLeftWx = centerWorld.x - visorSize.width / 2;
  const topLeftWy = centerWorld.y - visorSize.height / 2;
  const minTx = Math.floor(topLeftWx / TILE_SIZE);
  const maxTx = Math.floor((topLeftWx + visorSize.width) / TILE_SIZE);
  const minTy = Math.max(0, Math.floor(topLeftWy / TILE_SIZE));
  const maxTy = Math.min(rows - 1, Math.floor((topLeftWy + visorSize.height) / TILE_SIZE));

  const visibleTiles: Array<{ key: string; url: string; left: number; top: number }> = [];
  if (baseLayer !== 'rover') {
    for (let ty = minTy; ty <= maxTy; ty++) {
      for (let tx = minTx; tx <= maxTx; tx++) {
        const wrappedTx = ((tx % cols) + cols) % cols;
        visibleTiles.push({
          key: `${baseLayer}-${tileZoom}-${tx}-${ty}`,
          url: getTrekTileUrl(baseLayer, tileZoom, wrappedTx, ty),
          left: tx * TILE_SIZE - topLeftWx,
          top: ty * TILE_SIZE - topLeftWy,
        });
      }
    }
  }

  const baseOrigin = CANONICAL_WAYPOINTS[0];
  const projectedWaypoints = CANONICAL_WAYPOINTS.map((wp) => ({
    wp,
    ...latLonToScreen(wp.lat, wp.lonE),
  }));
  const projectedCustom = customPoints.map((pt) => ({
    pt,
    ...latLonToScreen(pt.lat, pt.lonE),
  }));

  return (
    <div className="space-y-4">
      {/* Interactive EVA-07 Timeline Scrubber (P1 eva07_events.json) */}
      <div className="bg-[#111622] border border-[#1E2738] rounded-xl p-3.5 space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="font-mono-tech text-[10px] text-[#00F5D4] font-bold uppercase tracking-wider">
            CRONOLOGÍA EVA-07 (DATOS P1 · {EVA07_EVENTS.length} HITOS)
          </div>
          <div className="text-xs font-semibold text-slate-100 font-mono-tech tabular-nums truncate max-w-full">
            T{currentEvent.t_min >= 0 ? `+${Math.round(currentEvent.t_min)}` : Math.round(currentEvent.t_min)}m ({currentEvent.lmst} LMST) — {currentEvent.title}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div
            className="flex items-center gap-2.5 bg-[#0B0E14] border border-[#1E2738] rounded-lg px-3 py-1.5 shrink-0"
            title="Desliza para fijar cualquier minuto de la misión EVA-07 (pausa EN VIVO automáticamente)"
          >
            <span className="font-mono-tech text-[10px] text-slate-400 shrink-0">TIEMPO MISIÓN</span>
            <input
              type="range"
              min={-45}
              max={165}
              step={1}
              value={Math.round(currentEvent.t_min)}
              onChange={(e) => onSelectTimeMin(Number(e.target.value))}
              className="w-36 accent-[#00F5D4] cursor-pointer"
            />
            <span className="font-mono-tech text-[10px] font-bold text-[#00F5D4] tabular-nums w-11 text-right shrink-0">
              T{currentEvent.t_min >= 0 ? `+${Math.round(currentEvent.t_min)}` : Math.round(currentEvent.t_min)}m
            </span>
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
            ? 'border-[#FF1744] bg-gradient-to-b from-[#2b090d] via-[#1b0c0e] to-[#0B0E14]'
            : isCaution
              ? 'border-[#FFE600]/60 bg-gradient-to-b from-[#1a180d] via-[#121318] to-[#0B0E14]'
              : 'border-[#1E2738] bg-gradient-to-b from-[#131722] via-[#10141e] to-[#0B0E14]'
        }`}
      >
        {/* Top Visor Status Strip */}
        <div className="border-b border-white/10 bg-[#0B0E14]/70 px-5 py-3 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2 font-mono-tech text-xs">
            <div className="flex items-center gap-3">
              <span
                className={`px-2.5 py-0.5 rounded font-bold flex items-center gap-1.5 ${
                  isEmergency
                    ? 'bg-[#FF1744] text-white animate-pulse'
                    : isCaution
                      ? 'bg-[#FFE600]/20 text-[#FFE600] border border-[#FFE600]/50'
                      : 'bg-[#00FFA3]/20 text-[#00FFA3] border border-[#00FFA3]/50'
                }`}
              >
                {isEmergency ? <AlertOctagon className="w-3.5 h-3.5" /> : <Compass className="w-3.5 h-3.5" />}
                {isEmergency ? 'ALERTA CRÍTICA MULTI-AMENAZA' : isCaution ? 'PRECAUCIÓN // NLOS' : 'EVA-07 // NOMINAL'}
              </span>
              <span className="text-slate-300">
                LMST <strong className="text-white">{currentEvent.lmst}</strong>
              </span>
              <span className="text-[#00F5D4]">
                O₂ {o2Pct.toFixed(1)}% ({currentEvent.values.o2_remaining_g.toFixed(0)} g)
              </span>
            </div>

            <div className="flex items-center gap-3">
              <span className={doseMsv > 2 ? 'text-[#FF1744] font-bold' : 'text-[#00FFA3]'}>
                RAD: {doseMsv.toFixed(2)} mSv
              </span>
              <span className="text-slate-600">|</span>
              <span className="flex items-center gap-1 text-slate-300">
                <Radio className="w-3.5 h-3.5 text-[#00F5D4]" />
                ZENOH {currentEvent.values.radio_class} ({currentEvent.values.radio_rssi_dbm.toFixed(0)} dBm)
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 font-mono-tech text-[11px]">
              {isEmergency ? (
                <>
                  <span className="px-2 py-0.5 rounded bg-[#FF1744]/20 border border-[#FF1744]/50 text-[#FF1744] line-through">
                    RETORNO BASE ALPHA: INVIABLE
                  </span>
                  <span className="px-2.5 py-0.5 rounded bg-[#00FFA3]/20 border border-[#00FFA3]/60 text-[#00FFA3] font-bold">
                    RUTA ACTIVA: REFUGIO WP3 BASALTO
                  </span>
                </>
              ) : (
                <span className="text-slate-300">
                  OBJETIVO ACTIVO: <strong className="text-[#00F5D4]">{currentEvent.values.viable_destination}</strong> ·{' '}
                  {currentEvent.title}
                </span>
              )}
            </div>

            <div className="text-[11px] font-mono-tech text-slate-300">
              Centro mapa: {mapCenter.lat.toFixed(2)}°, {mapCenter.lonE.toFixed(2)}°E · Zoom Z{tileZoom}
            </div>
          </div>
        </div>

        {/* Center Extensible Mars Trek Map Viewport */}
        <div
          ref={visorRef}
          onPointerDown={handleMapPointerDown}
          onPointerMove={handleMapPointerMove}
          onPointerUp={handleMapPointerUp}
          onWheel={handleMapWheel}
          className="relative min-h-[450px] flex flex-col items-center justify-between gap-4 p-4 overflow-hidden select-none cursor-grab active:cursor-grabbing bg-[#090C12]"
        >
          {/* NASA JPL Mars Trek Global WMTS Tile Layer (extends infinitely as you pan/zoom) */}
          {baseLayer !== 'rover' ? (
            <div className="absolute inset-0 pointer-events-none overflow-hidden">
              {visibleTiles.map((tile) => (
                <img
                  key={tile.key}
                  src={tile.url}
                  alt=""
                  draggable={false}
                  style={{
                    position: 'absolute',
                    left: `${tile.left}px`,
                    top: `${tile.top}px`,
                    width: `${TILE_SIZE}px`,
                    height: `${TILE_SIZE}px`,
                  }}
                  className={`max-w-none transition-opacity ${
                    isEmergency ? 'opacity-65 sepia hue-rotate-[-20deg] brightness-75' : 'opacity-90 brightness-95'
                  }`}
                />
              ))}
              <div
                className={`absolute inset-0 ${
                  isEmergency
                    ? 'bg-gradient-to-b from-[#2b090d]/60 via-transparent to-[#0B0E14]/80'
                    : 'bg-gradient-to-b from-[#0B0E14]/45 via-transparent to-[#0B0E14]/75'
                }`}
              />
            </div>
          ) : (
            marsImage && (
              <div className="absolute inset-0 flex items-center justify-center bg-[#06090f] px-6 py-14">
                <div className="flex flex-col md:flex-row items-center gap-5 max-w-4xl w-full bg-[#0B0E14]/92 border border-[#1E2738] rounded-xl p-4 shadow-2xl">
                  <div className="relative w-full md:w-[420px] h-[250px] bg-black rounded-lg overflow-hidden border border-[#1E2738] shrink-0 flex items-center justify-center">
                    <img
                      src={marsImage.proxyUrl}
                      alt={marsImage.imageid}
                      className="max-w-full max-h-full object-contain"
                    />
                    {marsImages.length > 1 && onChangeImageIdx && (
                      <div className="absolute bottom-2 right-2 flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() =>
                            onChangeImageIdx((selectedImageIdx - 1 + marsImages.length) % marsImages.length)
                          }
                          className="p-1.5 rounded bg-[#0B0E14]/90 hover:bg-[#1E2738] border border-[#1E2738] text-white cursor-pointer"
                          title="Imagen anterior NASA Mars 2020"
                        >
                          <ChevronLeft className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onChangeImageIdx((selectedImageIdx + 1) % marsImages.length)}
                          className="p-1.5 rounded bg-[#0B0E14]/90 hover:bg-[#1E2738] border border-[#1E2738] text-white cursor-pointer"
                          title="Siguiente imagen NASA Mars 2020"
                        >
                          <ChevronRight className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="flex-1 font-mono-tech text-xs space-y-2 text-slate-200 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="px-2 py-0.5 rounded bg-[#FF9100]/20 text-[#FF9100] text-[10px] font-bold">
                        NASA MARS 2020 PERSEVERANCE · #{selectedImageIdx + 1}/{marsImages.length || 1}
                      </span>
                      <span className="text-[10px] text-slate-400">{marsImage.credit}</span>
                    </div>
                    <div className="text-sm font-bold text-white truncate">{marsImage.title}</div>
                    <div className="grid grid-cols-2 gap-2 text-[11px] pt-1">
                      <div className="bg-[#111622] border border-[#1E2738] rounded px-2.5 py-1.5">
                        <span className="text-slate-400 block text-[9.5px]">SOL / INSTRUMENTO</span>
                        <strong className="text-[#00F5D4]">Sol {marsImage.sol} · {marsImage.instrument}</strong>
                      </div>
                      <div className="bg-[#111622] border border-[#1E2738] rounded px-2.5 py-1.5">
                        <span className="text-slate-400 block text-[9.5px]">ORIENTACIÓN MÁSTIL</span>
                        <strong className="text-white">Az {Number(marsImage.mastAz).toFixed(1)}° · El {Number(marsImage.mastEl).toFixed(1)}°</strong>
                      </div>
                      <div className="bg-[#111622] border border-[#1E2738] rounded px-2.5 py-1.5">
                        <span className="text-slate-400 block text-[9.5px]">SITIO / DRIVE</span>
                        <strong className="text-[#00FFA3]">Site {marsImage.site} · Drive {marsImage.drive}</strong>
                      </div>
                      <div className="bg-[#111622] border border-[#1E2738] rounded px-2.5 py-1.5">
                        <span className="text-slate-400 block text-[9.5px]">FECHA UTC</span>
                        <strong className="text-slate-200">{marsImage.dateTakenUtc ? marsImage.dateTakenUtc.slice(0, 19).replace('T', ' ') : marsImage.dateTakenMars}</strong>
                      </div>
                    </div>
                    <div className="text-[10px] text-slate-400 truncate">ID: {marsImage.imageid}</div>
                  </div>
                </div>
              </div>
            )
          )}

          {/* Georeferenced SVG Overlay (AR Grid, Melas Chasma Survival Triangle, & Custom Points) */}
          {baseLayer !== 'rover' && (
          <svg
            width={visorSize.width}
            height={visorSize.height}
            viewBox={`0 0 ${visorSize.width} ${visorSize.height}`}
            className="absolute inset-0 pointer-events-none"
          >
            {showArGrid && (
              <g opacity="0.32">
                {Array.from({ length: Math.ceil(visorSize.width / 100) }).map((_, i) => (
                  <line
                    key={`gx-${i}`}
                    x1={i * 100}
                    y1={0}
                    x2={i * 100}
                    y2={visorSize.height}
                    stroke="#00F5D4"
                    strokeWidth="0.7"
                    strokeDasharray="4 4"
                  />
                ))}
                {Array.from({ length: Math.ceil(visorSize.height / 80) }).map((_, i) => (
                  <line
                    key={`gy-${i}`}
                    x1={0}
                    y1={i * 80}
                    x2={visorSize.width}
                    y2={i * 80}
                    stroke="#00F5D4"
                    strokeWidth="0.7"
                    strokeDasharray="4 4"
                  />
                ))}
              </g>
            )}

            {/* Canonical Melas Chasma Survival Triangle */}
            {projectedWaypoints.length === 4 && (
              <g>
                <polygon
                  points={projectedWaypoints.map((w) => `${w.x},${w.y}`).join(' ')}
                  fill="rgba(0, 245, 212, 0.06)"
                  stroke={isEmergency ? '#FF9100' : '#00F5D4'}
                  strokeWidth="2"
                  strokeDasharray="6 4"
                />
                {projectedWaypoints.map(({ wp, x, y }) => {
                  const col =
                    wp.id === 'WP3'
                      ? '#00FFA3'
                      : wp.id === 'WP2'
                        ? '#FF9100'
                        : wp.id === 'WP1'
                          ? '#00F5D4'
                          : '#e2e8f0';
                  return (
                    <g key={wp.id}>
                      <circle cx={x} cy={y} r="6" fill={col} stroke="#0B0E14" strokeWidth="1.5" />
                      <rect x={x + 8} y={y - 10} width="54" height="16" rx="3" fill="#0B0E14" fillOpacity="0.88" stroke={col} strokeWidth="0.8" />
                      <text x={x + 12} y={y + 1} fill={col} fontSize="9.5" fontFamily="JetBrains Mono" fontWeight="700">
                        {wp.id}
                      </text>
                    </g>
                  );
                })}
              </g>
            )}

            {/* User-Placed Custom Route & Waypoints (georeferenced in Martian lat/lon) */}
            {projectedCustom.length > 0 && (
              <g>
                <polyline
                  points={`${projectedWaypoints[0].x},${projectedWaypoints[0].y} ${projectedCustom.map((p) => `${p.x},${p.y}`).join(' ')}`}
                  fill="none"
                  stroke="#00F5D4"
                  strokeWidth="2.5"
                  strokeDasharray="7 5"
                />
                {projectedCustom.map(({ pt, x, y }, i) => {
                  const prevLat = i === 0 ? baseOrigin.lat : projectedCustom[i - 1].pt.lat;
                  const prevLon = i === 0 ? baseOrigin.lonE : projectedCustom[i - 1].pt.lonE;
                  const distKm = haversineMarsKm(prevLat, prevLon, pt.lat, pt.lonE);
                  const distLabel = distKm < 1 ? `${Math.round(distKm * 1000)}m` : `${distKm.toFixed(1)}km`;
                  const color =
                    pt.kind === 'PELIGRO' ? '#FF1744' : pt.kind === 'REFUGIO' ? '#00FFA3' : '#00F5D4';
                  return (
                    <g key={pt.id}>
                      <circle cx={x} cy={y} r="10" fill={color} fillOpacity="0.24" stroke={color} strokeWidth="2" />
                      <circle cx={x} cy={y} r="4" fill={color} />
                      <rect x={x + 10} y={y - 16} width="86" height="18" rx="4" fill="#0B0E14" fillOpacity="0.92" stroke={color} strokeWidth="1" />
                      <text x={x + 15} y={y - 4} fill={color} fontSize="9.5" fontFamily="JetBrains Mono" fontWeight="700">
                        {pt.label} · {distLabel}
                      </text>
                    </g>
                  );
                })}
              </g>
            )}
          </svg>
          )}

          {/* Interactive Map Controls Toolbar */}
          <div className="relative z-10 w-full flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5 bg-[#0B0E14]/90 border border-[#1E2738] rounded-lg px-2 py-1 font-mono-tech text-[10px]">
              {/* Base Layer Switcher (NASA Mars Trek / Rover) */}
              {(['viking', 'mola', 'rover'] as const).map((lid) => (
                <button
                  key={lid}
                  type="button"
                  onClick={() => setBaseLayer(lid)}
                  className={`px-2 py-0.5 rounded font-bold transition cursor-pointer ${
                    baseLayer === lid
                      ? 'bg-[#FF9100]/20 text-[#FF9100] border border-[#FF9100]/60'
                      : 'text-slate-400 hover:text-white border border-transparent'
                  }`}
                >
                  {MARS_TREK_LAYERS[lid].label}
                </button>
              ))}

              <span className="text-slate-600">|</span>

              {/* Custom Point Kind */}
              <span className="flex items-center gap-1 text-slate-300">
                <MapPin className="w-3 h-3 text-[#00F5D4]" />
              </span>
              {(['ISRU', 'PELIGRO', 'REFUGIO'] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setPointKind(k)}
                  className={`px-1.5 py-0.5 rounded font-bold transition cursor-pointer ${
                    pointKind === k
                      ? k === 'PELIGRO'
                        ? 'bg-[#FF1744]/25 text-[#FF1744] border border-[#FF1744]'
                        : k === 'REFUGIO'
                          ? 'bg-[#00FFA3]/20 text-[#00FFA3] border border-[#00FFA3]'
                          : 'bg-[#00F5D4]/20 text-[#00F5D4] border border-[#00F5D4]'
                      : 'text-slate-400 hover:text-white border border-transparent'
                  }`}
                >
                  {k}
                </button>
              ))}

              <span className="text-slate-600">|</span>

              {/* Zoom & Center Controls */}
              <button
                type="button"
                onClick={() => setTileZoom((z) => Math.min(7, z + 1))}
                className="p-1 rounded bg-[#111622] hover:bg-white/10 border border-[#1E2738] text-slate-200 cursor-pointer"
                title="Acercar mapa (Z+1)"
              >
                <Plus className="w-3 h-3" />
              </button>
              <button
                type="button"
                onClick={() => setTileZoom((z) => Math.max(3, z - 1))}
                className="p-1 rounded bg-[#111622] hover:bg-white/10 border border-[#1E2738] text-slate-200 cursor-pointer"
                title="Alejar mapa (Z-1)"
              >
                <Minus className="w-3 h-3" />
              </button>
              <button
                type="button"
                onClick={() => {
                  setMapCenter(MELAS_CENTER);
                  setTileZoom(5);
                }}
                className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#111622] hover:bg-white/10 border border-[#1E2738] text-slate-300 cursor-pointer"
                title="Centrar en Melas Chasma"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Melas (Z{tileZoom})</span>
              </button>

              {customPoints.length > 0 && (
                <>
                  <button
                    type="button"
                    onClick={() => setCustomPoints((prev) => prev.slice(0, -1))}
                    className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#111622] hover:bg-white/10 border border-[#1E2738] text-slate-200 cursor-pointer"
                    title="Deshacer último punto"
                  >
                    <Undo2 className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCustomPoints([]);
                      onNotify?.('Puntos personalizados eliminados', 'Mapa restaurado', 'cyan');
                    }}
                    className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#FF1744]/15 hover:bg-[#FF1744]/25 border border-[#FF1744]/40 text-[#FF1744] cursor-pointer"
                    title="Borrar todos los puntos"
                  >
                    <Trash2 className="w-3 h-3" />
                    <span>Limpiar ({customPoints.length})</span>
                  </button>
                </>
              )}
            </div>

            <div className="pointer-events-none font-mono-tech text-[9.5px] px-2 py-0.5 rounded bg-[#0B0E14]/80 border border-[#1E2738] text-slate-300">
              {MARS_TREK_LAYERS[baseLayer].attribution}
            </div>
          </div>

          {/* Center Waypoint / Single-Alert Fusion Overlay */}
          {isEmergency && (
            <div className="relative z-10 my-2 max-w-xl w-full bg-[#0B0E14]/92 border-2 border-[#FF1744] rounded-2xl px-5 py-4 text-center shadow-[0_0_40px_rgba(255,23,68,0.35)] space-y-2 pointer-events-none">
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
          )}

          {/* Bottom Visor Corners */}
          <div className="relative z-10 w-full flex flex-wrap items-end justify-between gap-3">
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
                <div className="bg-[#0B0E14]/88 border border-[#1E2738] rounded-xl px-4 py-2 font-mono-tech text-xs space-y-0.5 pointer-events-none">
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

                <div className="bg-[#0B0E14]/88 border border-[#1E2738] rounded-xl px-4 py-2 font-mono-tech text-xs space-y-0.5 text-right pointer-events-none">
                  <div className="text-[10px] text-slate-400 font-bold">
                    {customPoints.length > 0 ? `RUTA PERSONALIZADA (${customPoints.length})` : 'CLIC: AÑADIR PUNTO · ARRASTRAR: EXPLORAR MARTE'}
                  </div>
                  <div className="flex items-center justify-end gap-4">
                    <span>PASO: <strong className="text-white">74 SPM</strong></span>
                    <span>TIU: <strong className="text-[#00F5D4]">410</strong></span>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Streamlined, Logical Suit Controls (No Redundant Cuff Buttons) */}
      <div className="bg-[#111622] border border-[#1E2738] rounded-2xl p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="font-mono-tech text-sm font-extrabold text-white">
                xEMU-04 CUFF INTERFACE
              </span>
              <span className="px-2 py-0.5 rounded bg-[#1E2738] font-mono-tech text-[10px] text-slate-300">
                DRA. ELENA ROSTOVA · EVA-07
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setShowArGrid((g) => !g);
                onNotify?.('Cuadrícula AR', showArGrid ? 'Oculta' : 'Visible sobre mapa Mars Trek', 'cyan');
              }}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border font-mono-tech text-xs font-semibold transition cursor-pointer ${
                showArGrid
                  ? 'bg-[#00F5D4]/15 border-[#00F5D4] text-[#00F5D4]'
                  : 'bg-[#0B0E14] border-[#1E2738] text-slate-300 hover:border-slate-500'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Cuadrícula AR</span>
            </button>

            <button
              type="button"
              onClick={() => setShowDiagnostics((d) => !d)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border font-mono-tech text-xs font-semibold transition cursor-pointer ${
                showDiagnostics
                  ? 'bg-[#00F5D4]/15 border-[#00F5D4] text-[#00F5D4]'
                  : 'bg-[#0B0E14] border-[#1E2738] text-slate-300 hover:border-slate-500'
              }`}
            >
              <Activity className="w-3.5 h-3.5" />
              <span>Diagnóstico Traje</span>
            </button>

            <button
              type="button"
              onClick={() => {
                const nextN = isruSamples + 1;
                setIsruSamples(nextN);
                onNotify?.(`Muestra ISRU #${nextN} registrada`, 'Kieserita ≥12% H₂O · Guardada en log local', 'green');
              }}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl border bg-[#0B0E14] border-[#1E2738] hover:border-[#00FFA3] font-mono-tech text-xs font-semibold text-slate-200 transition cursor-pointer"
            >
              <ShieldCheck className="w-3.5 h-3.5 text-[#00FFA3]" />
              <span>Registrar ISRU ({isruSamples})</span>
            </button>

            <button
              type="button"
              onClick={() => {
                const next = (dialPos === 3 ? 1 : dialPos + 1) as 1 | 2 | 3;
                setDialPos(next);
                if (next === 1) {
                  setShowArGrid(false);
                  onNotify?.('Dial Posición 1: HUD NOMINAL', 'Vista despejada sobre Mars Trek', 'cyan');
                } else if (next === 2) {
                  onNotify?.('Dial Posición 2: WAYPOINT LOCK', 'Anclaje Canyon-TRN hacia WP1/WP2', 'cyan');
                } else {
                  onNotify?.('Dial Posición 3: SOS EGRESS WP3', 'Activando evacuación autónoma a Refugio WP3', 'red');
                  onSelectTimeMin(105);
                }
              }}
              className="flex items-center gap-2 bg-[#0B0E14] border border-[#1E2738] hover:border-[#00F5D4] rounded-xl px-3 py-1.5 cursor-pointer active:scale-[0.98]"
            >
              <RotateCw className="w-4 h-4 text-[#00F5D4]" />
              <div className="text-left font-mono-tech">
                <div className="text-[9.5px] text-slate-400">DIAL (14 N·cm)</div>
                <div className="text-[11px] font-bold text-white">
                  {dialPos}/3 · {dialPos === 1 ? 'HUD' : dialPos === 2 ? 'WAYPOINT' : 'SOS WP3'}
                </div>
              </div>
            </button>
          </div>
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
