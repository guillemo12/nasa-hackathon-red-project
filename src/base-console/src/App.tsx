import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ConsoleShell, type ToastMessage } from '@/components/ConsoleShell';
import { Console3DView } from '@/components/Console3DView';
import { RoutePlannerView } from '@/components/RoutePlannerView';
import { EvaHudView } from '@/components/EvaHudView';
import { CHAOS_REFERENCE, T_DECISION_MIN, T_END_MIN, T_START_MIN } from '@/data/missionData';
import {
  ApiError,
  fetchApiHealth,
  fetchChaosMode,
  fetchEva07Sample,
  postZenohSync,
  type ApiHealth,
} from '@/engine/apiClient';
import { isCertified } from '@/engine/chaos';
import { sampleEva07Local } from '@/engine/evaModel';
import { usePoints } from '@/engine/reportedPoints';
import type { ChaosState, ConsoleView, Eva07Sample, SyncState, Tone } from '@/types/mission';

const VIEW_TO_PATH: Record<ConsoleView, string> = {
  '3d-console': '/cartografia-3d',
  'route-planificator': '/planificador',
  'eva-hud-nominal': '/telemetria-eva',
  'eva-emergency': '/multiemergencia',
};

function pathToView(pathname: string): ConsoleView {
  const clean = pathname.replace(/\/+$/, '') || '/';
  switch (clean) {
    case '/planificador':
      return 'route-planificator';
    case '/telemetria-eva':
      return 'eva-hud-nominal';
    case '/multiemergencia':
      return 'eva-emergency';
    case '/cartografia-3d':
    default:
      return '3d-console';
  }
}

/** Minuto con el que arranca cada pantalla al cargarla directamente por su URL. */
function initialTime(view: ConsoleView): number {
  if (view === 'eva-emergency') return T_DECISION_MIN;
  // Primer hito con la astronauta fuera: llegada a WP1. Las pantallas de consola son pre-EVA.
  if (view === 'eva-hud-nominal') return 28;
  return T_START_MIN;
}

/** Minutos de misión que avanza el reloj por segundo cuando está EN VIVO. */
const LIVE_MIN_PER_S = 1;
const LIVE_TICK_MS = 500;
const HEALTH_POLL_ONLINE_MS = 15000;
/** Con la API caída los reintentos se espacian: 5, 10, 20 y 30 s. */
const HEALTH_POLL_OFFLINE_MS = [5000, 10000, 20000, 30000];
const TOAST_MS = 7000;
/** Tiempo mínimo que se enseña «en curso» para que la operación se perciba. */
const MIN_BUSY_MS = 700;

const wait = (ms: number) => new Promise((r) => window.setTimeout(r, ms));

