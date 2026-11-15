// Puntos que marca la astronauta (ISRU, PELIGRO, REFUGIO). Viven en el motor Rust
// (`/api/points`); aquí solo hay una copia compartida por las tres pantallas, que se sincroniza
// al marcar o borrar y con un sondeo corto (por si otra pestaña o el traje los cambian).
import { useSyncExternalStore } from 'react';
import { deletePoints, fetchPoints, postPoint } from '@/engine/apiClient';
import type { HazardModel, ReportedKind, ReportedPoint } from '@/types/mission';

export interface PointsSnapshot {
  /** Versión del motor; -1 mientras no se ha leído nunca. */
  version: number;
  points: ReportedPoint[];
  hazardModel: HazardModel | null;
  /** El último sondeo respondió. */
  online: boolean;
}

const POLL_MS = 3000;
let snap: PointsSnapshot = { version: -1, points: [], hazardModel: null, online: false };
const listeners = new Set<() => void>();
let timer = 0;

function emit(next: PointsSnapshot): void {
  snap = next;
  listeners.forEach((l) => l());
}

export async function syncPoints(): Promise<void> {
  try {
    const r = await fetchPoints();
    if (r.points_version !== snap.version || !snap.online) {
      emit({ version: r.points_version, points: r.points, hazardModel: r.hazard_model, online: true });
    }
  } catch {
    if (snap.online) emit({ ...snap, online: false });
  }
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  if (listeners.size === 1) {
    void syncPoints();
    timer = window.setInterval(() => void syncPoints(), POLL_MS);
  }
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0) window.clearInterval(timer);
  };
}

export function usePoints(): PointsSnapshot {
  return useSyncExternalStore(subscribe, () => snap);
}

export async function addPoint(kind: ReportedKind, lat: number, lonE: number, tMin: number | null): Promise<ReportedPoint> {
  const r = await postPoint(kind, lat, lonE, tMin);
  await syncPoints();
  return r.point;
}

export async function removePoint(id: number): Promise<void> {
  await deletePoints(id);
  await syncPoints();
}

export async function clearPoints(): Promise<void> {
  await deletePoints();
  await syncPoints();
}

export const POINT_KIND_NAME: Record<ReportedKind, string> = { ISRU: 'ISRU', PELIGRO: 'peligro', REFUGIO: 'refugio' };
