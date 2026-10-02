import type { DetailSection, ObjectDetail, Observation } from '@gev/shared';
import { compass } from '../../geo.ts';
import { fmtInt, fmtLat, fmtLon, fmtUtc, pad3, row, rows } from '../format.ts';
import type { AircraftInfo, RouteInfo } from './enrich.ts';
import { FOOT_TO_M, FPM_TO_MPS, KNOT_TO_MPS, LAYER } from './parse.ts';

const POSITION_SOURCE: Record<string, { value: string; hint?: string }> = {
  adsb: { value: 'Reported by aircraft', hint: 'not estimated' },
  adsc: { value: 'Reported by aircraft via satellite' },
  mlat: { value: 'Multilateration', hint: 'estimated from receivers' },
  tisb: { value: 'Ground station rebroadcast', hint: 'TIS-B' },
  flarm: { value: 'FLARM' },
  asterix: { value: 'Radar (ASTERIX)' },
  modes: { value: 'Mode S' },
};

const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);
const numOrUndef = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

function altitudeRow(p: Observation['props'], alt: number | undefined) {
  if (p.onGround === true) return row('Altitude', 'On ground');
  const baro = numOrUndef(p.altBaro);
  const geom = numOrUndef(p.altGeom);
  const shown = baro ?? geom ?? alt;
  if (shown === undefined) return null;
  const ft = shown / FOOT_TO_M;
  const level = baro !== undefined ? (ft >= 18000 ? `FL${String(Math.round(ft / 100)).padStart(3, '0')}` : `${fmtInt(ft)} ft`) : `${fmtInt(ft)} ft`;
  return row('Altitude', `${fmtInt(shown)} m`, { hint: `${level} · ${baro !== undefined ? 'barometric' : 'geometric'}` });
}

function verticalRow(p: Observation['props']) {
  const v = numOrUndef(p.vrate);
  if (v === undefined) return null;
  const fpm = v / FPM_TO_MPS;
  const hint = Math.abs(fpm) < 100 ? 'level' : fpm > 0 ? 'climbing' : 'descending';
  return row('Vertical rate', `${fmtInt(fpm)} ft/min`, { hint });
}

/**
 * Build the flight detail panel. `aircraft` and `route` are optional enrichment;
 * everything renders from the observation alone when they are null.
 */
export function buildFlightDetail(
  obs: Observation,
  enrichment: { aircraft: AircraftInfo | null; route: RouteInfo | null },
  historical: boolean,
): ObjectDetail {
  const p = obs.props;
  const { aircraft, route } = enrichment;
  const callsign = str(p.callsign);
  const registration = str(p.registration) ?? aircraft?.registration ?? undefined;
  const typeCode = str(p.typeCode) ?? aircraft?.typeCode ?? undefined;
  const typeName = aircraft?.typeName ?? str(p.typeName);
  const operator = route?.airline ?? str(p.operator) ?? aircraft?.owner ?? undefined;
  const hex = obs.objectId.toUpperCase();

  const kt = obs.speed === undefined ? undefined : obs.speed / KNOT_TO_MPS;
  const position: DetailSection = {
    title: 'Position',
    rows: rows(
      row('Latitude', fmtLat(obs.lat), { mono: true }),
      row('Longitude', fmtLon(obs.lon), { mono: true }),
      altitudeRow(p, obs.alt),
      kt === undefined ? null : row('Ground speed', `${fmtInt(kt)} kt`, { hint: `${fmtInt(kt * 1.852)} km/h` }),
      obs.heading === undefined ? null : row('Heading', `${pad3(obs.heading)}°`, { hint: compass(obs.heading) }),
      verticalRow(p),
    ),
  };

  const aircraftSection: DetailSection = {
    title: 'Aircraft',
    rows: rows(
      row('Registration', registration, { mono: true }),
      row('Type', typeName ?? typeCode, typeName && typeCode ? { hint: typeCode } : {}),
      row('Operator', operator),
      row('ICAO address', hex, { mono: true }),
      row('Squawk', str(p.squawk), { mono: true }),
      row('Category', str(p.category)),
      p.military === true ? row('Military', 'Yes', { hint: 'flagged in ADS-B database' }) : null,
      row('Registered in', str(p.country) ?? aircraft?.country ?? undefined),
    ),
  };

  const sections: DetailSection[] = [position, aircraftSection];

  if (route) {
    sections.push({
      title: 'Route',
      rows: rows(
        row('Origin', route.origin.name || route.origin.code, route.origin.name && route.origin.code ? { hint: route.origin.code } : {}),
        row('Destination', route.destination.name || route.destination.code, route.destination.name && route.destination.code ? { hint: route.destination.code } : {}),
        row('Airline', route.airline ?? undefined),
      ),
    });
  }

  const posSrc = typeof p.posSrc === 'string' ? POSITION_SOURCE[p.posSrc] : undefined;
  const sources = [str(p.src) ?? 'ADS-B'];
  if (aircraft || route) sources.push('adsbdb');
  sections.push({
    title: 'Source',
    rows: rows(
      row('Feed', sources[0]),
      row('Received', fmtUtc(obs.t), { mono: true }),
      posSrc ? row('Position', posSrc.value, posSrc.hint ? { hint: posSrc.hint } : {}) : null,
      historical ? row('Mode', 'Recorded history') : null,
    ),
  });

  const subtitle = [typeName ?? typeCode, registration, operator].filter(Boolean).join(' · ');
  return {
    layer: LAYER,
    objectId: obs.objectId,
    observation: obs,
    title: callsign ?? registration ?? hex,
    subtitle: subtitle || null,
    sections,
    sources,
  };
}
