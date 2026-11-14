import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { Check, ChevronLeft, ChevronRight, Eye, Layers, Lock, RefreshCw, Unlock } from 'lucide-react';
import { CANONICAL_WAYPOINTS } from '@/data/missionData';
import type { MarsRawImage } from '@/engine/apiClient';
import type { Eva07Event, SpyglassMode, WaypointNode } from '@/types/mission';

interface Console3DViewProps {
  currentEvent: Eva07Event;
  zenohSynced: boolean;
  onSyncZenoh: () => void | Promise<void>;
  marsImages: MarsRawImage[];
  selectedImageIdx: number;
  onChangeImageIdx: (idx: number) => void;
  onNotify?: (title: string, detail?: string, tone?: 'cyan' | 'green' | 'amber' | 'red') => void;
}

interface ProjectedMarker {
  node: WaypointNode;
  x: number;
  y: number;
  visible: boolean;
}

interface SpyglassSample {
  elevM: number;
  slopeDeg: number;
  crismH2oPct: number;
  themisTiu: number;
  svf: number;
  nearestWp: string;
}

function sampleTerrainProps(vx: number, vz: number, molaScale = 1): SpyglassSample {
  const nx = vx / 4.75;
  const nz = vz / 4.75;
  const eps = 0.04;
  const y0 = terrainElevationOffset(nx, nz) * molaScale;
  const yx = terrainElevationOffset(nx + eps, nz) * molaScale;
  const yz = terrainElevationOffset(nx, nz + eps) * molaScale;
  const grad = Math.hypot((yx - y0) / (eps * 4.75), (yz - y0) / (eps * 4.75));
  const slopeDeg = Math.min(34, Math.max(1.2, Math.atan(grad) * (180 / Math.PI) * 1.15));
  const elevM = Math.round(-1640 + y0 * 110);

  const dWp1 = Math.hypot(vx - 1.4, vz - 0.5);
  const crismH2oPct = Number((3.8 + Math.exp(-(dWp1 * dWp1) / 0.85) * 9.8).toFixed(1));

  const dWp2 = Math.hypot(vx + 0.65, vz - 2.4);
  const themisTiu = Math.round(335 - Math.exp(-(dWp2 * dWp2) / 1.1) * 225);

  const dWp3 = Math.hypot(vx + 1.33, vz + 0.85);
  const svf = Number(Math.max(0.15, Math.min(0.94, 0.78 - Math.exp(-(dWp3 * dWp3) / 0.7) * 0.63)).toFixed(2));

  let nearestWp = 'CUENCA SW';
  let minD = 999;
  for (const wp of CANONICAL_WAYPOINTS) {
    const p = geoToScene(wp.lat, wp.lonE);
    const d = Math.hypot(vx - p.x, vz - p.z);
    if (d < minD) {
      minD = d;
      nearestWp = d < 0.75 ? wp.id : `~${wp.id}`;
    }
  }

  return { elevM, slopeDeg: Number(slopeDeg.toFixed(1)), crismH2oPct, themisTiu, svf, nearestWp };
}

function terrainElevationOffset(nx: number, nz: number): number {
  // Deterministic Melas Chasma SW basin + steep SW canyon wall relief
  const wallSlope = Math.max(0, -nz - 0.15) * 2.4;
  const ridge = Math.sin(nx * 3.1 + nz * 1.9) * 0.22 + Math.cos(nx * 5.2 - nz * 4.1) * 0.1;
  const wp2Ramp = Math.exp(-((nx - 0.18) ** 2 + (nz - 0.35) ** 2) / 0.14) * 0.55;
  const wp3Alcove = Math.exp(-((nx + 0.28) ** 2 + (nz + 0.18) ** 2) / 0.1) * 0.25;
  return wallSlope + ridge + wp2Ramp - wp3Alcove;
}

