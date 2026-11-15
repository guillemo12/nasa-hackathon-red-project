import React, { useEffect, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import {
  CANONICAL_WAYPOINTS,
  CHAOS_REFERENCE,
  EVA07_DOC,
  EVA07_EVENTS,
  MAX_ELEV_GAIN_M,
  PERIMETER_M,
  PLANNER_WALKBACK,
  REFERENCE_FIGURES,
  SUIT_SCENARIO,
  T_END_MIN,
  TRIANGULO_GEOJSON,
  UX_LABELS,
  waypoint,
} from '@/data/missionData';
import { fetchEnrichedGeoJson, fetchRoutePlan } from '@/engine/apiClient';
import { CHAOS_VISIBLE_TRIALS, certify, sigmaPct } from '@/engine/chaos';
import { ISRU_H2O_MIN_PCT, classify, limits } from '@/engine/thresholds';
import type { Level } from '@/engine/thresholds';
import { fmt, fmtCoords, nodeLabel } from '@/engine/geo';
import { formatT } from '@/engine/evaModel';
import { RouteProfileChart } from '@/components/RouteProfileChart';
import { Button, Disclosure, Notice, Panel, Row, Stat, StatusDot, levelTextClass } from '@/components/ui';
import type { ChaosState, NodeId, Notify, RoutePlan, SyncState } from '@/types/mission';

interface RoutePlannerViewProps {
  apiOnline: boolean;
  sync: SyncState;
  certified: boolean;
  onSyncZenoh: () => void | Promise<void>;
  chaos: ChaosState;
  onRunChaos: (trials: number, seed?: number) => void | Promise<void>;
  onNotify: Notify;
}

const WB = PLANNER_WALKBACK;
const REF = CHAOS_REFERENCE;
const DEPARTURE = EVA07_EVENTS.find((e) => e.t_min === 0) ?? EVA07_EVENTS[0];
const NLOS_WINDOW = EVA07_DOC.threat_windows_t_min.sombra_radio;
const HAZARD_LABELS = ['0', '1', '2', '3', '4'];

const pct = (v: number, d = 1) => `${fmt(v, d)} %`;
/** Recuento exacto con separador de miles también en cuatro cifras: «9.602 de 10.000». */
const count = (v: number) => String(Math.round(v)).replace(/\B(?=(\d{3})+$)/g, '.');

/** Nombres de los hitos tal como se dicen en el equipo (los datos los traen en mayúsculas). */
const NODE_NAME: Record<string, string> = {
  BASE: 'Base Alpha',
  WP1: 'WP1, sulfatos',
  WP2: 'WP2, talud',
  WP3: 'WP3, refugio',
};

/** Los datos de la misión traen la geología sin tildes: se corrigen al pintar. */
const SPELLING: Array<[RegExp, string]> = [
  [/\bDeposito\b/g, 'Depósito'],
  [/\bdeposito\b/g, 'depósito'],
  [/\blobulo\b/g, 'lóbulo'],
  [/\bbasalticas\b/g, 'basálticas'],
  [/\bSW\b/g, 'suroeste'],
];
const spell = (text: string) => SPELLING.reduce((t, [from, to]) => t.replace(from, to), text);

/** Relleno atenuado de una barra según su nivel; el dato va siempre escrito al lado. */
const LEVEL_BAR: Record<Level, string> = {
  green: 'bg-ok/20',
  amber: 'bg-warn/30',
  red: 'bg-danger/35',
  none: 'bg-line-strong',
};
const RADIO_WORD: Record<Level, string> = { green: 'bueno', amber: 'débil', red: 'cortado', none: 'sin dato' };

const FIELD = 'min-h-10 rounded-md border border-line-strong bg-ground px-2 text-sm text-ink';
const TH = 'py-2 pl-4 font-normal text-right whitespace-nowrap';
const TD = 'py-2 pl-4 text-right whitespace-nowrap';

export const RoutePlannerView: React.FC<RoutePlannerViewProps> = ({
  apiOnline,
  sync,
  certified,
  onSyncZenoh,
  chaos,
  onRunChaos,
  onNotify,
}) => {
  const [trials, setTrials] = useState<number>(CHAOS_VISIBLE_TRIALS);
  const [seed, setSeed] = useState<number>(REF.seed);
  const [selectedWpId, setSelectedWpId] = useState<NodeId>('WP2');
  const [plan, setPlan] = useState<RoutePlan | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (!apiOnline) {
      setPlan(null);
      return;
    }
    let active = true;
    setPlanLoading(true);
    fetchRoutePlan()
      .then((p) => active && setPlan(p))
      .catch(() => active && setPlan(null))
      .finally(() => active && setPlanLoading(false));
    return () => {
      active = false;
    };
  }, [apiOnline]);

  const run = chaos.status === 'done' ? chaos.run : null;
  const cert = run ? certify(run) : null;
  const running = chaos.status === 'running';
  const selectedWp = waypoint(selectedWpId);
  const simulateLabel = `Simular ${fmt(trials)} salidas`;

  const handleExport = async () => {
    setExporting(true);
    try {
      let doc: unknown = TRIANGULO_GEOJSON;
      let enriched = false;
      if (apiOnline) {
        try {
          doc = await fetchEnrichedGeoJson();
          enriched = true;
        } catch {
          enriched = false;
        }
      }
      const text = JSON.stringify(doc, null, 2);
      const blob = new Blob([text], { type: 'application/geo+json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'triangulo_supervivencia_melas_eva07.geojson';
      a.click();
      URL.revokeObjectURL(url);
      if (enriched) {
        const detail = `${fmt(text.length / 1024, 1)} kB con el tiempo, el consumo de O₂ y la dosis de cada tramo, y la huella SHA-256 del paquete.`;
        if (certified) {
          onNotify('GeoJSON exportado', `${detail} Enviar la ruta al traje es un paso aparte.`, 'green');
        } else {
          onNotify('GeoJSON exportado sin autorizar', `${detail} La ruta aún no está autorizada: simúlala antes de enviarla al traje.`, 'amber');
        }
      } else {
        onNotify(
          'GeoJSON exportado sin datos por tramo',
          'El motor de cálculo no responde: el fichero lleva solo el trazado guardado de la misión, sin tiempo, consumo ni dosis por tramo.',
          'amber'
        );
      }
    } finally {
      setExporting(false);
    }
  };

  const handleSend = () => {
    if (!certified) {
      onNotify(
        'Simula la ruta antes de enviarla al traje',
        `Pulsa «${simulateLabel}» y espera al resultado «Ruta autorizada».`,
        'amber'
      );
      return;
    }
    if (sync.status !== 'ok') void onSyncZenoh();
  };

  const certReason = cert
    ? cert.authorized
      ? 'El cambio al refugio protege la salida y el resultado cuadra con la referencia de la misión.'
      : !cert.completed
        ? 'La simulación no ha terminado todas las salidas.'
        : !cert.shelterNotWorse
          ? 'Cambiar al refugio da peor resultado que volver a la Base: hay que revisar el trazado.'
          : 'El resultado se aparta demasiado de la referencia de la misión: revisa el trazado o repite la simulación.'
    : null;

  // Veredicto de la cabecera: responde «¿puedo autorizar esta salida?» y dice por qué se puede
  // enviar o no. El estado del envío, cuando lo hay, sustituye a la coletilla.
  const syncText =
    sync.status === 'ok'
      ? 'El traje ya tiene esta ruta.'
      : sync.status === 'syncing'
        ? 'Enviando la ruta al traje…'
        : sync.status === 'error'
          ? 'El envío ha fallado. Vuelve a intentarlo.'
          : null;
  const offlineText = apiOnline ? '' : ' Sin el motor de cálculo, el GeoJSON se exporta sin datos por tramo.';
  const verdictBase: { level: Level; title: string; text: string } = running
    ? { level: 'none', title: `Simulando ${fmt(trials)} salidas…`, text: 'Espera al resultado para poder enviar la ruta al traje.' }
    : cert
      ? cert.authorized
        ? { level: 'green', title: 'Ruta autorizada', text: `${certReason} Ya se puede enviar al traje.` }
        : { level: 'red', title: 'Ruta no autorizada', text: `${certReason} No se puede enviar al traje.` }
      : chaos.status === 'error'
        ? { level: 'amber', title: 'Sin simular', text: 'La última simulación no se pudo ejecutar porque el motor de cálculo no responde.' }
        : {
            level: 'none',
            title: 'Sin simular',
            text: apiOnline
              ? 'Simula la ruta para autorizarla y poder enviarla al traje.'
              : 'El motor de cálculo no responde: no se puede simular ni autorizar la ruta hasta que vuelva.',
          };
  // El estado del envío, cuando lo hay, manda sobre la coletilla del veredicto.
  const verdict = {
    ...verdictBase,
    text: `${syncText ? (cert?.authorized && !running ? `${certReason} ${syncText}` : syncText) : verdictBase.text}${offlineText}`,
  };

  const wp1Power = EVA07_DOC.phases.find((p) => p.phase_id === 'A2_isru_wp1')?.power_w;
  const wp2O2 = EVA07_DOC.phases.find((p) => p.phase_id === 'A3_rampa_pico')?.o2_l_min;
  const o2Level = classify('o2_primary_pct', EVA07_DOC.final.o2_remaining_pct);
  const radioSegments = EVA07_EVENTS.filter((e) => e.t_min >= 0);

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 pb-4">
      {/* Cabecera: título, resumen, veredicto y acciones. Todo lo que decide la salida, sin desplazarse. */}
      <header className="space-y-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">Plan de la salida EVA-07</h1>
          <p className="text-sm text-ink-2 mt-1">
            <span className="tabular-nums">
              {fmt(PERIMETER_M / 1000, 2)} km en {fmt(T_END_MIN)} min, con un desnivel máximo de +{fmt(MAX_ELEV_GAIN_M)} m de la Base a
              WP2.
            </span>{' '}
            Sol {UX_LABELS.sol}, salida a las {DEPARTURE.lmst} (hora local).
            {!apiOnline && ' Sin el planificador: ves los datos guardados de la misión.'}
          </p>
        </div>

        <section aria-label="Autorización de la salida" className="rounded-lg border border-line bg-panel p-4">
          <div className="flex flex-wrap items-start justify-between gap-x-10 gap-y-3">
            <div role="status" className="min-w-0 flex-1 basis-72">
              <div className={`flex items-center gap-2 t-value font-semibold ${levelTextClass(verdict.level)}`}>
                <StatusDot level={verdict.level} />
                {verdict.title}
              </div>
              <p id="motivo-envio" className={`text-sm mt-1 max-w-2xl ${syncText && sync.status === 'error' ? 'text-danger-ink' : 'text-ink-2'}`}>
                {verdict.text}
              </p>
            </div>
            {run && !running && (
              <div>
                <div className="flex gap-x-8">
                  <Stat size="lg" label="Seguras con el refugio WP3" value={pct(run.report.survival_rate_with_shelter_pct)} />
                  <Stat
                    size="lg"
                    label="Seguras solo con la Base"
                    value={pct(run.report.survival_rate_base_only_pct)}
                    level={WB.base_feasible ? undefined : 'red'}
                  />
                </div>
                <p className="t-label text-ink-3 tabular-nums mt-0.5">
                  {fmt(run.report.trials)} de {fmt(run.trials)} salidas simuladas, con la semilla {run.seed}.
                </p>
              </div>
            )}
          </div>

          <div className="mt-4 flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2 sm:gap-3">
            <Button disabled={running || !apiOnline} onClick={() => void onRunChaos(trials, seed)}>
              {running && <Loader2 className="w-4 h-4 animate-spin" aria-hidden />}
              {running ? 'Simulando…' : simulateLabel}
            </Button>
            <Button onClick={() => void handleExport()} disabled={exporting}>
              {exporting ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : <Download className="w-4 h-4" aria-hidden />}
              Exportar GeoJSON
            </Button>
            <Button
              variant="primary"
              onClick={handleSend}
              aria-disabled={!certified || sync.status === 'syncing' || sync.status === 'ok'}
              aria-describedby="motivo-envio"
              className="sm:ml-auto aria-disabled:bg-raised aria-disabled:text-ink-3 aria-disabled:font-medium aria-disabled:cursor-not-allowed aria-disabled:hover:brightness-100"
            >
              {sync.status === 'syncing' && <Loader2 className="w-4 h-4 animate-spin" aria-hidden />}
              {sync.status === 'syncing' ? 'Enviando…' : sync.status === 'ok' ? 'Ruta enviada al traje' : 'Enviar ruta al traje'}
            </Button>
          </div>
        </section>
      </header>

      {/* Perfil de la ruta y hitos */}
      <Panel
        title="Perfil de la ruta"
        aside={
          plan
            ? `Ritmo sostenido: ${fmt(plan.pace.speed_cap_mps, 1)} m/s y ${fmt(plan.pace.power_cap_w)} W`
            : planLoading
              ? 'Calculando el plan de ruta…'
              : 'Solo los cuatro puntos guardados'
        }
      >
        <RouteProfileChart plan={plan} selectedId={selectedWpId} onSelect={setSelectedWpId} />

        <div className="mt-4 pt-4 border-t border-line">
          <h3 className="t-label text-ink-3 mb-1">Hitos de la ruta</h3>
          <ol className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-1 -mx-2">
            {CANONICAL_WAYPOINTS.map((wp, idx) => {
              const note =
                wp.id === 'BASE'
                  ? 'Inicio y final'
                  : wp.id === 'WP1'
                    ? `Recogida de recursos: agua ≥ ${fmt(ISRU_H2O_MIN_PCT)} %`
                    : wp.id === 'WP2'
                      ? `Rampa de ${SUIT_SCENARIO.wp2RampDeg}°`
                      : `Refugio, a ${fmt(WB.wp3.time_min, 1)} min de WP2`;
              const selected = selectedWpId === wp.id;
              return (
                <li key={wp.id}>
                  <button
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setSelectedWpId(wp.id)}
                    className={`w-full min-h-11 text-left rounded-md px-2 py-1.5 cursor-pointer transition-colors ${
                      selected ? 'bg-raised' : 'hover:bg-raised'
                    }`}
                  >
                    <span className={`block text-sm ${selected ? 'font-semibold text-ink' : 'font-medium text-ink-2'}`}>
                      {idx + 1}. {NODE_NAME[wp.id] ?? nodeLabel(wp.id)}
                    </span>
                    <span className="block t-label text-ink-3 tabular-nums">
                      {fmt(wp.distFromBaseM / 1000, 2)} km, cota {fmt(wp.elevMolaM)} m
                    </span>
                    <span className="block t-label text-ink-3">{note}</span>
                  </button>
                </li>
              );
            })}
          </ol>

          {selectedWp && (
            <div className="mt-3" aria-live="polite">
              <div className="text-sm font-semibold text-ink">{NODE_NAME[selectedWp.id] ?? nodeLabel(selectedWp.id)}</div>
              <p className="t-label text-ink-2 mt-0.5">{spell(selectedWp.geology)}</p>
              <div className="mt-1.5 grid grid-cols-1 sm:grid-cols-2 gap-x-10">
                <Row label="Coordenadas" value={fmtCoords(selectedWp.lat, selectedWp.lonE)} />
                <Row label="Cota" value={`${fmt(selectedWp.elevMolaM)} m`} />
                <Row
                  label="Pendiente local"
                  level={classify('slope_deg', selectedWp.slopeLocalDeg)}
                  value={`${fmt(selectedWp.slopeLocalDeg, 1)}°${
                    selectedWp.id === 'WP2' ? ` (rampa supuesta de ${SUIT_SCENARIO.wp2RampDeg}°)` : ''
                  }`}
                />
                <Row
                  label="Inercia térmica (valor supuesto)"
                  level={classify('thermal_inertia_tiu', selectedWp.tiu)}
                  value={`${selectedWp.tiu} TIU`}
                />
                <Row
                  label="Cielo visible (SVF)"
                  value={
                    selectedWp.svfScenario !== selectedWp.svfDem
                      ? `${fmt(selectedWp.svfScenario, 2)} supuesto (${fmt(selectedWp.svfDem, 2)} en el modelo del terreno)`
                      : fmt(selectedWp.svfScenario, 2)
                  }
                />
                {selectedWp.id === 'WP1' && <Row label="Esfuerzo en la recogida" value={`${fmt(wp1Power)} W`} />}
                {selectedWp.id === 'WP2' && (
                  <Row
                    label="Pico de esfuerzo en la rampa"
                    value={`${fmt(REFERENCE_FIGURES.wp2_peak_w)} W · ${fmt(wp2O2, 1)} L/min de O₂`}
                  />
                )}
              </div>
            </div>
          )}
        </div>
      </Panel>

      {/* Recorrido por tramos: sin caja, solo título y tabla */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-ink">Recorrido por tramos</h2>
        {plan ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-ink tabular-nums">
                <caption className="sr-only">Distancia, tiempo, esfuerzo, oxígeno y dosis de cada tramo del plan</caption>
                <thead>
                  <tr className="t-label text-ink-3">
                    <th scope="col" className="py-2 font-normal text-left">Tramo</th>
                    <th scope="col" className={TH}>Distancia</th>
                    <th scope="col" className={TH}>Tiempo</th>
                    <th scope="col" className={TH}>Potencia media</th>
                    <th scope="col" className={TH}>O₂</th>
                    <th scope="col" className={TH}>Dosis de fondo</th>
                    <th scope="col" className={TH}>Dosis si hay SPE</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.legs.map((l) => (
                    <tr key={l.leg_id} className="border-t border-line">
                      <th scope="row" className="py-2 pr-2 text-left font-medium whitespace-nowrap">
                        {l.leg_id} <span className="font-normal text-ink-2">{nodeLabel(l.from)} → {nodeLabel(l.to)}</span>
                        {l.leg_id === 'R1' && <span className="font-normal text-ink-3"> (contingencia)</span>}
                      </th>
                      <td className={TD}>{fmt(l.length_m)} m</td>
                      <td className={TD}>{fmt(l.time_min, 1)} min</td>
                      <td className={`${TD} ${levelTextClass(classify('metabolic_rate_w', l.mean_power_w))}`}>{fmt(l.mean_power_w)} W</td>
                      <td className={TD}>
                        {fmt(l.o2_liters, 1)} L · {fmt(l.o2_grams)} g
                      </td>
                      <td className={TD}>{fmt(l.gcr_dose_msv, 3)} mSv</td>
                      <td className={`${TD} ${levelTextClass(classify('eva_spe_dose_budget_msv', l.spe_envelope_dose_msv))}`}>
                        {fmt(l.spe_envelope_dose_msv, 2)} mSv
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="t-label text-ink-3 max-w-3xl">
              En ámbar o en rojo, lo que supera los límites de la misión. Los tramos van a ritmo sostenido; la huida real al refugio WP3
              en {formatT(WB.decision_t_min)} se hace a ritmo de escape: {fmt(WB.wp3.time_min, 2)} min y {fmt(WB.wp3.dose_spe_msv, 2)} mSv.
            </p>
          </>
        ) : (
          <p className="text-sm text-ink-2">
            {planLoading
              ? 'Calculando el plan de ruta…'
              : 'Los tiempos, el consumo y la dosis de cada tramo los da el planificador, que ahora no responde.'}
          </p>
        )}
      </section>

      {/* Consumibles y enlace de radio: sin caja, separados por un divisor fino */}
      <section className="pt-6 border-t border-line">
        <h2 className="text-sm font-semibold text-ink">Consumibles y enlace de radio</h2>
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-x-8 gap-y-4">
          <div>
            <Stat
              label="Oxígeno primario al final"
              value={pct(EVA07_DOC.final.o2_remaining_pct)}
              level={o2Level}
              hint={`De ${fmt(EVA07_EVENTS[0].values.o2_remaining_g)} g útiles al salir`}
            />
            <div className="mt-1.5 h-1.5 rounded-sm bg-raised overflow-hidden" aria-hidden>
              <div className={`h-full ${LEVEL_BAR[o2Level]}`} style={{ width: `${EVA07_DOC.final.o2_remaining_pct}%` }} />
            </div>
          </div>
          <Stat
            label="Agua de refrigeración (valor supuesto)"
            value={fmt(SUIT_SCENARIO.coolingWaterKg, 1)}
            unit="kg"
            hint={`Autonomía en ${formatT(WB.decision_t_min)}: ${fmt(WB.t_vital_lcvg_min)} min`}
          />
          <Stat
            label="Batería del traje (valor supuesto)"
            value={fmt(SUIT_SCENARIO.batteryWh)}
            unit="Wh"
            hint={`Gasto de unos ${SUIT_SCENARIO.batteryDrawW} W. Autonomía en ${formatT(WB.decision_t_min)}: ${fmt(WB.t_vital_battery_min)} min`}
          />
        </div>

        <div className="mt-5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
            <h3 className="text-sm font-medium text-ink">Enlace con el traje durante la salida</h3>
            <span className="t-label text-ink-3">Banda S, {fmt(REFERENCE_FIGURES.radio_primary_freq_mhz / 1000, 1)} GHz</span>
          </div>
          <div
            className="mt-2 h-8 rounded-md overflow-hidden flex t-label tabular-nums text-ink"
            role="img"
            aria-label={`Enlace bueno hasta ${formatT(NLOS_WINDOW[0])}, cortado hasta ${formatT(NLOS_WINDOW[1])} y bueno de nuevo hasta el final`}
          >
            {radioSegments.map((e, i, arr) => {
              const next = arr[i + 1];
              if (!next || next.t_min === e.t_min) return null;
              const level = classify('radio_rssi_dbm', e.values.radio_rssi_dbm);
              const widthPct = ((next.t_min - e.t_min) / T_END_MIN) * 100;
              return (
                <div
                  key={`${e.id}`}
                  className={`h-full flex items-center justify-center overflow-hidden whitespace-nowrap ${LEVEL_BAR[level]}`}
                  style={{ width: `${widthPct}%` }}
                  title={`De ${formatT(e.t_min)} a ${formatT(next.t_min)}: ${fmt(e.values.radio_rssi_dbm, 1)} dBm, enlace ${RADIO_WORD[level]}`}
                >
                  {widthPct > 9 && (
                    <span className={widthPct > 20 ? undefined : 'hidden md:inline'}>{fmt(e.values.radio_rssi_dbm, 0)} dBm</span>
                  )}
                </div>
              );
            })}
          </div>
          <div className="mt-1 flex justify-between t-label text-ink-3 tabular-nums">
            <span>{formatT(0)}</span>
            <span>T+{fmt(T_END_MIN / 2, 0)} min</span>
            <span>T+{fmt(T_END_MIN)}</span>
          </div>
          <p className="t-label text-ink-2 mt-2">
            Sombra de radio de {formatT(NLOS_WINDOW[0])} a {formatT(NLOS_WINDOW[1])}, en rojo: el enlace pasa por el repetidor del rover
            y el traje navega solo.
          </p>
        </div>

        <Disclosure summary="La salida sin tormenta solar" className="mt-3">
          <div className="max-w-xl">
            <Row
              label="Dosis de fondo en toda la salida"
              value={`${fmt(EVA07_DOC.final.dose_gcr_msv, 3)} mSv`}
            />
            <Row
              label="Retorno a la Base desde WP2"
              value={`${fmt(WB.base.time_min, 1)} min, ${fmt(WB.base.length_m)} m y ${fmt(WB.base.o2_liters, 1)} L de O₂`}
            />
            <p className="t-label text-ink-2 mt-1">
              Sin tormenta solar, volver a la Base es viable. Con SPE el límite es de {fmt(WB.dose_budget_msv)} mSv por salida y solo
              hay {fmt(WB.open_sky_window_min)} min a cielo abierto: por eso se simula el cambio al refugio.
            </p>
          </div>
        </Disclosure>
      </section>

      {/* Simulación de imprevistos: el detalle; el veredicto y el botón están en la cabecera */}
      <Panel title="Simulación de imprevistos">
        <p className="text-sm text-ink-2 max-w-3xl">
          Se repite la salida con imprevistos al azar en el peor momento, {formatT(WB.decision_t_min)}: tormenta solar de{' '}
          {fmt(WB.spe_rate_envelope_msv_h)} mSv/h, polvo τ {fmt(WB.dust_tau, 1)}, sombra de radio y la rampa de {SUIT_SCENARIO.wp2RampDeg}°.
          Cada vez se comprueba si la astronauta acaba a salvo cambiando al refugio WP3 y si lo haría volviendo a la Base.
        </p>

        {!apiOnline && (
          <Notice level="amber" className="mt-3">
            La simulación la hace el motor de cálculo, que ahora no responde. Solo se muestra la referencia de la misión.
          </Notice>
        )}

        <div className="mt-3 overflow-x-auto">
          <table className="w-full max-w-3xl text-sm text-ink tabular-nums">
            <caption className="sr-only">Salidas seguras en esta simulación y en la referencia de la misión</caption>
            <thead>
              <tr className="t-label text-ink-3">
                <th scope="col" className="py-2 pr-4 font-normal text-left">Salidas seguras</th>
                <th scope="col" className="py-2 pl-4 font-normal text-right">Con cambio al refugio WP3</th>
                <th scope="col" className="py-2 pl-4 font-normal text-right">Solo con la Base</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-line">
                <th scope="row" className="py-2 pr-4 text-left font-medium">
                  Esta simulación
                  {run && (
                    <span className="block t-label font-normal text-ink-3">
                      {fmt(run.report.trials)} salidas, semilla {run.seed}
                    </span>
                  )}
                </th>
                <td className="py-2 pl-4 text-right align-top font-semibold">
                  {run ? pct(run.report.survival_rate_with_shelter_pct) : running ? 'Simulando…' : 'Sin simular'}
                </td>
                <td className={`py-2 pl-4 text-right align-top font-semibold ${run && !WB.base_feasible ? 'text-danger-ink' : ''}`}>
                  {run ? pct(run.report.survival_rate_base_only_pct) : '—'}
                </td>
              </tr>
              <tr className="border-t border-line">
                <th scope="row" className="py-2 pr-4 text-left font-medium">
                  Referencia de la misión
                  <span className="block t-label font-normal text-ink-3">
                    {fmt(REF.trials)} salidas, semilla {REF.seed}
                  </span>
                </th>
                <td className="py-2 pl-4 text-right align-top">
                  {pct(REF.report.survival_rate_with_shelter_pct)}
                  <span className="block t-label text-ink-3">
                    {count(REF.report.survived_with_wp3_shelter)} de {count(REF.trials)}
                  </span>
                </td>
                <td className="py-2 pl-4 text-right align-top">
                  {pct(REF.report.survival_rate_base_only_pct)}
                  <span className="block t-label text-ink-3">
                    {count(REF.report.survived_base_only)} de {count(REF.trials)}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <Disclosure summary="Opciones de la simulación" className="mt-2">
          <div className="flex flex-wrap items-end gap-3 pb-1">
            <label className="t-label text-ink-3">
              <span className="block mb-1">Número de salidas</span>
              <select value={trials} onChange={(e) => setTrials(Number(e.target.value))} className={FIELD}>
                <option value={CHAOS_VISIBLE_TRIALS}>{CHAOS_VISIBLE_TRIALS} (rápida)</option>
                <option value={REF.trials}>{fmt(REF.trials)} (como la referencia)</option>
              </select>
            </label>
            <label className="t-label text-ink-3">
              <span className="block mb-1">Semilla del azar</span>
              <input
                type="number"
                min={1}
                value={seed}
                onChange={(e) => setSeed(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
                className={`${FIELD} w-28 tabular-nums`}
              />
            </label>
            <Button disabled={running || !apiOnline} onClick={() => void onRunChaos(trials, seed)}>
              {running && <Loader2 className="w-4 h-4 animate-spin" aria-hidden />}
              {running ? 'Simulando…' : simulateLabel}
            </Button>
          </div>
        </Disclosure>

        <Disclosure summary="Histograma y cómo se calcula">
          <div className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-5">
              <div>
                <h3 className="text-sm font-medium text-ink">Con cambio automático al refugio WP3</h3>
                <p className="t-label text-ink-2 mt-1">
                  Huida cuesta abajo de {fmt(WB.wp3.time_min, 1)} min y {fmt(WB.wp3.length_m)} m, con una dosis de{' '}
                  {fmt(WB.wp3.dose_spe_msv, 2)} mSv:{' '}
                  {WB.wp3_within_open_sky_window ? 'cabe en la ventana a cielo abierto' : 'no cabe en la ventana a cielo abierto'}. El
                  refugio (cielo visible {fmt(waypoint('WP3')?.svfScenario, 2)}, valor supuesto) atenúa el{' '}
                  {SUIT_SCENARIO.shelterAttenuationPct} % de la tormenta: quedan {fmt(REFERENCE_FIGURES.wp3_rate_msv_h, 1)} mSv/h.
                </p>
                {run && (
                  <div className="mt-2">
                    <Row label="Seguras" value={count(run.report.outcomes_with_shelter.safe)} />
                    <Row label="Límite de dosis superado" value={count(run.report.outcomes_with_shelter.flight_rule_breach)} />
                    <Row label="Destino no alcanzado" value={count(run.report.outcomes_with_shelter.destination_not_reached)} />
                    <Row label="Cambios al refugio" value={count(run.report.switched_to_shelter)} />
                  </div>
                )}
              </div>
              <div>
                <h3 className="text-sm font-medium text-ink">Solo con el retorno a la Base</h3>
                <p className="t-label text-ink-2 mt-1">
                  Desde WP2 son {fmt(WB.base.time_min, 1)} min y {fmt(WB.base.length_m)} m de camino. La dosis sería de{' '}
                  <span className={WB.base_feasible ? undefined : 'text-danger-ink'}>{fmt(WB.base.dose_spe_msv, 2)} mSv</span>,{' '}
                  {fmt(WB.base.dose_spe_msv / WB.dose_budget_msv, 2)} veces el límite de {fmt(WB.dose_budget_msv)} mSv:{' '}
                  {WB.base_feasible ? 'es viable' : 'no es viable'} en {formatT(WB.decision_t_min)}.
                </p>
                {run && (
                  <div className="mt-2">
                    <Row label="Seguras" value={count(run.report.outcomes_base_only.safe)} />
                    <Row label="Límite de dosis superado" value={count(run.report.outcomes_base_only.flight_rule_breach)} />
                    <Row label="Destino no alcanzado" value={count(run.report.outcomes_base_only.destination_not_reached)} />
                    <Row label="Sin consumibles" value={count(run.report.outcomes_base_only.consumables_lost)} />
                  </div>
                )}
              </div>
            </div>

            <ChaosHistogram chaos={chaos} />

            <div className="space-y-2 t-label text-ink-2 max-w-3xl">
              {cert && run && (
                <p>
                  Para autorizar la ruta hacen falta tres cosas: que la simulación termine, que el refugio no salga peor que la Base y
                  que el resultado con refugio ({pct(cert.shelterPct)}) quede a menos de 3σ de la referencia ({pct(cert.referencePct)};
                  σ = {fmt(cert.sigmaPct, 1)} pp con {fmt(run.trials)} salidas).
                </p>
              )}
              <p>
                La simulación y la referencia salen del mismo modelo del motor de cálculo y del mismo terreno: un corredor de prueba en
                Melas Chasma, no el camino exacto de la ruta, que se recorre siempre en el mismo orden. La referencia son {fmt(REF.trials)}{' '}
                salidas con la semilla {REF.seed}; la simulación usa las opciones que elijas. Con {CHAOS_VISIBLE_TRIALS} salidas el
                margen de error (1σ) es de ±{fmt(sigmaPct(REF.report.survival_rate_with_shelter_pct, CHAOS_VISIBLE_TRIALS), 1)} pp con
                refugio y de ±{fmt(sigmaPct(REF.report.survival_rate_base_only_pct, CHAOS_VISIBLE_TRIALS), 1)} pp solo con la Base, así
                que es normal que no coincidan. Con {fmt(REF.trials)} salidas y la semilla {REF.seed}, la simulación reproduce la
                referencia.
              </p>
              <p>
                Límites del modelo: el terreno de cada tramo se toma por su posición en ese corredor, no a lo largo de la ruta
                planificada; el único consumible que se modela es el O₂ primario; la huida al refugio cuenta como un solo tramo con{' '}
                {fmt(0.55, 2)} veces la dosis a cielo abierto, y el retorno a la Base, como 14 tramos normales a partir del tramo 6.
              </p>
            </div>
          </div>
        </Disclosure>
      </Panel>
    </div>
  );
};

const ChaosHistogram: React.FC<{ chaos: ChaosState }> = ({ chaos }) => {
  const live = chaos.status === 'done' && chaos.run ? chaos.run.report : null;
  const report = live ?? REF.report;
  const n = report.trials;
  const max = Math.max(1, ...report.trials_by_max_concurrent_hazards);
  const sShelter = sigmaPct(report.survival_rate_with_shelter_pct, n);
  const sBase = sigmaPct(report.survival_rate_base_only_pct, n);
  const { red } = limits('eva_spe_dose_budget_msv');
  const series = [
    { key: 'total', label: 'Salidas simuladas', swatch: 'bg-line-strong', values: report.trials_by_max_concurrent_hazards },
    { key: 'shelter', label: 'Seguras con el refugio', swatch: 'bg-ink', values: report.safe_with_shelter_by_max_concurrent },
    { key: 'base', label: 'Seguras solo con la Base', swatch: 'bg-ink-3', values: report.safe_base_only_by_max_concurrent },
  ];
  const h = (v: number) => `${(v / max) * 100}%`;
  return (
    <div>
      <h3 className="text-sm font-medium text-ink">Salidas según cuántas amenazas coinciden</h3>
      <p className="t-label text-ink-3 mt-0.5">
        {live ? 'Simulación actual' : 'Referencia de la misión'}, {fmt(n)} salidas.
      </p>
      <div className="mt-3 overflow-x-auto">
        <div className="min-w-[280px] max-w-2xl">
          <div
            className="grid grid-cols-[9.5rem_repeat(5,minmax(0,1fr))] sm:grid-cols-[11rem_repeat(5,minmax(0,1fr))] gap-x-2 items-end"
            role="img"
            aria-label="Histograma de salidas por número de amenazas que coinciden; las cifras están en la tabla de debajo"
          >
            <span />
            {HAZARD_LABELS.map((label, i) => (
              <div key={label} className="h-28 flex items-end justify-center gap-0.5 border-b border-line-strong">
                {series.map((s) => (
                  <div key={s.key} className={`w-2.5 sm:w-3.5 rounded-t-sm ${s.swatch}`} style={{ height: h(s.values[i] ?? 0) }} />
                ))}
              </div>
            ))}
          </div>
          <table className="w-full table-fixed t-label tabular-nums mt-1">
            <caption className="sr-only">Salidas por número de amenazas que coinciden</caption>
            <colgroup>
              <col className="w-[9.5rem] sm:w-[11rem]" />
            </colgroup>
            <thead>
              <tr className="text-ink-3">
                <th scope="col" className="py-1 font-normal text-left">Amenazas a la vez</th>
                {HAZARD_LABELS.map((label) => (
                  <th key={label} scope="col" className="py-1 font-normal text-center">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {series.map((s) => (
                <tr key={s.key} className="border-t border-line text-ink">
                  <th scope="row" className="py-1.5 font-normal text-left text-ink-2">
                    <span className={`inline-block w-2.5 h-2.5 rounded-sm mr-2 ${s.swatch}`} aria-hidden />
                    {s.label}
                  </th>
                  {HAZARD_LABELS.map((label, i) => (
                    <td key={label} className="py-1.5 text-center">
                      {count(s.values[i] ?? 0)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="t-label text-ink-2 mt-3 max-w-3xl tabular-nums">
        Media y margen de error (1σ): {pct(report.survival_rate_with_shelter_pct)} ± {fmt(sShelter, 1)} pp con refugio y{' '}
        {pct(report.survival_rate_base_only_pct)} ± {fmt(sBase, 1)} pp solo con la Base. Una salida es «segura» si llega a su destino
        con una dosis de SPE de {fmt(red)} mSv o menos y sin agotar el O₂ primario.
      </p>
    </div>
  );
};
