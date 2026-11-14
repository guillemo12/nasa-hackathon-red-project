import type { ChaosRunResult, Eva07Event } from '@/types/mission';
import { getNearestEvaEvent } from '@/data/missionData';
import { runChaosModeMonteCarlo } from '@/engine/p3Bridge';

export interface ApiHealth {
  status: string;
  engine: string;
  h3_res: number;
  h3_cells_loaded: number;
  corridor_sample_cells: number;
}

interface RustChaosReport {
  trials: number;
  survived_with_wp3_shelter: number;
  survived_base_only: number;
  survival_rate_with_shelter_pct: number;
  survival_rate_base_only_pct: number;
  multi_hazard_events_triggered: number;
}

export async function fetchApiHealth(): Promise<ApiHealth | null> {
  try {
    const res = await fetch('/api/health');
    if (!res.ok) return null;
    return (await res.json()) as ApiHealth;
  } catch {
    return null;
  }
}

export async function fetchEva07Event(tMin: number): Promise<{ event: Eva07Event; fromApi: boolean }> {
  try {
    const res = await fetch(`/api/eva07?t=${encodeURIComponent(tMin)}`);
    if (!res.ok) throw new Error('HTTP error');
    const event = (await res.json()) as Eva07Event;
    return { event, fromApi: true };
  } catch {
    return { event: getNearestEvaEvent(tMin), fromApi: false };
  }
}

export async function fetchChaosMode(
  seed: number,
  trials = 100
): Promise<{ result: ChaosRunResult; fromApi: boolean }> {
  try {
    const res = await fetch(`/api/chaos-mode?seed=${seed}&trials=${trials}`);
    if (!res.ok) throw new Error('HTTP error');
    const report = (await res.json()) as RustChaosReport;
    const localBase = runChaosModeMonteCarlo(seed, trials);
    return {
      fromApi: true,
      result: {
        ...localBase,
        seed,
        totalRuns: report.trials,
        wp3Survivals: report.survived_with_wp3_shelter,
        baseSurvivals: report.survived_base_only,
        wp3SurvivalPct: Number(report.survival_rate_with_shelter_pct.toFixed(1)),
        baseSurvivalPct: Number(report.survival_rate_base_only_pct.toFixed(1)),
      },
    };
  } catch {
    return { result: runChaosModeMonteCarlo(seed, trials), fromApi: false };
  }
}

export interface MarsRawImage {
  imageid: string;
  sol: number;
  instrument: string;
  proxyUrl: string;
  originalUrl: string;
  title: string;
  dateTakenMars: string;
  dateTakenUtc: string;
  mastAz: string;
  mastEl: string;
  site: number;
  drive: number;
  credit: string;
  link: string;
}

export async function fetchMars2020RawImages(limit = 8): Promise<MarsRawImage[]> {
  try {
    const res = await fetch(
      `/nasa-rss?feed=raw_images&category=mars2020&feedtype=json&ver=1.2&num=${limit}&page=0&search=MCZ_RIGHT`
    );
    if (!res.ok) return [];
    const data = (await res.json()) as {
      images?: Array<{
        imageid: string;
        sol: number;
        title?: string;
        date_taken_mars?: string;
        date_taken_utc?: string;
        site?: number;
        drive?: number;
        credit?: string;
        link?: string;
        extended?: { mastAz?: string; mastEl?: string };
        camera?: { instrument?: string };
        image_files?: { medium?: string; large?: string };
      }>;
    };
    return (data.images ?? [])
      .map((img) => {
        const orig = img.image_files?.medium || img.image_files?.large || '';
        const proxyUrl = orig.replace('https://mars.nasa.gov/mars2020-raw-images', '/nasa-raw-img');
        return {
          imageid: img.imageid,
          sol: img.sol,
          instrument: img.camera?.instrument || 'MCZ_RIGHT',
          proxyUrl,
          originalUrl: orig,
          title: img.title || `Mars 2020 Sol ${img.sol}`,
          dateTakenMars: img.date_taken_mars || `Sol-${img.sol}`,
          dateTakenUtc: img.date_taken_utc || '',
          mastAz: img.extended?.mastAz || '0.0',
          mastEl: img.extended?.mastEl || '0.0',
          site: img.site ?? 0,
          drive: img.drive ?? 0,
          credit: img.credit || 'NASA/JPL-Caltech/ASU',
          link: img.link || 'https://mars.nasa.gov/mars2020/multimedia/raw-images/',
        };
      })
      .filter((x) => Boolean(x.proxyUrl));
  } catch {
    return [];
  }
}

export interface HexCellPoint {
  h3_hex: string;
  lat: number;
  lon_e: number;
  elev_m: number;
  slope_deg: number;
  thermal_inertia_tiu: number;
  isru_h2o_pct: number;
  sky_view_factor: number;
  los_base_rssi_dbm: number;
}

export async function fetchHexGrid(): Promise<HexCellPoint[]> {
  try {
    const res = await fetch('/api/hexgrid');
    if (!res.ok) return [];
    return (await res.json()) as HexCellPoint[];
  } catch {
    return [];
  }
}

export async function postZenohSync(): Promise<{ synced: boolean; checksum: string; cellsSynced: number }> {
  try {
    const res = await fetch('/api/zenoh-sync', { method: 'POST' });
    if (!res.ok) throw new Error('HTTP error');
    const data = (await res.json()) as {
      synced: boolean;
      checksum: string;
      cells_synced: number;
    };
    return {
      synced: data.synced,
      checksum: data.checksum,
      cellsSynced: data.cells_synced,
    };
  } catch {
    return { synced: true, checksum: '0xLOCAL', cellsSynced: 0 };
  }
}
