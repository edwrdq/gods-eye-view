import type { Feature, FeatureDetail } from '@gev/shared';
import { compass } from '../../geo.ts';
import { fmtAgo, fmtInt, fmtLat, fmtLon, fmtUtc, row, rows } from '../format.ts';
import { categoryFromWind, className, LAYER, stormCategory, type StormGeometry, type StormStatus } from './parse.ts';

const BASINS: Record<string, string> = { AL: 'Atlantic', EP: 'Eastern North Pacific', CP: 'Central North Pacific' };
const KT_TO_MPH = 1.15078;
const KT_TO_KMH = 1.852;

const wind = (kt: number): string => `${fmtInt(kt)} kt`;
const windHint = (kt: number): string => `${fmtInt(kt * KT_TO_MPH)} mph · ${fmtInt(kt * KT_TO_KMH)} km/h`;

/** Detail panel for any feature of a storm (position, track, forecast, cone). */
export function buildStormDetail(s: StormStatus, g: StormGeometry | undefined, feature: Feature, now: number): FeatureDetail {
  const cat = stormCategory(s.classification, s.windKt);
  const forecast = (g?.forecastPoints ?? []).filter((p) => p.tauHours > 0);
  const movement =
    s.movementDir !== null && s.movementKt !== null
      ? s.movementKt === 0
        ? 'Stationary'
        : `${compass(s.movementDir)} (${Math.round(s.movementDir)}°) at ${fmtInt(s.movementKt)} kt`
      : undefined;
  return {
    layer: LAYER,
    featureId: feature.id,
    feature,
    title: `${className(s.classification)} ${s.name}`,
    subtitle: `${BASINS[s.basin] ?? s.basin} · ${s.id.toUpperCase()}`,
    sections: [
      {
        title: 'Current',
        rows: rows(
          row('Classification', className(s.classification), { hint: cat !== s.classification ? cat : undefined }),
          row('Sustained wind', s.windKt !== null ? wind(s.windKt) : undefined, s.windKt !== null ? { hint: windHint(s.windKt) } : {}),
          row('Central pressure', s.pressureMb !== null ? `${fmtInt(s.pressureMb)} mb` : undefined),
          row('Movement', movement),
          row('Position', `${fmtLat(s.lat)}, ${fmtLon(s.lon)}`, { mono: true }),
          row('Position time (UTC)', fmtUtc(s.positionAt), { hint: fmtAgo(now - s.positionAt), mono: true }),
          row('Advisory', `#${s.advisoryNumber}`, { hint: `issued ${fmtUtc(s.issuedAt)}` }),
        ),
      },
      {
        title: 'Forecast',
        rows: [
          ...(g && g.cone.length > 0
            ? [{ label: 'Cone', value: 'Likely path of the centre', hint: 'not the size of the storm or its hazard area' }]
            : []),
          ...forecast.map((p) => ({
          label: `+${p.tauHours} h`,
          value: p.windKt !== null ? wind(p.windKt) : 'n/a',
          hint: [categoryFromWind(p.windKt), `${fmtLat(p.lat)}, ${fmtLon(p.lon)}`, fmtUtc(s.issuedAt + p.tauHours * 3_600_000)].filter(Boolean).join(' · '),
          })),
        ],
      },
    ].filter((sec) => sec.rows.length > 0),
    sources: ['NOAA NHC', ...(s.basin === 'CP' || s.advisoryUrl?.includes('/HFO') ? ['NOAA CPHC'] : [])],
    ...(s.advisoryUrl ?? s.graphicsUrl ? { url: (s.advisoryUrl ?? s.graphicsUrl)! } : {}),
  };
}
