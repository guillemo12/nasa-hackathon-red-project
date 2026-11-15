// Escena Three.js del gemelo 3D. Todo lo que se dibuja sale de la malla H3 de P1 que sirve la
// API (`/api/terrain`, `/api/hexgrid`, `/api/route-plan`); sin API queda un plano con el
// triángulo del GeoJSON y la consola lo dice. La imagen del suelo es el mosaico CTX de 6 m
// co-registrado con el DTM (`/api/ortho`), proyectada por latitud y longitud sobre la malla; si
// no carga, el terreno se pinta como antes, por cota y capas.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { M_PER_DEG_LAT, mPerDegLon, terrainElevation } from '@/engine/geo';
import { classify } from '@/engine/thresholds';
import { PALETTE, TERRAIN } from '@/theme';
import type { HexCell, OrthoMeta, ReportedKind, TerrainGrid } from '@/types/mission';

export interface TwinLayers {
  /** Imagen orbital CTX de 6 m sobre el relieve. */
  ortho: boolean;
  mola: boolean;
  crism: boolean;
  themis: boolean;
  h3o: boolean;
}

export interface TwinPoint {
  id: number;
  kind: ReportedKind;
  lat: number;
  lonE: number;
  color: string;
  /** Radios de la zona de un PELIGRO (exclusión y precaución), m. */
  exclusionM?: number;
  cautionM?: number;
}

export interface Aoi {
  lat_min: number;
  lat_max: number;
  lon_e_min: number;
  lon_e_max: number;
}

export interface RoutePath {
  id: string;
  color: string;
  /** Ruta nominal de un tramo desviado: fina y discontinua. */
  dashed?: boolean;
  points: Array<{ lat: number; lonE: number }>;
}

export interface RayHit {
  lat: number;
  lonE: number;
  world: THREE.Vector3;
  /** Metros de terreno por píxel de pantalla en el punto tocado. */
  mPerPx: number;
}

/** Metros por unidad de escena. */
export const SCENE_M = 500;
/** Exageración vertical del relieve (se rotula en pantalla): escala real, sin exagerar. */
export const VERTICAL_EXAGGERATION = 1;
const FLAT_SCALE = 0.02;

export class TwinScene {
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private controls: OrbitControls;
  private terrainMesh: THREE.Mesh;
  private terrainGeo: THREE.BufferGeometry;
  private overlay = new THREE.Group();
  private pointsGroup = new THREE.Group();
  private baseMaterial: THREE.MeshStandardMaterial;
  private orthoMaterial: THREE.MeshStandardMaterial | null = null;
  private layerMesh: THREE.Mesh;
  private layerGeo: THREE.BufferGeometry;
  private ambient: THREE.AmbientLight;
  private sun: THREE.DirectionalLight;
  private reported: TwinPoint[] = [];
  private chaosGroup = new THREE.Group();
  private raycaster = new THREE.Raycaster();
  private lineMaterials: LineMaterial[] = [];
  private frame = 0;
  private dirty = true;
  private disposed = false;
  private layers: TwinLayers = { ortho: true, mola: true, crism: true, themis: false, h3o: true };
  private hexCells: HexCell[] = [];
  private routes: RoutePath[] = [];
  private nodes: Array<{ lat: number; lonE: number; color: string }> = [];
  private chaosTimer = 0;
  private latC: number;
  private lonC: number;
  private kLon: number;
  private resizeObs: ResizeObserver;

  /** Se llama tras cada fotograma pintado (para recolocar etiquetas HTML). */
  onFrame: (() => void) | null = null;

