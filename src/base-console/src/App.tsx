import { useEffect, useState } from 'react';
import { ConsoleShell } from '@/components/ConsoleShell';
import { Console3DView } from '@/components/Console3DView';
import { RoutePlannerView } from '@/components/RoutePlannerView';
import { EvaHudView } from '@/components/EvaHudView';
import { getNearestEvaEvent } from '@/data/missionData';
import {
  fetchApiHealth,
  fetchEva07Event,
  fetchMars2020RawImages,
  postZenohSync,
  type ApiHealth,
  type MarsRawImage,
} from '@/engine/apiClient';
import type { ConsoleView, Eva07Event } from '@/types/mission';

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

export function App() {
  const [activeView, setActiveView] = useState<ConsoleView>(() =>
    pathToView(window.location.pathname)
  );
  const [tMin, setTMin] = useState<number>(() =>
    pathToView(window.location.pathname) === 'eva-emergency' ? 105 : 28
  );
  const [currentEvent, setCurrentEvent] = useState<Eva07Event>(() =>
    getNearestEvaEvent(pathToView(window.location.pathname) === 'eva-emergency' ? 105 : 28)
  );
  const [apiHealth, setApiHealth] = useState<ApiHealth | null>(null);
  const [zenohSynced, setZenohSynced] = useState<boolean>(false);
  const [marsImages, setMarsImages] = useState<MarsRawImage[]>([]);
  const [selectedImageIdx, setSelectedImageIdx] = useState<number>(0);
  const [isLive, setIsLive] = useState<boolean>(true);
  const [telemetryFromApi, setTelemetryFromApi] = useState<boolean>(false);
  const [toast, setToast] = useState<{
    title: string;
    detail?: string;
    tone?: 'cyan' | 'green' | 'amber' | 'red';
  } | null>(null);

  const notify = (
    title: string,
    detail?: string,
    tone: 'cyan' | 'green' | 'amber' | 'red' = 'cyan'
  ) => {
    setToast({ title, detail, tone });
  };

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(id);
  }, [toast]);

  useEffect(() => {
    const onPopState = () => {
      const next = pathToView(window.location.pathname);
      setActiveView(next);
      if (next === 'eva-emergency') setTMin(105);
      else if (next === 'eva-hud-nominal') setTMin(28);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    fetchApiHealth().then(setApiHealth);
    fetchMars2020RawImages(8).then(setMarsImages);
  }, []);

  useEffect(() => {
    if (!isLive) return;
    const id = window.setInterval(() => {
      setTMin((prev) => {
        if (activeView === 'eva-emergency') {
          const next = prev + 0.3;
          return next > 113 ? 105 : Number(next.toFixed(1));
        }
        const next = prev + 0.5;
        return next > 165 ? 0 : Number(next.toFixed(1));
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [isLive, activeView]);

  useEffect(() => {
    let active = true;
    fetchEva07Event(tMin).then(({ event, fromApi }) => {
      if (active) {
        setCurrentEvent(event);
        setTelemetryFromApi(fromApi);
      }
    });
    return () => {
      active = false;
    };
  }, [tMin]);

  const handleSyncZenoh = async () => {
    const res = await postZenohSync();
    setZenohSynced(res.synced);
    notify(
      'Sincronización Eclipse Zenoh completada',
      `Checksum ${res.checksum} · ${res.cellsSynced} celdas H3 enviadas a xEMU-04`,
      'green'
    );
  };

  const handleSelectView = (view: ConsoleView) => {
    const resolvedView = view === 'eva-emergency' ? 'eva-hud-nominal' : view;
    setActiveView(resolvedView);
    const nextPath = VIEW_TO_PATH[resolvedView];
    if (window.location.pathname !== nextPath) {
      window.history.pushState(null, '', nextPath);
    }
    if (view === 'eva-emergency') {
      setTMin(105);
    } else if (view === 'eva-hud-nominal' && tMin >= 105 && tMin < 114) {
      setTMin(28);
    }
  };

  return (
    <ConsoleShell
      activeView={activeView}
      onSelectView={handleSelectView}
      currentEvent={currentEvent}
      zenohSynced={zenohSynced}
      apiHealth={apiHealth}
      isLive={isLive}
      telemetryFromApi={telemetryFromApi}
      onToggleLive={() => setIsLive((l) => !l)}
      toast={toast}
      onDismissToast={() => setToast(null)}
    >
      {activeView === '3d-console' && (
        <Console3DView
          currentEvent={currentEvent}
          zenohSynced={zenohSynced}
          onSyncZenoh={handleSyncZenoh}
          marsImages={marsImages}
          selectedImageIdx={selectedImageIdx}
          onChangeImageIdx={setSelectedImageIdx}
          onNotify={notify}
        />
      )}

      {activeView === 'route-planificator' && (
        <RoutePlannerView
          zenohSynced={zenohSynced}
          onApproveOfflinePlan={handleSyncZenoh}
          onNotify={notify}
        />
      )}

      {activeView === 'eva-hud-nominal' && (
        <EvaHudView
          currentEvent={currentEvent}
          marsImage={marsImages[selectedImageIdx] ?? null}
          marsImages={marsImages}
          selectedImageIdx={selectedImageIdx}
          onChangeImageIdx={setSelectedImageIdx}
          onNotify={notify}
          onSelectTimeMin={(nextT) => {
            setIsLive(false);
            setTMin(nextT);
          }}
        />
      )}

      {activeView === 'eva-emergency' && (
        <EvaHudView
          forceEmergency
          currentEvent={currentEvent}
          marsImage={marsImages[selectedImageIdx] ?? null}
          onNotify={notify}
          onSelectTimeMin={(nextT) => {
            setTMin(nextT);
            if (nextT < 105 || nextT >= 114) {
              handleSelectView('eva-hud-nominal');
            }
          }}
        />
      )}
    </ConsoleShell>
  );
}

export default App;
