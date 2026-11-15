// Único sitio donde viven los colores de estado de la interfaz.
//
// DECISIÓN PENDIENTE DE CONFIRMAR (H-27): `src/shared/README.md` §4 y los documentos de UX
// dan dos paletas distintas para el sendero AR. Se aplica la regla de precedencia de la
// validación (estructura, elementos y textos: mandan los documentos de UX), así que se usa la
// paleta de `Reconnaissance…md` §2.1 / `helmet-vision.md`. Para cambiar a la de
// `src/shared/README.md` basta con sustituir `AR_PATH` por `AR_PATH_SHARED_README`.
import type { GuardrailState, Tone } from '@/types/mission';
import type { Level } from '@/engine/thresholds';

/** Paleta de UX (vigente). */
export const AR_PATH = {
  nominal: '#00F5D4',
  caution: '#FFE600',
  evac: '#FF1744',
  shelter: '#00FFA3',
} as const;

/** Paleta alternativa de `src/shared/README.md` §4 (la que emite el motor Rust). No se usa. */
export const AR_PATH_SHARED_README = {
  nominal: '#00F0FF',
  caution: '#FFB000',
  evac: '#FF2A2A',
  shelter: '#00E676',
} as const;

export const PALETTE = {
  cyan: AR_PATH.nominal,
  green: AR_PATH.shelter,
  amber: AR_PATH.caution,
  red: AR_PATH.evac,
  /** Acento único de la consola (arena de Marte): acción principal y selección. No es un estado. */
  accent: '#E2B488',
  /** @deprecated usar `accent`. */
  orange: '#E2B488',
  deepBlue: '#0077B6',
  ground: '#0B0E14',
  ink: '#0B0E14',
  panel: '#11151C',
  border: '#222935',
  borderStrong: '#364050',
  text: '#E9EBEE',
  text2: '#B4BBC6',
  muted: '#8A93A1',
} as const;

export interface StateStyle {
  code: string;
  label: string;
  short: string;
  color: string;
  pulse: boolean;
}

export const STATE_STYLE: Record<GuardrailState, StateStyle> = {
  PRE_EVA: { code: 'PRE-EVA', label: 'Antes de la salida', short: 'Antes de la salida', color: PALETTE.muted, pulse: false },
  // El color es el del sendero del visor (cian de los documentos de UX); la cabecera pinta su punto en verde.
  NOMINAL: { code: '0x01', label: 'Nominal', short: 'Nominal', color: AR_PATH.nominal, pulse: false },
  CAUTION: { code: '0x02', label: 'Precaución', short: 'Precaución', color: AR_PATH.caution, pulse: false },
  MULTI_HAZARD: { code: '0x03', label: 'Varias amenazas a la vez', short: 'Varias amenazas', color: AR_PATH.caution, pulse: true },
  EVAC_SHELTER: { code: '0x04', label: 'Evacuar al refugio WP3', short: 'Evacuación', color: AR_PATH.evac, pulse: true },
  SHELTER_HOLD: { code: '0x05', label: 'A salvo en el refugio WP3', short: 'En el refugio', color: AR_PATH.shelter, pulse: false },
};

export const LEVEL_COLOR: Record<Level, string> = {
  green: PALETTE.green,
  amber: PALETTE.amber,
  red: PALETTE.red,
  none: '#B4BBC6',
};

export const TONE_COLOR: Record<Tone, string> = {
  cyan: PALETTE.cyan,
  green: PALETTE.green,
  amber: PALETTE.amber,
  red: PALETTE.red,
};

export const RADIO_CLASS_LEVEL: Record<string, Level> = {
  VERDE: 'green',
  AMBAR: 'amber',
  ROJO: 'red',
};

export const NODE_COLOR: Record<string, string> = {
  BASE: '#E9EBEE',
  WP1: PALETTE.cyan,
  WP2: PALETTE.amber,
  WP3: PALETTE.green,
};

/** Publica la paleta como variables CSS para que `index.css` no repita ningún color. */
export function applyThemeVars(): void {
  const root = document.documentElement.style;
  root.setProperty('--ar-nominal', AR_PATH.nominal);
  root.setProperty('--ar-caution', AR_PATH.caution);
  root.setProperty('--ar-evac', AR_PATH.evac);
  root.setProperty('--ar-shelter', AR_PATH.shelter);
}
