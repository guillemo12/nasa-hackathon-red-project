// Cliente de la API Rust (`src/core-engine/src/bin/api_server.rs`, proxy `/api`).
// Ninguna función inventa un éxito: si la API no responde devuelve `null` o lanza `ApiError`,
// y quien la llama decide qué enseñar.
import type {
  ChaosRun,
  Eva07Sample,
  HexCell,
  RoutePlan,
  SpyglassResult,
  TerrainGrid,
} from '@/types/mission';

export interface ApiHealth {
  status: string;
  engine: string;
  h3_res: number;
  h3_cells_loaded: number;
  h3_res12_cells: number;
  events: number;
  route_plan_ready: boolean;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status?: number
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function getJson<T>(url: string, timeoutMs = 8000, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok) throw new ApiError(`HTTP ${res.status}`, res.status);
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError('API Rust no disponible');
  } finally {
    window.clearTimeout(timer);
  }
}

export async function fetchApiHealth(): Promise<ApiHealth | null> {
  try {
    return await getJson<ApiHealth>('/api/health', 2500);
  } catch {
    return null;
  }
}

export async function fetchEva07Sample(tMin: number): Promise<Eva07Sample | null> {
  try {
    return await getJson<Eva07Sample>(`/api/eva07?t=${encodeURIComponent(tMin)}`, 2500);
  } catch {
    return null;
  }
}

/** Chaos Mode del motor Rust. Lanza `ApiError` si la API no responde. */
export async function fetchChaosMode(seed: number, trials: number): Promise<ChaosRun> {
  return getJson<ChaosRun>(`/api/chaos-mode?seed=${seed}&trials=${trials}`, 30000);
}

let terrainPromise: Promise<TerrainGrid> | null = null;
export function fetchTerrain(): Promise<TerrainGrid> {
  if (!terrainPromise) {
    terrainPromise = getJson<TerrainGrid>('/api/terrain', 15000).catch((err) => {
      terrainPromise = null;
      throw err;
    });
  }
  return terrainPromise;
}

let hexGridPromise: Promise<HexCell[]> | null = null;
export function fetchHexGrid(): Promise<HexCell[]> {
  if (!hexGridPromise) {
    hexGridPromise = getJson<{ cells: HexCell[] }>('/api/hexgrid', 15000)
      .then((d) => d.cells)
      .catch((err) => {
        hexGridPromise = null;
        throw err;
      });
  }
  return hexGridPromise;
}

let routePlanPromise: Promise<RoutePlan> | null = null;
/** Plan D* Lite por tramo. El motor tarda unos segundos al arrancar: reintenta si aún calcula. */
export function fetchRoutePlan(): Promise<RoutePlan> {
  if (!routePlanPromise) {
    routePlanPromise = (async () => {
      for (let attempt = 0; attempt < 8; attempt++) {
        try {
          return await getJson<RoutePlan>('/api/route-plan', 15000);
        } catch (err) {
          if (!(err instanceof ApiError) || err.status !== 503) throw err;
          await new Promise((r) => window.setTimeout(r, 1500));
        }
      }
      throw new ApiError('El plan de ruta sigue calculándose');
    })().catch((err) => {
      routePlanPromise = null;
      throw err;
    });
  }
  return routePlanPromise;
}

export async function fetchSpyglass(
  lat: number,
  lonE: number,
  radiusM: number
): Promise<SpyglassResult | 'outside' | null> {
  try {
    return await getJson<SpyglassResult>(
      `/api/spyglass?lat=${lat.toFixed(6)}&lon=${lonE.toFixed(6)}&radius_m=${radiusM.toFixed(0)}`,
      4000
    );
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return 'outside';
    return null;
  }
}

export async function fetchEnrichedGeoJson(): Promise<unknown> {
  return getJson<unknown>('/api/geojson', 8000);
}

export interface ZenohSyncResult {
  synced: boolean;
  simulated: boolean;
  checksum: string;
  checksum_algo: string;
  bundle_bytes: number;
  cells_synced: number;
  h3_res: number;
}

/** Sincronización del paquete pre-EVA. Lanza `ApiError` si la API no responde. */
export async function postZenohSync(): Promise<ZenohSyncResult> {
  return getJson<ZenohSyncResult>('/api/zenoh-sync', 8000, { method: 'POST' });
}
