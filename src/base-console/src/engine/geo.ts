// Utilidades geográficas compartidas por el gemelo 3D, el planificador y el HUD.
import type { TerrainGrid } from '@/types/mission';

/** Radio de Marte del CRS IAU_2015:49900 (esfera), m. */
export const MARS_RADIUS_M = 3396190;
export const M_PER_DEG_LAT = (Math.PI / 180) * MARS_RADIUS_M;

export function mPerDegLon(latDeg: number): number {
  return M_PER_DEG_LAT * Math.cos((latDeg * Math.PI) / 180);
}

export function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * MARS_RADIUS_M * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export function compassPoint(deg: number): string {
  return COMPASS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
}

/** Índice de fila y columna (fraccionarios) de un punto en la malla regular del terreno. */
export function terrainRowCol(t: TerrainGrid, lat: number, lonE: number): { r: number; c: number } {
  return {
    r: ((t.aoi.lat_max - lat) / (t.aoi.lat_max - t.aoi.lat_min)) * (t.rows - 1),
    c: ((lonE - t.aoi.lon_e_min) / (t.aoi.lon_e_max - t.aoi.lon_e_min)) * (t.cols - 1),
  };
}

export function insideAoi(t: TerrainGrid, lat: number, lonE: number): boolean {
  return lat >= t.aoi.lat_min && lat <= t.aoi.lat_max && lonE >= t.aoi.lon_e_min && lonE <= t.aoi.lon_e_max;
}

/** Cota del terreno por interpolación bilineal (solo para dibujar; los datos no se interpolan). */
export function terrainElevation(t: TerrainGrid, lat: number, lonE: number): number | null {
  const { r, c } = terrainRowCol(t, lat, lonE);
  if (r < 0 || c < 0 || r > t.rows - 1 || c > t.cols - 1) return null;
  const r0 = Math.min(t.rows - 2, Math.floor(r));
  const c0 = Math.min(t.cols - 2, Math.floor(c));
  const fr = r - r0;
  const fc = c - c0;
  const at = (rr: number, cc: number) => t.elev_m[rr * t.cols + cc];
  const corners = [at(r0, c0), at(r0, c0 + 1), at(r0 + 1, c0), at(r0 + 1, c0 + 1)];
  if (corners.some((v) => v === null)) {
    return corners.find((v): v is number => v !== null) ?? null;
  }
  const [a, b, d, e] = corners as number[];
  return a * (1 - fr) * (1 - fc) + b * (1 - fr) * fc + d * fr * (1 - fc) + e * fr * fc;
}

/**
 * Sombreado del relieve real (DTM CTX 20 m agregado a la malla H3) como imagen, para usarlo
 * de fondo georreferenciado en el mapa del HUD. Devuelve una URL `data:`.
 */
export function hillshadeDataUrl(t: TerrainGrid): string {
  const canvas = document.createElement('canvas');
  canvas.width = t.cols;
  canvas.height = t.rows;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  const img = ctx.createImageData(t.cols, t.rows);
  const cell = t.spacing_m;
  // Sol al noroeste, 45° de altura (convención cartográfica).
  const az = (315 * Math.PI) / 180;
  const alt = (45 * Math.PI) / 180;
  const lx = Math.sin(az) * Math.cos(alt);
  const ly = Math.cos(az) * Math.cos(alt);
  const lz = Math.sin(alt);
  const span = Math.max(1, t.elev_max_m - t.elev_min_m);
  for (let r = 0; r < t.rows; r++) {
    for (let c = 0; c < t.cols; c++) {
      const i = r * t.cols + c;
      const z = t.elev_m[i];
      const o = i * 4;
      if (z === null) {
        img.data[o + 3] = 0;
        continue;
      }
      const zl = t.elev_m[r * t.cols + Math.max(0, c - 1)] ?? z;
      const zr = t.elev_m[r * t.cols + Math.min(t.cols - 1, c + 1)] ?? z;
      const zu = t.elev_m[Math.max(0, r - 1) * t.cols + c] ?? z;
      const zd = t.elev_m[Math.min(t.rows - 1, r + 1) * t.cols + c] ?? z;
      const dzdx = (zr - zl) / (2 * cell);
      const dzdy = (zu - zd) / (2 * cell);
      const len = Math.hypot(dzdx, dzdy, 1);
      const shade = Math.max(0, (-dzdx * lx - dzdy * ly + lz) / len);
      const h = (z - t.elev_min_m) / span;
      const base = 40 + shade * 150;
      img.data[o] = Math.min(255, base * (0.95 + 0.25 * h));
      img.data[o + 1] = Math.min(255, base * (0.78 + 0.12 * h));
      img.data[o + 2] = Math.min(255, base * (0.66 + 0.05 * h));
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL('image/png');
}

const NUM_WORDS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty',
];
/** Número en palabras para la voz (0–20; el resto, en cifras). */
export function numberWord(n: number): string {
  return NUM_WORDS[n] ?? String(n);
}
/** Minutes spoken aloud: "one minute", "nine minutes". */
export function minutesWords(n: number): string {
  const m = Math.max(1, Math.round(n));
  return m === 1 ? 'one minute' : `${numberWord(m)} minutes`;
}
/** Bearing spoken digit by digit, as in aviation phraseology: 344 -> "three four four". */
export function bearingWords(deg: number): string {
  return String(Math.round(deg)).padStart(3, '0').split('').map((d) => NUM_WORDS[Number(d)]).join(' ');
}

/** Number in English format (decimal point, thousands comma) with a typographic minus (−), as in "T−45". */
export function fmt(value: number | null | undefined, decimals = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
    .format(value)
    .replace('-', '−');
}

/** Coordinates, same format across the console: "9.8965° S, 283.3892° E". */
export function fmtCoords(lat: number, lonE: number, decimals = 4): string {
  return `${fmt(Math.abs(lat), decimals)}° ${lat < 0 ? 'S' : 'N'}, ${fmt(lonE, decimals)}° E`;
}

/** Nombre de un nodo tal como se escribe en pantalla: «Base», «WP1», «WP2», «WP3». */
export function nodeLabel(id: string): string {
  return id.toUpperCase() === 'BASE' ? 'Base' : id;
}