// Convert canonical lat/lonE around Melas SW basin into local scene coords
function geoToScene(lat: number, lonE: number): { x: number; z: number } {
  const centerLat = -9.915;
  const centerLon = 283.391;
  const x = (lonE - centerLon) * 140; // ~[-1.6, 1.6]
  const z = -(lat - centerLat) * 140; // ~[-2.6, 2.6]
  return { x, z };
}

export const Console3DView: React.FC<Console3DViewProps> = ({
  currentEvent,
  zenohSynced,
  onSyncZenoh,
  marsImages,
  selectedImageIdx,
  onChangeImageIdx,
  onNotify,
}) => {
  const activeMarsImage = marsImages[selectedImageIdx] ?? null;
  const [isSyncing, setIsSyncing] = useState(false);
  const [focusedWaypointId, setFocusedWaypointId] = useState<WaypointNode['id'] | null>(null);
  const mountRef = useRef<HTMLDivElement | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const terrainMeshRef = useRef<THREE.Mesh | null>(null);
  const raycasterRef = useRef(new THREE.Raycaster());
  const [spyglassMode, setSpyglassMode] = useState<SpyglassMode>('tri-sector');
  const [spyglassPinned, setSpyglassPinned] = useState(false);
  const [spyglassPos, setSpyglassPos] = useState({ x: 530, y: 210 });
  const [spyglassSample, setSpyglassSample] = useState<SpyglassSample>(() => sampleTerrainProps(0.4, 0.2, 1));
  const [layers, setLayers] = useState({
    mola: true,
    crism: true,
    themis: false,
    h3o: true,
  });
  const [markers, setMarkers] = useState<ProjectedMarker[]>([]);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const width = container.clientWidth || 900;
    const height = container.clientHeight || 540;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#090D14');
    scene.fog = new THREE.FogExp2('#090D14', 0.085);

    const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 100);
    camera.position.set(0.4, 5.4, 6.2);
    camera.lookAt(0, 0.1, 0);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    // Lighting
    scene.add(new THREE.AmbientLight('#8ba3c7', 0.55));
    const dirLight = new THREE.DirectionalLight('#ffd7b5', 1.4);
    dirLight.position.set(6, 8, 4);
    scene.add(dirLight);

    // Terrain Mesh (Melas Chasma SW Basin)
    const molaScale = layers.mola ? 1 : 0.12;
    const segs = 96;
    const planeGeo = new THREE.PlaneGeometry(9.5, 9.5, segs, segs);
    planeGeo.rotateX(-Math.PI / 2);

    const posAttr = planeGeo.attributes.position;
    const colors: number[] = [];
    for (let i = 0; i < posAttr.count; i++) {
      const vx = posAttr.getX(i);
      const vz = posAttr.getZ(i);
      const y = terrainElevationOffset(vx / 4.75, vz / 4.75) * molaScale;
      posAttr.setY(i, y);

      // Subtle Martian basalt + orbital layer tinting
      const shade = Math.min(1, Math.max(0.18, 0.28 + y * 0.22));
      let r = shade * 0.42;
      let g = shade * 0.44;
      let b = shade * 0.48;

      if (layers.crism) {
        const dWp1 = Math.hypot(vx - 1.4, vz - 0.5);
        if (dWp1 < 1.1) {
          const w = (1 - dWp1 / 1.1) * 0.45;
          g += w * 0.5;
          b += w * 0.7;
        }
      }
      if (layers.themis) {
        const dWp2 = Math.hypot(vx + 0.65, vz - 2.4);
        if (dWp2 < 1.2) {
          const w = (1 - dWp2 / 1.2) * 0.55;
          r += w * 0.85;
          g += w * 0.35;
        }
      }
      colors.push(r, g, b);
    }
    planeGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    planeGeo.computeVertexNormals();

    const terrainMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.9,
      metalness: 0.08,
    });
    if (activeMarsImage) {
      const loader = new THREE.TextureLoader();
      loader.load(activeMarsImage.proxyUrl, (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        terrainMat.map = tex;
        terrainMat.bumpMap = tex;
        terrainMat.bumpScale = 0.25;
        terrainMat.displacementMap = tex;
        terrainMat.displacementScale = 0.35;
        terrainMat.needsUpdate = true;
      });
    }
    const terrainMesh = new THREE.Mesh(planeGeo, terrainMat);
    terrainMeshRef.current = terrainMesh;
    scene.add(terrainMesh);

    // Optional h3o wireframe overlay
    if (layers.h3o) {
      const wireMat = new THREE.MeshBasicMaterial({
        color: '#00F5D4',
        wireframe: true,
        transparent: true,
        opacity: 0.08,
      });
      const wireMesh = new THREE.Mesh(planeGeo, wireMat);
      wireMesh.position.y = 0.01;
      scene.add(wireMesh);
    }

    // Survival Triangle Route Lines
    const pts: THREE.Vector3[] = [];
    const nodeVectors = CANONICAL_WAYPOINTS.map((wp) => {
      const { x, z } = geoToScene(wp.lat, wp.lonE);
      const y = terrainElevationOffset(x / 4.75, z / 4.75) * molaScale + 0.08;
      return { wp, vec: new THREE.Vector3(x, y, z) };
    });

    for (const item of nodeVectors) {
      pts.push(item.vec);
    }
    pts.push(nodeVectors[0].vec); // Close triangle WP3 -> BASE

    const routeGeo = new THREE.BufferGeometry().setFromPoints(pts);
    const routeMat = new THREE.LineBasicMaterial({ color: '#FF9100', linewidth: 2 });
    scene.add(new THREE.Line(routeGeo, routeMat));

    // Escape leg WP2 -> WP3 highlighted in Bio-Green
    const escGeo = new THREE.BufferGeometry().setFromPoints([
      nodeVectors[2].vec.clone().setY(nodeVectors[2].vec.y + 0.03),
      nodeVectors[3].vec.clone().setY(nodeVectors[3].vec.y + 0.03),
    ]);
    scene.add(new THREE.Line(escGeo, new THREE.LineBasicMaterial({ color: '#00FFA3' })));

    // Waypoint Spheres
    nodeVectors.forEach(({ wp, vec }) => {
      const color =
        wp.id === 'BASE'
          ? '#e2e8f0'
          : wp.id === 'WP1'
            ? '#00F5D4'
            : wp.id === 'WP2'
              ? '#FF9100'
              : '#00FFA3';
      const sphere = new THREE.Mesh(
        new THREE.SphereGeometry(0.1, 16, 16),
        new THREE.MeshBasicMaterial({ color })
      );
      sphere.position.copy(vec);
      scene.add(sphere);
    });

    const projectMarkers = () => {
      const w = container.clientWidth || width;
      const h = container.clientHeight || height;
      const projected = nodeVectors.map(({ wp, vec }) => {
        const v = vec.clone().project(camera);
        return {
          node: wp,
          x: (v.x * 0.5 + 0.5) * w,
          y: (-v.y * 0.5 + 0.5) * h,
          visible: v.z < 1,
        };
      });
      setMarkers(projected);
    };

    let animId = 0;
    let t = 0;
    const animate = () => {
      t += 0.004;
      camera.position.x = 0.4 + Math.sin(t) * 0.25;
      camera.lookAt(0, 0.1, 0);
      renderer.render(scene, camera);
      projectMarkers();
      animId = requestAnimationFrame(animate);
    };
    animate();

    const handleResize = () => {
      if (!container) return;
      const nw = container.clientWidth;
      const nh = container.clientHeight;
      camera.aspect = nw / nh;
      camera.updateProjectionMatrix();
      renderer.setSize(nw, nh);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', handleResize);
      renderer.dispose();
    };
  }, [layers, activeMarsImage?.proxyUrl]);

  const sampleAtScreenPos = (clientOffsetX: number, clientOffsetY: number) => {
    const container = mountRef.current;
    const cam = cameraRef.current;
    const mesh = terrainMeshRef.current;
    if (!container || !cam || !mesh) return;
    const w = container.clientWidth || 900;
    const h = container.clientHeight || 640;
    const ndc = new THREE.Vector2((clientOffsetX / w) * 2 - 1, -(clientOffsetY / h) * 2 + 1);
    raycasterRef.current.setFromCamera(ndc, cam);
    const hits = raycasterRef.current.intersectObject(mesh, false);
    if (hits.length > 0) {
      const p = hits[0].point;
      setSpyglassSample(sampleTerrainProps(p.x, p.z, layers.mola ? 1 : 0.12));
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (spyglassPinned) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const nx = Math.max(115, Math.min(rect.width - 115, e.clientX - rect.left));
    const ny = Math.max(115, Math.min(rect.height - 115, e.clientY - rect.top));
    setSpyglassPos({ x: nx, y: ny });
    sampleAtScreenPos(nx, ny);
  };

  return (
    <div className="relative w-full h-[640px] rounded-2xl overflow-hidden border border-[#1E2738] bg-[#090D14]">
      {/* Three.js 3D Melas Chasma Canvas */}
      <div
        ref={mountRef}
        onPointerMove={handlePointerMove}
        onClick={() => setSpyglassPinned((p) => !p)}
        className="w-full h-full cursor-crosshair"
        title="Mueve el cursor para inspeccionar con la Lupa Spyglass (clic para fijar/soltar)"
      />

      {/* Waypoint Projected Labels (positioned cleanly around markers) */}
      <div className="pointer-events-none absolute inset-0">
        {markers.map(({ node, x, y, visible }) => {
          if (!visible) return null;
          const badgeColor =
            node.id === 'BASE'
              ? 'border-slate-400/50 text-slate-100'
              : node.id === 'WP1'
                ? 'border-[#00F5D4]/60 text-[#00F5D4]'
                : node.id === 'WP2'
                  ? 'border-[#FF9100]/70 text-[#FF9100]'
                  : 'border-[#00FFA3]/70 text-[#00FFA3]';
          // Offset WP2 slightly down-right and WP3 up-right so Spyglass never overlaps
          const dx = node.id === 'WP2' ? 14 : node.id === 'WP3' ? 14 : -50;
          const dy = node.id === 'WP2' ? 16 : -28;
          return (
            <div
              key={node.id}
              style={{ transform: `translate(${x + dx}px, ${y + dy}px)` }}
              className={`absolute top-0 left-0 px-2 py-0.5 rounded bg-[#0B0E14]/90 border font-mono-tech text-[10px] font-semibold whitespace-nowrap shadow-lg ${badgeColor}`}
            >
              {node.shortLabel} · {(node.distFromBaseM / 1000).toFixed(1)} KM
            </div>
          );
        })}
      </div>

      {/* Lupa Espacial "Spyglass" Tri-Sectorial 120° (Three.js Raycasted Overlay) */}
      <div
        style={{
          left: `${spyglassPos.x}px`,
          top: `${spyglassPos.y}px`,
          transform: 'translate(-50%, -50%)',
        }}
        className="pointer-events-none absolute flex flex-col items-center"
      >
        <div
          className={`w-56 h-56 rounded-full border-2 shadow-[0_0_35px_rgba(0,245,212,0.22)] overflow-hidden backdrop-brightness-125 ${
            spyglassPinned ? 'border-[#FF9100]' : 'border-[#00F5D4]/80'
          }`}
        >
          {spyglassMode === 'tri-sector' ? (
            <svg viewBox="0 0 200 200" className="w-full h-full">
              {/* Sector Norte (0° to 120° top): CRISM Sulfatos */}
              <path
                d="M100,100 L13.4,50 A100,100 0 0,1 186.6,50 Z"
                fill="rgba(0, 245, 212, 0.22)"
                stroke="#00F5D4"
                strokeWidth="1.2"
              />
              {/* Sector Derecho (120° to 240°): THEMIS Inercia Térmica */}
              <path
                d="M100,100 L186.6,50 A100,100 0 0,1 100,200 Z"
                fill="rgba(255, 145, 0, 0.22)"
                stroke="#FF9100"
                strokeWidth="1.2"
              />
              {/* Sector Izquierdo (240° to 360°): MOLA/HiRISE + SVF */}
              <path
                d="M100,100 L100,200 A100,100 0 0,1 13.4,50 Z"
                fill="rgba(0, 255, 163, 0.18)"
                stroke="#00FFA3"
                strokeWidth="1.2"
              />
              <circle cx="100" cy="100" r="4" fill="#FF9100" />
              <text x="100" y="34" textAnchor="middle" fill="#00F5D4" fontSize="9" fontFamily="JetBrains Mono" fontWeight="700">
                CRISM {spyglassSample.crismH2oPct}% H2O
              </text>
              <text x="148" y="132" textAnchor="middle" fill="#FF9100" fontSize="8.5" fontFamily="JetBrains Mono" fontWeight="700">
                THEMIS {spyglassSample.themisTiu} TIU
              </text>
              <text x="52" y="132" textAnchor="middle" fill="#00FFA3" fontSize="8.5" fontFamily="JetBrains Mono" fontWeight="700">
                SVF {spyglassSample.svf} / {spyglassSample.slopeDeg}°
              </text>
            </svg>
          ) : (
            <div
              className={`w-full h-full flex flex-col items-center justify-center gap-1 font-mono-tech text-xs font-bold ${
                spyglassMode === 'xray-crism'
                  ? 'bg-[#00F5D4]/20 text-[#00F5D4]'
                  : spyglassMode === 'xray-themis'
                    ? 'bg-[#FF9100]/20 text-[#FF9100]'
                    : 'bg-[#00FFA3]/20 text-[#00FFA3]'
              }`}
            >
              <span className="text-[10px] opacity-80">
                {spyglassMode === 'xray-crism' && 'X-RAY: CRISM SULFATOS'}
                {spyglassMode === 'xray-themis' && 'X-RAY: THEMIS INERCIA'}
                {spyglassMode === 'xray-mola' && 'X-RAY: MOLA / SVF'}
              </span>
              <span className="text-xl font-extrabold">
                {spyglassMode === 'xray-crism' && `${spyglassSample.crismH2oPct}% H₂O`}
                {spyglassMode === 'xray-themis' && `${spyglassSample.themisTiu} TIU`}
                {spyglassMode === 'xray-mola' && `${spyglassSample.elevM}m · ${spyglassSample.slopeDeg}°`}
              </span>
              <span className="text-[10px] opacity-90">
                {spyglassMode === 'xray-crism' &&
                  (spyglassSample.crismH2oPct >= 10 ? 'ISRU VIABLE' : 'BAJA HIDRATACIÓN')}
                {spyglassMode === 'xray-themis' &&
                  (spyglassSample.themisTiu < 150 ? 'TRAMPA POLVO' : 'BASALTO FIRME')}
                {spyglassMode === 'xray-mola' && `SVF ${spyglassSample.svf}`}
              </span>
            </div>
          )}
        </div>
        <div className="mt-1 px-2 py-0.5 rounded bg-[#0B0E14]/90 border border-[#1E2738] font-mono-tech text-[9.5px] text-slate-200 whitespace-nowrap">
          {spyglassSample.nearestWp} · {spyglassSample.elevM}m · {spyglassSample.slopeDeg}°
          {spyglassPinned ? ' · FIJA' : ''}
        </div>
      </div>

      {/* Left Floating Panels: Spectral Layers & Survival Triangle Summary */}
      <div className="absolute top-4 left-4 w-72 space-y-3">
        <div className="bg-[#0B0E14]/90 backdrop-blur-md border border-[#1E2738] rounded-xl p-3.5 space-y-3">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 font-mono-tech text-xs font-bold text-slate-100">
              <Layers className="w-3.5 h-3.5 text-[#00F5D4]" />
              CAPAS ESPECTRALES (COG)
            </span>
            <span className="font-mono-tech text-[10px] text-[#00FFA3]">EN LÍNEA</span>
          </div>

          {/* Spyglass Mode Switcher */}
          <div className="grid grid-cols-2 gap-1.5 bg-[#111622] p-1 rounded-lg border border-[#1E2738] font-mono-tech text-[10px]">
            <button
              type="button"
              onClick={() => {
                setSpyglassMode('tri-sector');
                onNotify?.('Lupa Spyglass: Modo Tri-Sector 120°', 'CRISM + THEMIS + MOLA/SVF activos', 'cyan');
              }}
              className={`py-1 rounded font-semibold transition cursor-pointer ${
                spyglassMode === 'tri-sector' ? 'bg-[#00F5D4]/20 text-[#00F5D4]' : 'text-slate-400 hover:text-white'
              }`}
            >
              Tri-Sector 120°
            </button>
            <button
              type="button"
              onClick={() => {
                setSpyglassMode('xray-crism');
                onNotify?.('Lupa Spyglass: Modo X-Ray 1 Capa', 'Selecciona la capa espectral abajo', 'cyan');
              }}
              className={`py-1 rounded font-semibold transition cursor-pointer ${
                spyglassMode !== 'tri-sector' ? 'bg-[#00F5D4]/20 text-[#00F5D4]' : 'text-slate-400 hover:text-white'
              }`}
            >
              Modo X-Ray 1 Capa
            </button>
          </div>

          {spyglassMode !== 'tri-sector' && (
            <div className="grid grid-cols-3 gap-1 font-mono-tech text-[9.5px]">
              {[
                { id: 'xray-crism', label: 'CRISM H₂O' },
                { id: 'xray-themis', label: 'THEMIS TIU' },
                { id: 'xray-mola', label: 'MOLA / SVF' },
              ].map((xm) => (
                <button
                  key={xm.id}
                  type="button"
                  onClick={() => setSpyglassMode(xm.id as SpyglassMode)}
                  className={`py-1 rounded border transition cursor-pointer ${
                    spyglassMode === xm.id
                      ? 'bg-[#00F5D4]/15 border-[#00F5D4] text-[#00F5D4] font-bold'
                      : 'bg-[#111622] border-[#1E2738] text-slate-400 hover:text-white'
                  }`}
                >
                  {xm.label}
                </button>
              ))}
            </div>
          )}

          <div className="space-y-2 text-xs">
            {[
              { key: 'mola', title: 'Relieve MOLA / CTX 20m', sub: 'Pendientes, horizonte & SVF' },
              { key: 'crism', title: 'Sulfatos CRISM', sub: 'Kieserita ≥12% H₂O (WP1)' },
              { key: 'themis', title: 'Inercia THEMIS', sub: 'Trampas polvo <150 TIU (WP2)' },
              { key: 'h3o', title: 'Malla Hexagonal h3o', sub: 'Res-12 (~5m) · Parquet' },
            ].map((item) => {
              const checked = layers[item.key as keyof typeof layers];
              return (
                <label
                  key={item.key}
                  className="flex items-start justify-between gap-2 cursor-pointer hover:bg-white/5 p-1 rounded"
                >
                  <div>
                    <div className="font-medium text-slate-200 leading-tight">{item.title}</div>
                    <div className="text-[10px] text-slate-400">{item.sub}</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() =>
                      setLayers((prev) => ({
                        ...prev,
                        [item.key]: !prev[item.key as keyof typeof layers],
                      }))
                    }
                    className="mt-1 accent-[#00F5D4]"
                  />
                </label>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => setSpyglassPinned((p) => !p)}
            className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-[#111622] border border-[#1E2738] hover:border-[#00F5D4]/50 font-mono-tech text-[10px] text-slate-300"
          >
            {spyglassPinned ? <Lock className="w-3 h-3 text-[#00F5D4]" /> : <Unlock className="w-3 h-3 text-slate-400" />}
            <span>{spyglassPinned ? 'LUPA FIJADA (CLIC PARA MOVER)' : 'LUPA LIBRE (CLIC EN MAPA PARA FIJAR)'}</span>
          </button>
        </div>

        <div className="bg-[#0B0E14]/90 backdrop-blur-md border border-[#1E2738] rounded-xl p-3.5 space-y-2">
          <div className="flex items-center justify-between font-mono-tech text-[11px]">
            <span className="text-slate-400">TRIÁNGULO SUPERVIVENCIA</span>
            <span className="text-[#FF9100] font-bold">MÁX 22.0° [E]</span>
          </div>
          <div className="flex items-baseline justify-between">
            <span className="font-mono-tech text-xl font-extrabold text-white">4.90 KM</span>
            <span className="font-mono-tech text-[11px] font-bold text-[#00FFA3]">GEOJSON VIABLE</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-slate-800 overflow-hidden flex">
            <div className="w-[31%] bg-[#00F5D4]" />
            <div className="w-[24%] bg-[#FF9100]" />
            <div className="w-[45%] bg-[#00FFA3]" />
          </div>
          <div className="grid grid-cols-4 gap-1 font-mono-tech text-[9.5px]">
            {CANONICAL_WAYPOINTS.map((wp) => {
              const isSel = focusedWaypointId === wp.id;
              return (
                <button
                  key={wp.id}
                  type="button"
                  onClick={() => {
                    setFocusedWaypointId(wp.id);
                    const p = geoToScene(wp.lat, wp.lonE);
                    setSpyglassSample(sampleTerrainProps(p.x, p.z, layers.mola ? 1 : 0.12));
                    const m = markers.find((mk) => mk.node.id === wp.id);
                    if (m) {
                      setSpyglassPinned(true);
                      setSpyglassPos({ x: m.x, y: m.y });
                    }
                    onNotify?.(`Lupa fijada en ${wp.shortLabel}`, wp.geology, 'cyan');
                  }}
                  className={`py-1 rounded border transition cursor-pointer ${
                    isSel
                      ? 'bg-[#00F5D4]/20 border-[#00F5D4] text-[#00F5D4] font-bold'
                      : 'bg-[#111622] border-[#1E2738] text-slate-300 hover:border-slate-500'
                  }`}
                >
                  {wp.id}
                </button>
              );
            })}
          </div>
          {focusedWaypointId && (
            <div className="text-[10px] text-slate-300 bg-[#111622] border border-[#1E2738] rounded-lg px-2.5 py-1.5 leading-snug">
              {CANONICAL_WAYPOINTS.find((w) => w.id === focusedWaypointId)?.geology}
            </div>
          )}
        </div>
      </div>

      {/* Right Floating Panel: EVA Suit Telemetry & Eclipse Zenoh Sync */}
      <div className="absolute top-4 right-4 w-72 space-y-2.5">
        <div className="bg-[#0B0E14]/90 backdrop-blur-md border border-[#1E2738] rounded-xl p-3.5 space-y-3">
          <div className="flex items-start justify-between">
            <div>
              <div className="font-mono-tech text-[10px] text-slate-400">EVA ACTIVO // XEMU-04</div>
              <div className="text-sm font-bold text-white">Dra. Elena Rostova</div>
            </div>
            <span className="px-2 py-0.5 rounded bg-[#00FFA3]/15 border border-[#00FFA3]/40 font-mono-tech text-[10px] font-bold text-[#00FFA3]">
              EGRESO OK
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="bg-[#111622] border border-[#1E2738] rounded-lg p-2.5">
              <div className="font-mono-tech text-[10px] text-slate-400">O₂ PLSS</div>
              <div className="font-mono-tech text-lg font-extrabold text-white">
                {currentEvent.values.o2_remaining_pct.toFixed(1)}%
              </div>
              <div className="font-mono-tech text-[10px] text-[#00FFA3]">800 g útiles</div>
            </div>
            <div className="bg-[#111622] border border-[#1E2738] rounded-lg p-2.5">
              <div className="font-mono-tech text-[10px] text-slate-400">REFUGIO WP3</div>
              <div className="font-mono-tech text-lg font-extrabold text-[#00FFA3]">8 min</div>
              <div className="font-mono-tech text-[10px] text-slate-400">600 m / SVF 0.15</div>
            </div>
          </div>

          <div className="flex items-center justify-between font-mono-tech text-[11px] text-slate-300 pt-1">
            <span>P: 29.6 kPa</span>
            <span>POT: {Math.round(currentEvent.values.metabolic_power_w)} W</span>
            <span className="text-[#00FFA3]">BAT: 88%</span>
          </div>

          <button
            type="button"
            disabled={isSyncing}
            onClick={async () => {
              setIsSyncing(true);
              await onSyncZenoh();
              setIsSyncing(false);
            }}
            className={`w-full py-2 px-3 rounded-lg font-mono-tech text-xs font-bold flex items-center justify-center gap-2 transition cursor-pointer active:scale-[0.98] ${
              zenohSynced
                ? 'bg-[#00FFA3]/20 border border-[#00FFA3]/60 text-[#00FFA3]'
                : 'bg-[#FF9100] hover:bg-[#FF9100]/90 text-[#0B0E14]'
            }`}
          >
            {zenohSynced ? (
              <Check className="w-4 h-4" />
            ) : (
              <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
            )}
            <span>
              {isSyncing
                ? 'SINCRONIZANDO ZENOH...'
                : zenohSynced
                  ? 'SYNC ECLIPSE ZENOH OK'
                  : 'SINCRONIZAR TRAJE (ZENOH)'}
            </span>
          </button>
        </div>

        <div className="bg-[#0B0E14]/90 backdrop-blur-md border border-[#1E2738] rounded-xl px-3.5 py-2 flex items-center justify-between font-mono-tech text-[10px]">
          <span className="flex items-center gap-1.5 text-slate-300">
            <Eye className="w-3.5 h-3.5 text-[#00F5D4]" />
            SOL 34° · NLOS T+92
          </span>
          <span className={currentEvent.values.radio_class === 'VERDE' ? 'text-[#00FFA3]' : 'text-[#FF1744]'}>
            ZENOH {currentEvent.values.radio_class}
          </span>
        </div>
      </div>

      {/* Clean Scale Bar (fixed spacing, no overlapping digits) */}
      <div className="pointer-events-none absolute bottom-4 left-4 flex items-center gap-3 bg-[#0B0E14]/85 border border-[#1E2738] rounded-lg px-3 py-1.5 font-mono-tech text-[10px] text-slate-300">
        <span>ESCALA 1:25,000 · 1.0 KM</span>
        <span className="text-slate-600">|</span>
        <span>CRS: IAU_2015:49900 (MOLA / CTX 20M)</span>
      </div>

      {/* Live NASA Mars 2020 Raw Image Texture Selector */}
      {activeMarsImage && (
        <div className="absolute bottom-4 right-4 flex items-center gap-2 bg-[#0B0E14]/90 border border-[#1E2738] rounded-lg px-2.5 py-1.5 font-mono-tech text-[10px] text-slate-200">
          <img
            src={activeMarsImage.proxyUrl}
            alt={activeMarsImage.imageid}
            className="w-7 h-7 rounded object-cover border border-[#00F5D4]/50"
          />
          <div>
            <div className="text-[#00F5D4] font-bold">
              NASA MARS 2020 · SOL {activeMarsImage.sol}
            </div>
            <div className="text-slate-400">
              {activeMarsImage.instrument} · #{selectedImageIdx + 1}/{marsImages.length}
            </div>
          </div>
          <div className="flex items-center gap-1 ml-1">
            <button
              type="button"
              onClick={() =>
                onChangeImageIdx((selectedImageIdx - 1 + marsImages.length) % marsImages.length)
              }
              className="p-1 rounded bg-[#111622] hover:bg-white/10 border border-[#1E2738] cursor-pointer"
              title="Imagen anterior NASA Mars 2020"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => onChangeImageIdx((selectedImageIdx + 1) % marsImages.length)}
              className="p-1 rounded bg-[#111622] hover:bg-white/10 border border-[#1E2738] cursor-pointer"
              title="Siguiente imagen NASA Mars 2020"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
