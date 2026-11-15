// Único sitio donde viven los colores de estado de la interfaz.
//
// Los cuatro tonos de estado son los de los documentos de UX (`Reconnaissance…md` §2.1 y
// `helmet-vision.md`): se usan tal cual en el sendero del visor y en los estados de la consola.
import type { GuardrailState, Tone } from '@/types/mission';
import type { Level } from '@/engine/thresholds';

/** Paleta de UX (vigente). */
export const AR_PATH = {
  nominal: '#00F5D4',
  caution: '#FFE600',
  evac: '#FF1744',
  shelter: '#00FFA3',
} as const;

export const PALETTE = {
  cyan: AR_PATH.nominal,
  green: AR_PATH.shelter,
  amber: AR_PATH.caution,
  red: AR_PATH.evac,
  /** Acento único de la consola (arena de Marte): acción principal y selección. No es un estado. */
  accent: '#E2B488',
  deepBlue: '#0077B6',
  ground: '#0B0E14',
  ink: '#0B0E14',
  panel: '#11151C',
  border: '#222935',
  borderStrong: '#364050',
  text: '#E9EBEE',
  text2: '#B4BBC6',
  muted: '#8A93A1',
  /** Rojo de los botones de peligro: 5,3:1 con texto blanco. */
  dangerStrong: '#D4103A',
} as const;

/** Tonos del terreno y de las luces del gemelo 3D (ocres de Marte, sin estado). */
export const TERRAIN = {
  low: '#4A3A33',
  high: '#B89678',
  ambientLight: '#B8C4D8',
  sunLight: '#FFE2C4',
} as const;

export interface StateStyle {
  code: string;
  label: string;
  short: string;
  color: string;
  pulse: boolean;
}

export const STATE_STYLE: Record<GuardrailState, StateStyle> = {
  PRE_EVA: { code: 'PRE-EVA', label: 'Before departure', short: 'Before departure', color: PALETTE.muted, pulse: false },
  // El color es el del sendero del visor (cian de los documentos de UX); la cabecera pinta su punto en verde.
  NOMINAL: { code: '0x01', label: 'Nominal', short: 'Nominal', color: AR_PATH.nominal, pulse: false },
  CAUTION: { code: '0x02', label: 'Caution', short: 'Caution', color: AR_PATH.caution, pulse: false },
  MULTI_HAZARD: { code: '0x03', label: 'Multiple hazards at once', short: 'Multiple hazards', color: AR_PATH.caution, pulse: true },
  EVAC_SHELTER: { code: '0x04', label: 'Evacuate to shelter WP3', short: 'Evacuation', color: AR_PATH.evac, pulse: true },
  SHELTER_HOLD: { code: '0x05', label: 'Safe in shelter WP3', short: 'In shelter', color: AR_PATH.shelter, pulse: false },
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
