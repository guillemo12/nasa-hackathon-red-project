export type MarsTrekLayerId = 'viking' | 'mola' | 'rover';

export const MARS_TREK_LAYERS: Record<
  MarsTrekLayerId,
  { label: string; trekLayer?: string; attribution: string }
> = {
  viking: {
    label: 'VIKING 232m',
    trekLayer: 'Mars_Viking_MDIM21_ClrMosaic_global_232m',
    attribution: 'NASA JPL Mars Trek · Viking MDIM 2.1',
  },
  mola: {
    label: 'MOLA 463m',
    trekLayer: 'Mars_MGS_MOLA_ClrShade_merge_global_463m',
    attribution: 'NASA JPL Mars Trek · MGS MOLA Hillshade',
  },
  rover: {
    label: 'ROVER CAM',
    attribution: 'NASA Mars 2020 Perseverance Raw',
  },
};

export const TILE_SIZE = 256;

// Melas Chasma SW Basin center (canonical R.E.D. ATLAS site)
export const MELAS_CENTER = { lat: -9.915, lonE: 283.391 };

export function lonETo180(lonE: number): number {
  const norm = ((lonE % 360) + 360) % 360;
  return norm > 180 ? norm - 360 : norm;
}

/**
 * Equirectangular WMTS pixel coordinates in Mars Trek's default028mm grid:
 * cols = 2^(z+1), rows = 2^z, each tile 256x256.
 */
export function latLonToWorldPx(lat: number, lonE: number, z: number): { x: number; y: number } {
  const cols = Math.pow(2, z + 1);
  const rows = Math.pow(2, z);
  const lon180 = lonETo180(lonE);
  const x = ((lon180 + 180) / 360) * cols * TILE_SIZE;
  const y = ((90 - lat) / 180) * rows * TILE_SIZE;
  return { x, y };
}

export function worldPxToLatLon(wx: number, wy: number, z: number): { lat: number; lonE: number } {
  const cols = Math.pow(2, z + 1);
  const rows = Math.pow(2, z);
  const lon180 = (wx / (cols * TILE_SIZE)) * 360 - 180;
  const lat = 90 - (wy / (rows * TILE_SIZE)) * 180;
  const lonE = ((lon180 % 360) + 360) % 360;
  return {
    lat: Math.max(-89.9, Math.min(89.9, lat)),
    lonE,
  };
}

export function haversineMarsKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R_MARS_KM = 3389.5;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_MARS_KM * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function getTrekTileUrl(layer: 'viking' | 'mola', z: number, tx: number, ty: number): string {
  const trekLayer = MARS_TREK_LAYERS[layer].trekLayer;
  return `/mars-trek/${trekLayer}/1.0.0/default/default028mm/${z}/${ty}/${tx}.jpg`;
}
