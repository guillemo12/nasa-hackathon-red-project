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
import { usePoints } from '@/engine/reportedPoints';
import { EmergencyRedecision, PointList, RouteImpact, useEmergency } from '@/components/ReportedPointsPanel';
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
/** Exact count with a thousands separator, also for four digits: "9,602 of 10,000". */
const count = (v: number) => String(Math.round(v)).replace(/\B(?=(\d{3})+$)/g, ',');

/** Nombres de los hitos tal como se dicen en el equipo (los datos los traen en mayúsculas). */
const NODE_NAME: Record<string, string> = {
  BASE: 'Base Alpha',
  WP1: 'WP1, sulfates',
  WP2: 'WP2, slope',
  WP3: 'WP3, shelter',
};

/** La geología llega en español en los datos de la misión: se traduce al pintar. */
const GEOLOGY_EN: Record<string, string> = {
  'Terraza aluvial (abanico distal) sobre el piso de la cuenca SW de Melas':
    'Alluvial terrace (distal fan) on the floor of the SW Melas basin',
  'Deposito estratificado claro con sulfatos polihidratados interestratificados con monohidratados':
    'Light-toned layered deposit with polyhydrated sulfates interbedded with monohydrated sulfates',
  'Contacto entre lobulo de deslizamiento, traza de falla normal y bancos de polvo fino':
    'Contact between a landslide lobe, a normal fault trace and fine dust banks',
  'Alcoba bajo cornisa en la base de un escarpe de coladas basalticas estratificadas':
    'Alcove under an overhang at the foot of a scarp of layered basaltic flows',
};
const spell = (text: string) => GEOLOGY_EN[text] ?? text;