export function App() {
  const [activeView, setActiveView] = useState<ConsoleView>(() => pathToView(window.location.pathname));
  const [tMin, setTMin] = useState<number>(() => initialTime(pathToView(window.location.pathname)));
  // El reloj arranca parado: nada cambia en pantalla sin que el operador lo pida (H-12).
  const [isLive, setIsLive] = useState(false);
  const [apiHealth, setApiHealth] = useState<ApiHealth | null>(null);
  const [apiChecked, setApiChecked] = useState(false);
  const [apiSample, setApiSample] = useState<Eva07Sample | null>(null);
  const [sync, setSync] = useState<SyncState>({ status: 'idle' });
  const [chaos, setChaos] = useState<ChaosState>({ status: 'idle', run: null });
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const toastId = useRef(0);

  const apiOnline = apiHealth !== null;

  const notify = useCallback((title: string, detail?: string, tone: Tone = 'cyan') => {
    toastId.current += 1;
    setToast({ id: toastId.current, title, detail, tone });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), TOAST_MS);
    return () => window.clearTimeout(id);
  }, [toast]);

  // Estado de la API: se vuelve a consultar siempre, más a menudo mientras está caída (H-22).
  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    let failures = 0;
    const poll = async () => {
      const health = await fetchApiHealth();
      if (cancelled) return;
      setApiHealth(health);
      setApiChecked(true);
      failures = health ? 0 : failures + 1;
      const offlineDelay = HEALTH_POLL_OFFLINE_MS[Math.min(failures, HEALTH_POLL_OFFLINE_MS.length) - 1];
      timer = window.setTimeout(poll, health ? HEALTH_POLL_ONLINE_MS : offlineDelay);
    };
    void poll();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    const onPopState = () => {
      const next = pathToView(window.location.pathname);
      setActiveView(next);
      if (next === 'eva-emergency') {
        setIsLive(false);
        setTMin(T_DECISION_MIN);
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // Reloj EN VIVO: avanza hasta el final de la cronología y se para (no vuelve a empezar solo).
  useEffect(() => {
    if (!isLive) return;
    const id = window.setInterval(() => {
      setTMin((prev) =>
        Math.min(T_END_MIN, Number((prev + (LIVE_MIN_PER_S * LIVE_TICK_MS) / 1000).toFixed(2)))
      );
    }, LIVE_TICK_MS);
    return () => window.clearInterval(id);
  }, [isLive]);
  useEffect(() => {
    if (isLive && tMin >= T_END_MIN) setIsLive(false);
  }, [isLive, tMin]);

  // El modelo local responde al instante; si la API está arriba, su muestra (con el estado del
  // motor Rust) sustituye a la local cuando llega. Sin API no se lanza ninguna petición.
  const localSample = useMemo(() => sampleEva07Local(tMin), [tMin]);
  // La API coloca a la astronauta sobre la ruta vigente: si la astronauta marca un peligro y el
  // motor replanifica, la muestra del mismo minuto se vuelve a pedir.
  const pointsVersion = usePoints().version;
  useEffect(() => {
    if (!apiOnline) {
      setApiSample(null);
      return;
    }
    let active = true;
    void fetchEva07Sample(tMin).then((s) => {
      if (!active) return;
      if (s) setApiSample(s);
      else {
        setApiSample(null);
        setApiHealth(null);
      }
    });
    return () => {
      active = false;
    };
  }, [tMin, apiOnline, pointsVersion]);

  const sample: Eva07Sample =
    apiSample && Math.abs(apiSample.t_min - localSample.t_min) < 0.005 ? apiSample : localSample;

  const certified = isCertified(chaos);

  const handleSync = useCallback(async () => {
    if (sync.status === 'syncing') return;
    setSync({ status: 'syncing' });
    try {
      const [res] = await Promise.all([postZenohSync(), wait(MIN_BUSY_MS)]);
      setSync({
        status: 'ok',
        checksum: res.checksum,
        cells: res.cells_synced,
        bytes: res.bundle_bytes,
        simulated: res.simulated,
      });
      notify(
        res.simulated ? 'Route ready for the suit (simulated link)' : 'Route sent to the suit',
        `Terrain and route: ${(res.bundle_bytes / 1e6).toLocaleString('en-US', { maximumFractionDigits: 2 })} MB. Checksum ${res.checksum.slice(0, 12)}…`,
        'green'
      );
    } catch {
      setSync({ status: 'error' });
      setApiHealth(null);
      notify(
        'Upload failed: the suit received nothing',
        'The compute engine is not responding. Send it again when the connection returns.',
        'red'
      );
    }
  }, [notify, sync.status]);

  const handleRunChaos = useCallback(
    async (trials: number, seed: number = CHAOS_REFERENCE.seed) => {
      setChaos((prev) => ({ ...prev, status: 'running', error: undefined }));
      try {
        const [run] = await Promise.all([fetchChaosMode(seed, trials), wait(MIN_BUSY_MS)]);
        setChaos({ status: 'done', run, finishedAt: Date.now() });
        notify(
          `Simulation complete: ${run.trials.toLocaleString('en-US')} EVAs (seed ${run.seed})`,
          `Safe in ${run.report.survival_rate_with_shelter_pct.toLocaleString('en-US')} % with the WP3 shelter and ${run.report.survival_rate_base_only_pct.toLocaleString('en-US')} % with the Base only.`,
          'cyan'
        );
      } catch (err) {
        const message = err instanceof ApiError ? err.message : 'Unknown error';
        setChaos({ status: 'error', run: null, error: message });
        setApiHealth(null);
        notify(
          'Simulation failed',
          'The compute engine is not responding. Keeping the mission reference.',
          'red'
        );
      }
    },
    [notify]
  );

  const handleSelectView = useCallback((view: ConsoleView) => {
    setActiveView(view);
    const nextPath = VIEW_TO_PATH[view];
    if (window.location.pathname !== nextPath) window.history.pushState(null, '', nextPath);
    if (view === 'eva-emergency') {
      setIsLive(false);
      setTMin(T_DECISION_MIN);
    }
  }, []);

  const handleSelectTime = useCallback((nextT: number) => {
    setIsLive(false);
    setTMin(Math.min(T_END_MIN, Math.max(T_START_MIN, nextT)));
    // /multiemergencia es un atajo a T+105: al elegir otro minuto la URL vuelve a ser la de
    // la telemetría (misma pantalla, sin tocar el historial).
    if (window.location.pathname === VIEW_TO_PATH['eva-emergency'] && nextT !== T_DECISION_MIN) {
      setActiveView('eva-hud-nominal');
      window.history.replaceState(null, '', VIEW_TO_PATH['eva-hud-nominal']);
    }
  }, []);

  const handleToggleLive = useCallback(() => {
    if (!isLive && tMin >= T_END_MIN) setTMin(T_START_MIN);
    setIsLive(!isLive);
  }, [isLive, tMin]);

  const isEvaView = activeView === 'eva-hud-nominal' || activeView === 'eva-emergency';

  return (
    <ConsoleShell
      activeView={activeView}
      onSelectView={handleSelectView}
      sample={sample}
      sync={sync}
      apiHealth={apiHealth}
      apiChecked={apiChecked}
      isLive={isLive}
      onToggleLive={handleToggleLive}
      onResetClock={() => handleSelectTime(T_START_MIN)}
      toast={toast}
      onDismissToast={() => setToast(null)}
    >
      {activeView === '3d-console' && (
        <Console3DView
          sample={sample}
          apiOnline={apiOnline}
          sync={sync}
          certified={certified}
          onSyncZenoh={handleSync}
          chaos={chaos}
          onRunChaos={handleRunChaos}
          onNotify={notify}
        />
      )}

      {activeView === 'route-planificator' && (
        <RoutePlannerView
          apiOnline={apiOnline}
          sync={sync}
          certified={certified}
          onSyncZenoh={handleSync}
          chaos={chaos}
          onRunChaos={handleRunChaos}
          onNotify={notify}
        />
      )}

      {/* Una sola instancia para /telemetria-eva y /multiemergencia: el estado del HUD
          (dial, capas, muestras) no se pierde al cambiar de una a otra (H-03, H-24). */}
      {isEvaView && (
        <EvaHudView
          sample={sample}
          tMin={tMin}
          isLive={isLive}
          apiOnline={apiOnline}
          onToggleLive={handleToggleLive}
          onSelectTimeMin={handleSelectTime}
          onNotify={notify}
        />
      )}
    </ConsoleShell>
  );
}

export default App;