  constructor(
    private container: HTMLElement,
    private aoi: Aoi,
    private terrain: TerrainGrid | null
  ) {
    this.latC = (aoi.lat_min + aoi.lat_max) / 2;
    this.lonC = (aoi.lon_e_min + aoi.lon_e_max) / 2;
    this.kLon = mPerDegLon(this.latC);

    const w = container.clientWidth || 900;
    const h = container.clientHeight || 600;
    this.scene.background = new THREE.Color(PALETTE.ground);
    this.camera = new THREE.PerspectiveCamera(40, w / h, 0.05, 200);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.display = 'block';

    this.ambient = new THREE.AmbientLight(TERRAIN.ambientLight, 0.85);
    this.scene.add(this.ambient);
    this.sun = new THREE.DirectionalLight(TERRAIN.sunLight, 2.1);
    this.sun.position.set(-6, 9, -5); // sol al noroeste
    this.scene.add(this.sun);

    this.terrainGeo = this.buildTerrainGeometry();
    this.baseMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0.02, side: THREE.DoubleSide });
    this.terrainMesh = new THREE.Mesh(this.terrainGeo, this.baseMaterial);
    this.scene.add(this.terrainMesh);
    // Capas temáticas (pendiente, refugios, sulfatos, inercia térmica) sobre la imagen: misma
    // malla, colores con transparencia por vértice.
    this.layerGeo = new THREE.BufferGeometry();
    this.layerGeo.setAttribute('position', this.terrainGeo.getAttribute('position'));
    this.layerGeo.setIndex(this.terrainGeo.getIndex());
    this.layerGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array((this.terrainGeo.getAttribute('position') as THREE.BufferAttribute).count * 4), 4));
    this.layerMesh = new THREE.Mesh(
      this.layerGeo,
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      })
    );
    this.layerMesh.renderOrder = 1;
    this.layerMesh.frustumCulled = false; // comparte posiciones con el terreno, que cambian con el relieve
    this.layerMesh.visible = false;
    this.scene.add(this.layerMesh);
    this.scene.add(this.overlay);
    this.scene.add(this.pointsGroup);
    this.scene.add(this.chaosGroup);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableZoom = false; // la rueda es de la lupa (radio); el zoom va por botones y Ctrl+rueda
    this.controls.enableDamping = false;
    this.controls.maxPolarAngle = (82 * Math.PI) / 180;
    this.controls.minDistance = 1.2;
    this.controls.maxDistance = 30;
    this.controls.addEventListener('change', () => this.invalidate());
    this.resetView();

    this.applyRelief();
    this.paintTerrain();

    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(container);
    this.loop();
  }

  // ------------------------------------------------------------------ geometría
  private sceneX(lonE: number): number {
    return ((lonE - this.lonC) * this.kLon) / SCENE_M;
  }
  private sceneZ(lat: number): number {
    return (-(lat - this.latC) * M_PER_DEG_LAT) / SCENE_M;
  }
  private elevScale(): number {
    return this.layers.mola ? VERTICAL_EXAGGERATION : FLAT_SCALE;
  }
  private sceneY(elevM: number): number {
    const min = this.terrain?.elev_min_m ?? 0;
    return ((elevM - min) / SCENE_M) * this.elevScale();
  }

  /** Posición de escena de un punto geográfico, pegada al terreno. */
  worldOf(lat: number, lonE: number, liftM = 0): THREE.Vector3 {
    const elev = this.terrain ? terrainElevation(this.terrain, lat, lonE) : null;
    const y = elev === null ? 0 : this.sceneY(elev);
    return new THREE.Vector3(this.sceneX(lonE), y + liftM / SCENE_M, this.sceneZ(lat));
  }

  private geoOf(p: THREE.Vector3): { lat: number; lonE: number } {
    return {
      lat: this.latC - (p.z * SCENE_M) / M_PER_DEG_LAT,
      lonE: this.lonC + (p.x * SCENE_M) / this.kLon,
    };
  }

  private buildTerrainGeometry(): THREE.BufferGeometry {
    const t = this.terrain;
    const rows = t?.rows ?? 2;
    const cols = t?.cols ?? 2;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(rows * cols * 3);
    for (let r = 0; r < rows; r++) {
      const lat = this.aoi.lat_max - ((this.aoi.lat_max - this.aoi.lat_min) * r) / (rows - 1);
      for (let c = 0; c < cols; c++) {
        const lon = this.aoi.lon_e_min + ((this.aoi.lon_e_max - this.aoi.lon_e_min) * c) / (cols - 1);
        const i = (r * cols + c) * 3;
        pos[i] = this.sceneX(lon);
        pos[i + 1] = 0;
        pos[i + 2] = this.sceneZ(lat);
      }
    }
    const index: number[] = [];
    const ok = (r: number, c: number) => !t || t.elev_m[r * cols + c] !== null;
    for (let r = 0; r + 1 < rows; r++) {
      for (let c = 0; c + 1 < cols; c++) {
        if (!(ok(r, c) && ok(r, c + 1) && ok(r + 1, c) && ok(r + 1, c + 1))) continue;
        const a = r * cols + c;
        const b = a + 1;
        const d = a + cols;
        const e = d + 1;
        index.push(a, d, b, b, d, e);
      }
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(rows * cols * 3), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(rows * cols * 2), 2));
    geo.setIndex(index);
    return geo;
  }

  private applyRelief(): void {
    const t = this.terrain;
    if (!t) return;
    const pos = this.terrainGeo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < t.elev_m.length; i++) {
      const z = t.elev_m[i];
      pos.setY(i, z === null ? 0 : this.sceneY(z));
    }
    pos.needsUpdate = true;
    this.terrainGeo.computeVertexNormals();
    this.terrainGeo.computeBoundingSphere();
  }

  /** La imagen orbital está cargada y la capa activa. */
  private orthoOn(): boolean {
    return this.layers.ortho && this.orthoMaterial !== null && this.terrain !== null;
  }

  /**
   * Pinta el terreno. Sin imagen: color por cota con las capas mezcladas (aspecto de siempre).
   * Con imagen: la textura CTX en el material y las capas en la malla transparente de encima,
   * para que no tiñan ni oscurezcan la imagen donde no hay nada que señalar.
   */
  private paintTerrain(): void {
    const t = this.terrain;
    const col = this.terrainGeo.getAttribute('color') as THREE.BufferAttribute;
    const lay = this.layerGeo.getAttribute('color') as THREE.BufferAttribute;
    const low = new THREE.Color(TERRAIN.low);
    const high = new THREE.Color(TERRAIN.high);
    const cRed = new THREE.Color(PALETTE.red);
    const cAmber = new THREE.Color(PALETTE.amber);
    const cGreen = new THREE.Color(PALETTE.green);
    const cCyan = new THREE.Color(PALETTE.cyan);
    const cBlue = new THREE.Color(PALETTE.deepBlue);
    const tmp = new THREE.Color();
    const ortho = this.orthoOn();
    this.terrainMesh.material = ortho && this.orthoMaterial ? this.orthoMaterial : this.baseMaterial;
    this.layerMesh.visible = ortho;
    // La imagen ya trae las sombras reales del Sol (CTX, ~15° de elevación): la luz sintética
    // solo se deja suave para leer la forma cuando la cámara se inclina.
    this.sun.intensity = ortho ? 0.9 : 2.1;
    this.ambient.intensity = ortho ? 1.9 : 0.85;
    if (!t) {
      for (let i = 0; i < col.count; i++) col.setXYZ(i, 0.12, 0.14, 0.18);
      col.needsUpdate = true;
      this.invalidate();
      return;
    }
    const span = Math.max(1, t.elev_max_m - t.elev_min_m);
    for (let i = 0; i < t.elev_m.length; i++) {
      const z = t.elev_m[i];
      if (z === null) {
        col.setXYZ(i, 0.05, 0.06, 0.08);
        lay.setXYZW(i, 0, 0, 0, 0);
        continue;
      }
      tmp.copy(low).lerp(high, (z - t.elev_min_m) / span);
      // Capa de encima (modo imagen): color y opacidad del rasgo más importante de la celda.
      let lc: THREE.Color | null = null;
      let la = 0;
      if (this.layers.mola) {
        const slope = classify('slope_deg', t.slope_deg[i]);
        if (slope === 'red') {
          tmp.lerp(cRed, 0.3);
          lc = cRed;
          la = 0.32;
        }
        const svf = t.sky_view_factor[i];
        if (classify('shelter_sky_view_factor', svf) === 'green') {
          tmp.lerp(cGreen, 0.85);
          lc = cGreen;
          la = 0.5;
        }
      }
      if (this.layers.crism) {
        const h2o = t.isru_h2o_pct[i];
        if (h2o !== null) {
          const c = classify('isru_h2o_wt_pct', h2o) === 'green' ? cCyan : cBlue;
          tmp.lerp(c, 0.7);
          lc = c;
          la = 0.55;
        }
      }
      if (this.layers.themis) {
        const tiu = t.thermal_inertia_tiu[i];
        if (tiu !== null) {
          const level = classify('thermal_inertia_tiu', tiu);
          const c = level === 'red' ? cRed : level === 'amber' ? cAmber : cBlue;
          tmp.lerp(c, level === 'green' ? 0.45 : 0.75);
          lc = c;
          la = level === 'green' ? 0.3 : 0.55;
        }
      }
      col.setXYZ(i, tmp.r, tmp.g, tmp.b);
      if (lc) lay.setXYZW(i, lc.r, lc.g, lc.b, la);
      else lay.setXYZW(i, 0, 0, 0, 0);
    }
    col.needsUpdate = true;
    lay.needsUpdate = true;
    this.invalidate();
  }

  /**
   * Imagen orbital georreferenciada: coordenadas de textura por latitud y longitud de cada nodo
   * contra los límites del ráster (lon Este 0-360, fila 0 al norte). Fuera de la imagen el borde
   * se repite, pero la imagen cubre toda la AOI.
   */
  setOrtho(meta: OrthoMeta, texture: THREE.Texture): void {
    if (this.disposed) {
      texture.dispose();
      return;
    }
    const uv = this.terrainGeo.getAttribute('uv') as THREE.BufferAttribute;
    const t = this.terrain;
    const rows = t?.rows ?? 2;
    const cols = t?.cols ?? 2;
    const b = meta.bounds;
    for (let r = 0; r < rows; r++) {
      const lat = this.aoi.lat_max - ((this.aoi.lat_max - this.aoi.lat_min) * r) / (rows - 1);
      for (let c = 0; c < cols; c++) {
        const lon = this.aoi.lon_e_min + ((this.aoi.lon_e_max - this.aoi.lon_e_min) * c) / (cols - 1);
        // v = 0 abajo (sur) con `flipY` de Three: la fila 0 del PNG queda arriba, al norte.
        uv.setXY(r * cols + c, (lon - b.lon_e_min) / (b.lon_e_max - b.lon_e_min), (lat - b.lat_min) / (b.lat_max - b.lat_min));
      }
    }
    uv.needsUpdate = true;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    texture.needsUpdate = true;
    this.orthoMaterial?.map?.dispose();
    this.orthoMaterial?.dispose();
    this.orthoMaterial = new THREE.MeshStandardMaterial({ map: texture, roughness: 1, metalness: 0, side: THREE.DoubleSide });
    this.paintTerrain();
  }

  /** Puntos marcados desde Telemetría EVA, con las zonas de los peligros pegadas al relieve. */
  setReportedPoints(points: TwinPoint[]): void {
    this.reported = points;
    this.rebuildPoints();
  }

  private rebuildPoints(): void {
    this.disposeGroup(this.pointsGroup);
    for (const p of this.reported) {
      const ring = (radiusM: number, widthPx: number, dashed: boolean) => {
        const pts: THREE.Vector3[] = [];
        for (let k = 0; k <= 64; k++) {
          const a = (k / 64) * Math.PI * 2;
          const dLat = (Math.cos(a) * radiusM) / M_PER_DEG_LAT;
          const dLon = (Math.sin(a) * radiusM) / this.kLon;
          pts.push(this.worldOf(p.lat + dLat, p.lonE + dLon, 6));
        }
        this.pointsGroup.add(this.fatLine(pts, p.color, widthPx, dashed));
      };
      if (p.exclusionM) ring(p.exclusionM, 3, false);
      if (p.cautionM) ring(p.cautionM, 2, true);
      const pin = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.16, 16), new THREE.MeshBasicMaterial({ color: p.color, depthTest: false }));
      pin.rotation.x = Math.PI;
      pin.position.copy(this.worldOf(p.lat, p.lonE, 45));
      pin.renderOrder = 6;
      this.pointsGroup.add(pin);
    }
    this.invalidate();
  }

  // ------------------------------------------------------------------ capas vectoriales
  private fatLine(points: THREE.Vector3[], color: string, widthPx: number, dashed = false): Line2 {
    const geo = new LineGeometry();
    geo.setPositions(points.flatMap((p) => [p.x, p.y, p.z]));
    const mat = new LineMaterial({
      color: new THREE.Color(color).getHex(),
      linewidth: widthPx,
      dashed,
      dashSize: 0.12,
      gapSize: 0.08,
      depthTest: false,
      transparent: true,
    });
    mat.resolution.set(this.container.clientWidth || 900, this.container.clientHeight || 600);
    this.lineMaterials.push(mat);
    const line = new Line2(geo, mat);
    if (dashed) line.computeLineDistances();
    line.renderOrder = 5;
    return line;
  }

  private disposeGroup(group: THREE.Group): void {
    for (const child of [...group.children]) {
      group.remove(child);
      const obj = child as THREE.Mesh;
      obj.geometry?.dispose();
      const mat = obj.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat?.dispose();
      if (mat instanceof LineMaterial) this.lineMaterials = this.lineMaterials.filter((m) => m !== mat);
    }
  }

  /** Reconstruye malla H3, cuadrícula, rutas y nodos sobre el relieve actual. */
  private rebuildOverlay(): void {
    this.disposeGroup(this.overlay);

    // Cuadrícula de coordenadas cada 0,01° (≈ 590 m).
    const grat: number[] = [];
    const seg = (a: THREE.Vector3, b: THREE.Vector3) => grat.push(a.x, a.y, a.z, b.x, b.y, b.z);
    const steps = 40;
    for (let lat = Math.ceil(this.aoi.lat_min * 100) / 100; lat <= this.aoi.lat_max + 1e-9; lat += 0.01) {
      for (let k = 0; k < steps; k++) {
        const l0 = this.aoi.lon_e_min + ((this.aoi.lon_e_max - this.aoi.lon_e_min) * k) / steps;
        const l1 = this.aoi.lon_e_min + ((this.aoi.lon_e_max - this.aoi.lon_e_min) * (k + 1)) / steps;
        seg(this.worldOf(lat, l0, 3), this.worldOf(lat, l1, 3));
      }
    }
    for (let lon = Math.ceil(this.aoi.lon_e_min * 100) / 100; lon <= this.aoi.lon_e_max + 1e-9; lon += 0.01) {
      for (let k = 0; k < steps; k++) {
        const l0 = this.aoi.lat_min + ((this.aoi.lat_max - this.aoi.lat_min) * k) / steps;
        const l1 = this.aoi.lat_min + ((this.aoi.lat_max - this.aoi.lat_min) * (k + 1)) / steps;
        seg(this.worldOf(l0, lon, 3), this.worldOf(l1, lon, 3));
      }
    }
    const gratGeo = new THREE.BufferGeometry();
    gratGeo.setAttribute('position', new THREE.Float32BufferAttribute(grat, 3));
    this.overlay.add(
      new THREE.LineSegments(gratGeo, new THREE.LineBasicMaterial({ color: PALETTE.text, transparent: true, opacity: 0.12 }))
    );

    // Malla H3 res 9 real de P1: hexágonos con sus vértices de `h3o`.
    if (this.layers.h3o && this.hexCells.length > 0) {
      const plain: number[] = [];
      const flagged: Record<string, number[]> = { shelter: [], trap: [], isru: [] };
      for (const cell of this.hexCells) {
        const b = cell.boundary;
        if (!b || b.length < 3) continue;
        const target = cell.flags.shelter
          ? flagged.shelter
          : cell.flags.regolith_trap
            ? flagged.trap
            : cell.flags.isru_water
              ? flagged.isru
              : plain;
        const lift = target === plain ? 6 : 10;
        for (let i = 0; i < b.length; i++) {
          const p = this.worldOf(b[i][0], b[i][1], lift);
          const q = this.worldOf(b[(i + 1) % b.length][0], b[(i + 1) % b.length][1], lift);
          target.push(p.x, p.y, p.z, q.x, q.y, q.z);
        }
      }
      const add = (arr: number[], color: string, opacity: number, depthTest: boolean) => {
        if (arr.length === 0) return;
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
        const lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthTest }));
        lines.renderOrder = depthTest ? 1 : 3;
        this.overlay.add(lines);
      };
      add(plain, PALETTE.text, 0.14, true);
      add(flagged.isru, PALETTE.cyan, 1, false);
      add(flagged.trap, PALETTE.amber, 1, false);
      add(flagged.shelter, PALETTE.green, 1, false);
    }

    // Rutas pegadas al relieve; sin prueba de profundidad para que nunca queden enterradas.
    for (const route of this.routes) {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i < route.points.length; i++) {
        const a = route.points[i];
        pts.push(this.worldOf(a.lat, a.lonE, 8));
        const b = route.points[i + 1];
        // Subdivide los tramos rectos largos para que sigan el terreno.
        if (b) {
          const n = Math.min(40, Math.floor(Math.hypot((b.lat - a.lat) * M_PER_DEG_LAT, (b.lonE - a.lonE) * this.kLon) / 40));
          for (let k = 1; k < n; k++) {
            pts.push(this.worldOf(a.lat + ((b.lat - a.lat) * k) / n, a.lonE + ((b.lonE - a.lonE) * k) / n, 8));
          }
        }
      }
      if (pts.length >= 2) this.overlay.add(this.fatLine(pts, route.color, route.dashed ? 2 : route.id === 'L3' ? 5 : 3.5, route.dashed));
    }

    for (const node of this.nodes) {
      const sphere = new THREE.Mesh(
        new THREE.SphereGeometry(0.07, 20, 20),
        new THREE.MeshBasicMaterial({ color: node.color, depthTest: false })
      );
      sphere.position.copy(this.worldOf(node.lat, node.lonE, 12));
      sphere.renderOrder = 6;
      this.overlay.add(sphere);
    }
    this.invalidate();
  }

  // ------------------------------------------------------------------ API pública
  setLayers(layers: TwinLayers): void {
    const reliefChanged = layers.mola !== this.layers.mola;
    const hexChanged = layers.h3o !== this.layers.h3o;
    this.layers = { ...layers };
    if (reliefChanged) this.applyRelief();
    this.paintTerrain();
    if (reliefChanged || hexChanged) {
      this.rebuildOverlay();
      this.rebuildPoints();
    }
  }

  setHexCells(cells: HexCell[]): void {
    this.hexCells = cells;
    this.rebuildOverlay();
  }

  setRoutes(routes: RoutePath[], nodes: Array<{ lat: number; lonE: number; color: string }>): void {
    this.routes = routes;
    this.nodes = nodes;
    this.rebuildOverlay();
  }

  /**
   * Respuesta visual del Chaos Mode: `visible` trazas ámbar durante 1,2 s repartidas según el
   * recuento del motor (las que acaban seguras con refugio van a `shelter`, el resto hacia
   * `base`), y después los dos vectores: Base en rojo y refugio en verde. El motor devuelve
   * recuentos, no trayectorias: el trazo de cada pasada es ilustrativo.
   */
  playChaos(
    origin: { lat: number; lonE: number },
    base: { lat: number; lonE: number },
    shelter: { lat: number; lonE: number },
    visible: number,
    shelterShare: number
  ): void {
    this.clearChaos();
    const o = this.worldOf(origin.lat, origin.lonE, 14);
    const pb = this.worldOf(base.lat, base.lonE, 14);
    const ps = this.worldOf(shelter.lat, shelter.lonE, 14);
    const traces = new THREE.Group();
    const toShelter = Math.round(visible * shelterShare);
    for (let i = 0; i < visible; i++) {
      const end = i < toShelter ? ps : pb;
      // Abanico determinista alrededor del vector (sin azar: se repite igual cada vez).
      const spread = ((i * 0.618034) % 1) - 0.5;
      const dir = end.clone().sub(o);
      const side = new THREE.Vector3(-dir.z, 0, dir.x).normalize().multiplyScalar(spread * dir.length() * 0.35);
      const mid = o.clone().add(dir.clone().multiplyScalar(0.5)).add(side);
      mid.y = this.worldOfScene(mid).y + 0.03;
      const g = new THREE.BufferGeometry().setFromPoints(new THREE.QuadraticBezierCurve3(o, mid, end).getPoints(16));
      const line = new THREE.Line(
        g,
        new THREE.LineBasicMaterial({ color: PALETTE.amber, transparent: true, opacity: 0.55, depthTest: false })
      );
      line.renderOrder = 7;
      traces.add(line);
    }
    this.chaosGroup.add(traces);
    this.invalidate();
    this.chaosTimer = window.setTimeout(() => {
      this.chaosGroup.remove(traces);
      traces.children.forEach((c) => {
        (c as THREE.Line).geometry.dispose();
        ((c as THREE.Line).material as THREE.Material).dispose();
      });
      this.chaosGroup.add(this.fatLine([o, pb], PALETTE.red, 5, true));
      this.chaosGroup.add(this.fatLine([o, ps], PALETTE.green, 6));
      this.invalidate();
    }, 1200);
  }

  clearChaos(): void {
    window.clearTimeout(this.chaosTimer);
    this.disposeGroup(this.chaosGroup);
    this.invalidate();
  }

  private worldOfScene(p: THREE.Vector3): THREE.Vector3 {
    const g = this.geoOf(p);
    return this.worldOf(g.lat, g.lonE);
  }

  /** Punto del terreno bajo un píxel del contenedor, o `null` si el rayo no toca el terreno. */
  raycast(x: number, y: number): RayHit | null {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.raycaster.setFromCamera(new THREE.Vector2((x / w) * 2 - 1, -(y / h) * 2 + 1), this.camera);
    const hits = this.raycaster.intersectObject(this.terrainMesh, false);
    if (hits.length === 0) return null;
    const p = hits[0].point;
    const g = this.geoOf(p);
    const dist = this.camera.position.distanceTo(p);
    const mPerPx = ((2 * dist * Math.tan((this.camera.fov * Math.PI) / 360)) / h) * SCENE_M;
    return { lat: g.lat, lonE: g.lonE, world: p.clone(), mPerPx };
  }

  /** Píxel del contenedor donde cae un punto de la escena. */
  project(world: THREE.Vector3): { x: number; y: number; visible: boolean } {
    const v = world.clone().project(this.camera);
    return {
      x: (v.x * 0.5 + 0.5) * (this.container.clientWidth || 1),
      y: (-v.y * 0.5 + 0.5) * (this.container.clientHeight || 1),
      visible: v.z > -1 && v.z < 1,
    };
  }

  cameraInfo(): { azimuthDeg: number; elevationDeg: number; mPerPx: number } {
    const off = this.camera.position.clone().sub(this.controls.target);
    // Rumbo hacia el que mira la cámara (0° = norte, −z de la escena).
    const azimuth = ((Math.atan2(-off.x, off.z) * 180) / Math.PI + 360) % 360;
    const elevation = (Math.asin(off.y / off.length()) * 180) / Math.PI;
    const h = this.container.clientHeight || 1;
    const mPerPx = ((2 * off.length() * Math.tan((this.camera.fov * Math.PI) / 360)) / h) * SCENE_M;
    return { azimuthDeg: azimuth, elevationDeg: elevation, mPerPx };
  }

  zoom(factor: number): void {
    const off = this.camera.position.clone().sub(this.controls.target);
    const len = Math.min(this.controls.maxDistance, Math.max(this.controls.minDistance, off.length() * factor));
    this.camera.position.copy(this.controls.target).add(off.setLength(len));
    this.controls.update();
    this.invalidate();
  }

  orbit(dAzimuthDeg: number, dPolarDeg: number): void {
    const off = this.camera.position.clone().sub(this.controls.target);
    const sph = new THREE.Spherical().setFromVector3(off);
    sph.theta += (dAzimuthDeg * Math.PI) / 180;
    sph.phi = Math.min(this.controls.maxPolarAngle, Math.max(0.08, sph.phi + (dPolarDeg * Math.PI) / 180));
    this.camera.position.copy(this.controls.target).add(new THREE.Vector3().setFromSpherical(sph));
    this.controls.update();
    this.invalidate();
  }

  resetView(): void {
    const t = this.terrain;
    const midY = t ? this.sceneY((t.elev_min_m + t.elev_max_m) / 2) * 0.5 : 0;
    this.controls.target.set(0, midY, 0);
    // Vista desde el sur con el norte arriba, como en el wireframe.
    this.camera.position.set(0.3, 7.4, 5.0);
    this.controls.update();
    this.invalidate();
  }

  invalidate(): void {
    this.dirty = true;
  }

  private resize(): void {
    if (this.disposed) return;
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w === 0 || h === 0) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    for (const m of this.lineMaterials) m.resolution.set(w, h);
    this.invalidate();
  }

  // Solo se pinta cuando algo cambia (cámara, capas, datos): no hay repintado a 60 Hz en reposo.
  private loop = (): void => {
    if (this.disposed) return;
    if (this.dirty) {
      this.dirty = false;
      this.renderer.render(this.scene, this.camera);
      this.onFrame?.();
    }
    this.frame = requestAnimationFrame(this.loop);
  };

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    window.clearTimeout(this.chaosTimer);
    this.resizeObs.disconnect();
    this.controls.dispose();
    this.disposeGroup(this.overlay);
    this.disposeGroup(this.chaosGroup);
    this.disposeGroup(this.pointsGroup);
    this.terrainGeo.dispose();
    this.layerGeo.dispose();
    (this.layerMesh.material as THREE.Material).dispose();
    this.baseMaterial.dispose();
    this.orthoMaterial?.map?.dispose();
    this.orthoMaterial?.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}