/** Relleno atenuado de una barra según su nivel; el dato va siempre escrito al lado. */
const LEVEL_BAR: Record<Level, string> = {
  green: 'bg-ok/20',
  amber: 'bg-warn/30',
  red: 'bg-danger/35',
  none: 'bg-line-strong',
};
const RADIO_WORD: Record<Level, string> = { green: 'good', amber: 'weak', red: 'lost', none: 'no data' };

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
  const reported = usePoints();
  const pointsVersion = Math.max(0, reported.version);
  const planCurrent = plan !== null && (plan.points_version ?? 0) === pointsVersion;
  const emergency = useEmergency(reported.version, apiOnline && reported.points.length > 0);

  // El motor replanifica cuando la astronauta marca o borra un punto: se vuelve a pedir el plan.
  useEffect(() => {
    if (!apiOnline) {
      setPlan(null);
      return;
    }
    let active = true;
    setPlanLoading(true);
    fetchRoutePlan(pointsVersion)
      .then((p) => active && setPlan(p))
      .catch(() => active && setPlan(null))
      .finally(() => active && setPlanLoading(false));
    return () => {
      active = false;
    };
  }, [apiOnline, pointsVersion]);

  const run = chaos.status === 'done' ? chaos.run : null;
  const cert = run ? certify(run) : null;
  const running = chaos.status === 'running';
  const selectedWp = waypoint(selectedWpId);
  const simulateLabel = `Simulate ${fmt(trials)} runs`;

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
        const detail = `${fmt(text.length / 1024, 1)} kB with time, O₂ use and dose for each leg, and the SHA-256 fingerprint of the bundle.`;
        if (certified) {
          onNotify('GeoJSON exported', `${detail} Sending the route to the suit is a separate step.`, 'green');
        } else {
          onNotify('GeoJSON exported, not authorized', `${detail} The route is not authorized yet: simulate it before sending it to the suit.`, 'amber');
        }
      } else {
        onNotify(
          'GeoJSON exported without per-leg data',
          'The compute engine is not responding: the file only has the stored mission track, with no time, consumption or dose per leg.',
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
        'Simulate the route before sending it to the suit',
        `Press "${simulateLabel}" and wait for the "Route authorized" result.`,
        'amber'
      );
      return;
    }
    if (sync.status !== 'ok') void onSyncZenoh();
  };

  const certReason = cert
    ? cert.authorized
      ? 'Switching to the shelter protects the EVA and the result matches the mission reference.'
      : !cert.completed
        ? 'The simulation did not finish all runs.'
        : !cert.shelterNotWorse
          ? 'Switching to the shelter does worse than returning to Base: the track needs review.'
          : 'The result is too far from the mission reference: review the track or rerun the simulation.'
    : null;

  // Veredicto de la cabecera: responde «¿puedo autorizar esta salida?» y dice por qué se puede
  // enviar o no. El estado del envío, cuando lo hay, sustituye a la coletilla.
  const syncText =
    sync.status === 'ok'
      ? 'The suit already has this route.'
      : sync.status === 'syncing'
        ? 'Sending the route to the suit…'
        : sync.status === 'error'
          ? 'Sending failed. Try again.'
          : null;
  const offlineText = apiOnline ? '' : ' Without the compute engine, the GeoJSON is exported without per-leg data.';
  const verdictBase: { level: Level; title: string; text: string } = running
    ? { level: 'none', title: `Simulating ${fmt(trials)} runs…`, text: 'Wait for the result before sending the route to the suit.' }
    : cert
      ? cert.authorized
        ? { level: 'green', title: 'Route authorized', text: `${certReason} It can now be sent to the suit.` }
        : { level: 'red', title: 'Route not authorized', text: `${certReason} It cannot be sent to the suit.` }
      : chaos.status === 'error'
        ? { level: 'amber', title: 'Not simulated', text: 'The last simulation could not run because the compute engine is not responding.' }
        : {
            level: 'none',
            title: 'Not simulated',
            text: apiOnline
              ? 'Simulate the route to authorize it and send it to the suit.'
              : 'The compute engine is not responding: the route cannot be simulated or authorized until it is back.',
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
          <h1 className="text-xl font-semibold text-ink">EVA-07 plan</h1>
          <p className="text-sm text-ink-2 mt-1">
            <span className="tabular-nums">
              {fmt(PERIMETER_M / 1000, 2)} km in {fmt(T_END_MIN)} min, with a maximum climb of +{fmt(MAX_ELEV_GAIN_M)} m from Base to
              WP2.
            </span>{' '}
            Sol {UX_LABELS.sol}, departure at {DEPARTURE.lmst} (local time).
            {!apiOnline && ' Planner offline: showing stored mission data.'}
          </p>
        </div>

        <section aria-label="EVA authorization" className="rounded-lg border border-line bg-panel p-4">
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
                  <Stat size="lg" label="Safe with WP3 shelter" value={pct(run.report.survival_rate_with_shelter_pct)} />
                  <Stat
                    size="lg"
                    label="Safe with Base only"
                    value={pct(run.report.survival_rate_base_only_pct)}
                    level={WB.base_feasible ? undefined : 'red'}
                  />
                </div>
                <p className="t-label text-ink-3 tabular-nums mt-0.5">
                  {fmt(run.report.trials)} of {fmt(run.trials)} runs simulated, seed {run.seed}.
                </p>
              </div>
            )}
          </div>

          <div className="mt-4 flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2 sm:gap-3">
            <Button disabled={running || !apiOnline} onClick={() => void onRunChaos(trials, seed)}>
              {running && <Loader2 className="w-4 h-4 animate-spin" aria-hidden />}
              {running ? 'Simulating…' : simulateLabel}
            </Button>
            <Button onClick={() => void handleExport()} disabled={exporting}>
              {exporting ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : <Download className="w-4 h-4" aria-hidden />}
              Export GeoJSON
            </Button>
            <Button
              variant="primary"
              onClick={handleSend}
              aria-disabled={!certified || sync.status === 'syncing' || sync.status === 'ok'}
              aria-describedby="motivo-envio"
              className="sm:ml-auto aria-disabled:bg-raised aria-disabled:text-ink-3 aria-disabled:font-medium aria-disabled:cursor-not-allowed aria-disabled:hover:brightness-100"
            >
              {sync.status === 'syncing' && <Loader2 className="w-4 h-4 animate-spin" aria-hidden />}
              {sync.status === 'syncing' ? 'Sending…' : sync.status === 'ok' ? 'Route sent to suit' : 'Send route to suit'}
            </Button>
          </div>
        </section>
      </header>

      {reported.points.length > 0 && (
        <Panel title="Points reported by the astronaut" aside={`${reported.points.length} in the engine`} bodyClassName="space-y-4">
          {planCurrent ? <RouteImpact plan={plan} /> : <p className="text-sm text-ink-3">The engine is replanning the route…</p>}
          {planCurrent && plan?.summary && plan.summary.detoured_legs.length > 0 && (
            <div className="flex flex-wrap gap-x-8 gap-y-2">
              <Stat label="Detoured legs" value={plan.summary.detoured_legs.join(', ')} />
              <Stat label="Added distance" value={`${plan.summary.added_length_m >= 0 ? '+' : ''}${fmt(plan.summary.added_length_m)}`} unit="m" />
              <Stat label="Added time" value={`${plan.summary.added_time_min >= 0 ? '+' : ''}${fmt(plan.summary.added_time_min, 1)}`} unit="min" />
              <Stat label="Added O₂" value={`${plan.summary.added_o2_liters >= 0 ? '+' : ''}${fmt(plan.summary.added_o2_liters, 2)}`} unit="L" />
            </div>
          )}
          <PointList points={reported.points} />
          {reported.hazardModel && <p className="t-label text-ink-3">{reported.hazardModel.note}</p>}
          <Disclosure summary="Emergency re-decision with these points" defaultOpen>
            <EmergencyRedecision data={emergency} canonicalWp3Min={WB.wp3.time_min} />
          </Disclosure>
          <p className="t-label text-ink-3">Points are reported and removed in EVA Telemetry. The exported GeoJSON includes the replanned route and the point list.</p>
        </Panel>
      )}

      {/* Perfil de la ruta y hitos */}
      <Panel
        title="Route profile"
        aside={
          plan
            ? `Sustained pace: ${fmt(plan.pace.speed_cap_mps, 1)} m/s and ${fmt(plan.pace.power_cap_w)} W`
            : planLoading
              ? 'Computing the route plan…'
              : 'Only the four stored points'
        }
      >
        <RouteProfileChart plan={plan} selectedId={selectedWpId} onSelect={setSelectedWpId} />

        <div className="mt-4 pt-4 border-t border-line">
          <h3 className="t-label text-ink-3 mb-1">Route waypoints</h3>
          <ol className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-1 -mx-2">
            {CANONICAL_WAYPOINTS.map((wp, idx) => {
              const note =
                wp.id === 'BASE'
                  ? 'Start and finish'
                  : wp.id === 'WP1'
                    ? `Resource collection: water ≥ ${fmt(ISRU_H2O_MIN_PCT)} %`
                    : wp.id === 'WP2'
                      ? `${SUIT_SCENARIO.wp2RampDeg}° ramp`
                      : `Shelter, ${fmt(WB.wp3.time_min, 1)} min from WP2`;
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
                      {fmt(wp.distFromBaseM / 1000, 2)} km, elevation {fmt(wp.elevMolaM)} m
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
                <Row label="Coordinates" value={fmtCoords(selectedWp.lat, selectedWp.lonE)} />
                <Row label="Elevation" value={`${fmt(selectedWp.elevMolaM)} m`} />
                <Row
                  label="Local slope"
                  level={classify('slope_deg', selectedWp.slopeLocalDeg)}
                  value={`${fmt(selectedWp.slopeLocalDeg, 1)}°${
                    selectedWp.id === 'WP2' ? ` (assumed ${SUIT_SCENARIO.wp2RampDeg}° ramp)` : ''
                  }`}
                />
                <Row
                  label="Thermal inertia (assumed value)"
                  level={classify('thermal_inertia_tiu', selectedWp.tiu)}
                  value={`${selectedWp.tiu} TIU`}
                />
                <Row
                  label="Sky view factor (SVF)"
                  value={
                    selectedWp.svfScenario !== selectedWp.svfDem
                      ? `${fmt(selectedWp.svfScenario, 2)} assumed (${fmt(selectedWp.svfDem, 2)} in the terrain model)`
                      : fmt(selectedWp.svfScenario, 2)
                  }
                />
                {selectedWp.id === 'WP1' && <Row label="Effort during collection" value={`${fmt(wp1Power)} W`} />}
                {selectedWp.id === 'WP2' && (
                  <Row
                    label="Peak effort on the ramp"
                    value={`${fmt(REFERENCE_FIGURES.wp2_peak_w)} W · ${fmt(wp2O2, 1)} L/min of O₂`}
                  />
                )}
              </div>
            </div>
          )}
        </div>
      </Panel>

      {/* Recorrido por tramos: sin caja, solo título y tabla */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-ink">Route by leg</h2>
        {plan ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-ink tabular-nums">
                <caption className="sr-only">Distance, time, effort, oxygen and dose for each planned leg</caption>
                <thead>
                  <tr className="t-label text-ink-3">
                    <th scope="col" className="py-2 font-normal text-left">Leg</th>
                    <th scope="col" className={TH}>Distance</th>
                    <th scope="col" className={TH}>Time</th>
                    <th scope="col" className={TH}>Mean power</th>
                    <th scope="col" className={TH}>O₂</th>
                    <th scope="col" className={TH}>Background dose</th>
                    <th scope="col" className={TH}>Dose if SPE</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.legs.map((l) => (
                    <tr key={l.leg_id} className="border-t border-line">
                      <th scope="row" className="py-2 pr-2 text-left font-medium whitespace-nowrap">
                        {l.leg_id} <span className="font-normal text-ink-2">{nodeLabel(l.from)} → {nodeLabel(l.to)}</span>
                        {l.leg_id === 'R1' && <span className="font-normal text-ink-3"> (contingency)</span>}
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
              Amber or red marks what exceeds mission limits. Legs are at sustained pace; the actual escape to the WP3 shelter
              at {formatT(WB.decision_t_min)} is at escape pace: {fmt(WB.wp3.time_min, 2)} min and {fmt(WB.wp3.dose_spe_msv, 2)} mSv.
            </p>
          </>
        ) : (
          <p className="text-sm text-ink-2">
            {planLoading
              ? 'Computing the route plan…'
              : 'Time, consumption and dose per leg come from the planner, which is not responding.'}
          </p>
        )}
      </section>

      {/* Consumibles y enlace de radio: sin caja, separados por un divisor fino */}
      <section className="pt-6 border-t border-line">
        <h2 className="text-sm font-semibold text-ink">Consumables and radio link</h2>
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-x-8 gap-y-4">
          <div>
            <Stat
              label="Primary oxygen at the end"
              value={pct(EVA07_DOC.final.o2_remaining_pct)}
              level={o2Level}
              hint={`Of ${fmt(EVA07_EVENTS[0].values.o2_remaining_g)} g usable at departure`}
            />
            <div className="mt-1.5 h-1.5 rounded-sm bg-raised overflow-hidden" aria-hidden>
              <div className={`h-full ${LEVEL_BAR[o2Level]}`} style={{ width: `${EVA07_DOC.final.o2_remaining_pct}%` }} />
            </div>
          </div>
          <Stat
            label="Cooling water (assumed value)"
            value={fmt(SUIT_SCENARIO.coolingWaterKg, 1)}
            unit="kg"
            hint={`Endurance at ${formatT(WB.decision_t_min)}: ${fmt(WB.t_vital_lcvg_min)} min`}
          />
          <Stat
            label="Suit battery (assumed value)"
            value={fmt(SUIT_SCENARIO.batteryWh)}
            unit="Wh"
            hint={`Draw of about ${SUIT_SCENARIO.batteryDrawW} W. Endurance at ${formatT(WB.decision_t_min)}: ${fmt(WB.t_vital_battery_min)} min`}
          />
        </div>

        <div className="mt-5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
            <h3 className="text-sm font-medium text-ink">Suit link during the EVA</h3>
            <span className="t-label text-ink-3">S band, {fmt(REFERENCE_FIGURES.radio_primary_freq_mhz / 1000, 1)} GHz</span>
          </div>
          <div
            className="mt-2 h-8 rounded-md overflow-hidden flex t-label tabular-nums text-ink"
            role="img"
            aria-label={`Link good until ${formatT(NLOS_WINDOW[0])}, lost until ${formatT(NLOS_WINDOW[1])} and good again until the end`}
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
                  title={`${formatT(e.t_min)} to ${formatT(next.t_min)}: ${fmt(e.values.radio_rssi_dbm, 1)} dBm, link ${RADIO_WORD[level]}`}
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
            Radio shadow from {formatT(NLOS_WINDOW[0])} to {formatT(NLOS_WINDOW[1])}, in red: the link goes through the rover relay
            and the suit navigates on its own.
          </p>
        </div>

        <Disclosure summary="The EVA without a solar storm" className="mt-3">
          <div className="max-w-xl">
            <Row
              label="Background dose for the whole EVA"
              value={`${fmt(EVA07_DOC.final.dose_gcr_msv, 3)} mSv`}
            />
            <Row
              label="Return to Base from WP2"
              value={`${fmt(WB.base.time_min, 1)} min, ${fmt(WB.base.length_m)} m and ${fmt(WB.base.o2_liters, 1)} L of O₂`}
            />
            <p className="t-label text-ink-2 mt-1">
              Without a solar storm, returning to Base is feasible. With an SPE the limit is {fmt(WB.dose_budget_msv)} mSv per EVA and there
              are only {fmt(WB.open_sky_window_min)} min under open sky: that is why the switch to the shelter is simulated.
            </p>
          </div>
        </Disclosure>
      </section>

      {/* Simulación de imprevistos: el detalle; el veredicto y el botón están en la cabecera */}
      <Panel title="Contingency simulation">
        <p className="text-sm text-ink-2 max-w-3xl">
          The EVA is repeated with random contingencies at the worst moment, {formatT(WB.decision_t_min)}: solar storm of{' '}
          {fmt(WB.spe_rate_envelope_msv_h)} mSv/h, dust τ {fmt(WB.dust_tau, 1)}, radio shadow and the {SUIT_SCENARIO.wp2RampDeg}° ramp.
          Each run checks whether the astronaut ends up safe by switching to the WP3 shelter, and whether she would by returning to Base.
        </p>

        {!apiOnline && (
          <Notice level="amber" className="mt-3">
            The simulation runs on the compute engine, which is not responding. Only the mission reference is shown.
          </Notice>
        )}

        <div className="mt-3 overflow-x-auto">
          <table className="w-full max-w-3xl text-sm text-ink tabular-nums">
            <caption className="sr-only">Safe runs in this simulation and in the mission reference</caption>
            <thead>
              <tr className="t-label text-ink-3">
                <th scope="col" className="py-2 pr-4 font-normal text-left">Safe runs</th>
                <th scope="col" className="py-2 pl-4 font-normal text-right">With switch to WP3 shelter</th>
                <th scope="col" className="py-2 pl-4 font-normal text-right">Base only</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-line">
                <th scope="row" className="py-2 pr-4 text-left font-medium">
                  This simulation
                  {run && (
                    <span className="block t-label font-normal text-ink-3">
                      {fmt(run.report.trials)} runs, seed {run.seed}
                    </span>
                  )}
                </th>
                <td className="py-2 pl-4 text-right align-top font-semibold">
                  {run ? pct(run.report.survival_rate_with_shelter_pct) : running ? 'Simulating…' : 'Not simulated'}
                </td>
                <td className={`py-2 pl-4 text-right align-top font-semibold ${run && !WB.base_feasible ? 'text-danger-ink' : ''}`}>
                  {run ? pct(run.report.survival_rate_base_only_pct) : '—'}
                </td>
              </tr>
              <tr className="border-t border-line">
                <th scope="row" className="py-2 pr-4 text-left font-medium">
                  Mission reference
                  <span className="block t-label font-normal text-ink-3">
                    {fmt(REF.trials)} runs, seed {REF.seed}
                  </span>
                </th>
                <td className="py-2 pl-4 text-right align-top">
                  {pct(REF.report.survival_rate_with_shelter_pct)}
                  <span className="block t-label text-ink-3">
                    {count(REF.report.survived_with_wp3_shelter)} of {count(REF.trials)}
                  </span>
                </td>
                <td className="py-2 pl-4 text-right align-top">
                  {pct(REF.report.survival_rate_base_only_pct)}
                  <span className="block t-label text-ink-3">
                    {count(REF.report.survived_base_only)} of {count(REF.trials)}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <Disclosure summary="Simulation options" className="mt-2">
          <div className="flex flex-wrap items-end gap-3 pb-1">
            <label className="t-label text-ink-3">
              <span className="block mb-1">Number of runs</span>
              <select value={trials} onChange={(e) => setTrials(Number(e.target.value))} className={FIELD}>
                <option value={CHAOS_VISIBLE_TRIALS}>{CHAOS_VISIBLE_TRIALS} (quick)</option>
                <option value={REF.trials}>{fmt(REF.trials)} (same as reference)</option>
              </select>
            </label>
            <label className="t-label text-ink-3">
              <span className="block mb-1">Random seed</span>
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
              {running ? 'Simulating…' : simulateLabel}
            </Button>
          </div>
        </Disclosure>

        <Disclosure summary="Histogram and how it is computed">
          <div className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-5">
              <div>
                <h3 className="text-sm font-medium text-ink">With automatic switch to WP3 shelter</h3>
                <p className="t-label text-ink-2 mt-1">
                  Downhill escape of {fmt(WB.wp3.time_min, 1)} min and {fmt(WB.wp3.length_m)} m, with a dose of{' '}
                  {fmt(WB.wp3.dose_spe_msv, 2)} mSv:{' '}
                  {WB.wp3_within_open_sky_window ? 'fits in the open-sky window' : 'does not fit in the open-sky window'}. The
                  shelter (sky view {fmt(waypoint('WP3')?.svfScenario, 2)}, assumed value) blocks{' '}
                  {SUIT_SCENARIO.shelterAttenuationPct} % of the storm: {fmt(REFERENCE_FIGURES.wp3_rate_msv_h, 1)} mSv/h remain.
                </p>
                {run && (
                  <div className="mt-2">
                    <Row label="Safe" value={count(run.report.outcomes_with_shelter.safe)} />
                    <Row label="Dose limit exceeded" value={count(run.report.outcomes_with_shelter.flight_rule_breach)} />
                    <Row label="Destination not reached" value={count(run.report.outcomes_with_shelter.destination_not_reached)} />
                    <Row label="Switches to shelter" value={count(run.report.switched_to_shelter)} />
                  </div>
                )}
              </div>
              <div>
                <h3 className="text-sm font-medium text-ink">Return to Base only</h3>
                <p className="t-label text-ink-2 mt-1">
                  From WP2 it is {fmt(WB.base.time_min, 1)} min and {fmt(WB.base.length_m)} m of walking. The dose would be{' '}
                  <span className={WB.base_feasible ? undefined : 'text-danger-ink'}>{fmt(WB.base.dose_spe_msv, 2)} mSv</span>,{' '}
                  {fmt(WB.base.dose_spe_msv / WB.dose_budget_msv, 2)} times the {fmt(WB.dose_budget_msv)} mSv limit:{' '}
                  {WB.base_feasible ? 'feasible' : 'not feasible'} at {formatT(WB.decision_t_min)}.
                </p>
                {run && (
                  <div className="mt-2">
                    <Row label="Safe" value={count(run.report.outcomes_base_only.safe)} />
                    <Row label="Dose limit exceeded" value={count(run.report.outcomes_base_only.flight_rule_breach)} />
                    <Row label="Destination not reached" value={count(run.report.outcomes_base_only.destination_not_reached)} />
                    <Row label="Out of consumables" value={count(run.report.outcomes_base_only.consumables_lost)} />
                  </div>
                )}
              </div>
            </div>

            <ChaosHistogram chaos={chaos} />

            <div className="space-y-2 t-label text-ink-2 max-w-3xl">
              {cert && run && (
                <p>
                  Authorizing the route needs three things: the simulation finishes, the shelter does no worse than Base, and
                  the shelter result ({pct(cert.shelterPct)}) is within 3σ of the reference ({pct(cert.referencePct)};
                  σ = {fmt(cert.sigmaPct, 1)} pp with {fmt(run.trials)} runs).
                </p>
              )}
              <p>
                The simulation and the reference come from the same compute-engine model and the same terrain: a test corridor in
                Melas Chasma, not the exact route path, always walked in the same order. The reference is {fmt(REF.trials)}{' '}
                runs with seed {REF.seed}; the simulation uses the options you choose. With {CHAOS_VISIBLE_TRIALS} runs the
                margin of error (1σ) is ±{fmt(sigmaPct(REF.report.survival_rate_with_shelter_pct, CHAOS_VISIBLE_TRIALS), 1)} pp with
                shelter and ±{fmt(sigmaPct(REF.report.survival_rate_base_only_pct, CHAOS_VISIBLE_TRIALS), 1)} pp with Base only, so
                it is normal for them to differ. With {fmt(REF.trials)} runs and seed {REF.seed}, the simulation reproduces the
                reference.
              </p>
              <p>
                Model limits: the terrain of each leg is taken from its position in that corridor, not along the planned
                route; the only consumable modelled is primary O₂; the escape to the shelter counts as a single leg with{' '}
                {fmt(0.55, 2)} times the open-sky dose, and the return to Base as 14 normal legs from leg 6 onwards.
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
    { key: 'total', label: 'Simulated runs', swatch: 'bg-line-strong', values: report.trials_by_max_concurrent_hazards },
    { key: 'shelter', label: 'Safe with shelter', swatch: 'bg-ink', values: report.safe_with_shelter_by_max_concurrent },
    { key: 'base', label: 'Safe with Base only', swatch: 'bg-ink-3', values: report.safe_base_only_by_max_concurrent },
  ];
  const h = (v: number) => `${(v / max) * 100}%`;
  return (
    <div>
      <h3 className="text-sm font-medium text-ink">Runs by number of coinciding threats</h3>
      <p className="t-label text-ink-3 mt-0.5">
        {live ? 'Current simulation' : 'Mission reference'}, {fmt(n)} runs.
      </p>
      <div className="mt-3 overflow-x-auto">
        <div className="min-w-[280px] max-w-2xl">
          <div
            className="grid grid-cols-[9.5rem_repeat(5,minmax(0,1fr))] sm:grid-cols-[11rem_repeat(5,minmax(0,1fr))] gap-x-2 items-end"
            role="img"
            aria-label="Histogram of runs by number of coinciding threats; the figures are in the table below"
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
            <caption className="sr-only">Runs by number of coinciding threats</caption>
            <colgroup>
              <col className="w-[9.5rem] sm:w-[11rem]" />
            </colgroup>
            <thead>
              <tr className="text-ink-3">
                <th scope="col" className="py-1 font-normal text-left">Threats at once</th>
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
        Mean and margin of error (1σ): {pct(report.survival_rate_with_shelter_pct)} ± {fmt(sShelter, 1)} pp with shelter and{' '}
        {pct(report.survival_rate_base_only_pct)} ± {fmt(sBase, 1)} pp with Base only. A run is "safe" if it reaches its destination
        with an SPE dose of {fmt(red)} mSv or less and without running out of primary O₂.
      </p>
    </div>
  );
};
