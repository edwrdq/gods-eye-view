import type { DetailSection, ObjectDetail, OrbitalElements } from '@gev/shared';
import { formatLatLonHemi } from './format.ts';
import { formatDuration, formatUtc } from './time.ts';
import { tleSummary } from './tle.ts';

export interface SatLiveState {
  lon: number;
  lat: number;
  /** Metres above the ellipsoid. */
  alt: number;
  /** Inertial speed, km/s. */
  speedKms: number;
}

const km = (v: number, digits = 0) => `${v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })} km`;

/** Group names in plain words for the panel. */
export function groupLabel(group: string): string {
  const names: Record<string, string> = {
    stations: 'Space stations',
    visual: 'Brightest (visual)',
    'gps-ops': 'GPS',
    'glo-ops': 'GLONASS',
    galileo: 'Galileo',
    beidou: 'BeiDou',
    weather: 'Weather',
    science: 'Science',
    geo: 'Geostationary',
    starlink: 'Starlink',
  };
  return names[group] ?? group;
}

/**
 * Detail panel content for a satellite, built in the browser from its element set and a
 * propagated state. `tMs` is the instant the state describes (viewed time or now).
 */
export function buildSatelliteDetail(el: OrbitalElements, state: SatLiveState | null, tMs: number, now: number): ObjectDetail {
  const sum = tleSummary(el.tle1, el.tle2);
  const sections: DetailSection[] = [];
  const position: DetailSection = { title: 'Position', rows: [] };
  if (state) {
    position.rows.push(
      { label: 'Coordinates', value: formatLatLonHemi(state.lat, state.lon, 3), mono: true },
      { label: 'Altitude', value: km(state.alt / 1000), hint: 'above the ellipsoid' },
      { label: 'Speed', value: `${state.speedKms.toFixed(2)} km/s`, hint: `${Math.round(state.speedKms * 3600).toLocaleString('en-US')} km/h` },
    );
  } else {
    position.rows.push({ label: 'Position', value: 'Not available', hint: 'the element set no longer propagates' });
  }
  sections.push(position);
  if (sum) {
    const rows = [
      { label: 'Inclination', value: `${sum.inclinationDeg.toFixed(2)}°` },
      { label: 'Period', value: `${sum.periodMin.toFixed(1)} min`, hint: `${sum.meanMotion.toFixed(2)} orbits per day` },
      { label: 'Perigee', value: km(sum.perigeeKm) },
      { label: 'Apogee', value: km(sum.apogeeKm) },
    ];
    sections.push({ title: 'Orbit', rows });
  }
  sections.push({
    title: 'Identity',
    rows: [
      { label: 'NORAD ID', value: el.noradId, mono: true },
      ...(sum?.designator ? [{ label: 'Designator', value: sum.designator, mono: true }] : []),
      { label: 'Group', value: groupLabel(el.group) },
    ],
  });
  sections.push({
    title: 'Source',
    rows: [
      { label: 'Elements', value: 'CelesTrak', hint: `epoch ${formatDuration(Math.max(0, now - el.epoch))} old` },
      { label: 'Epoch (UTC)', value: formatUtc(el.epoch), mono: true },
      { label: 'Computed', value: 'Predicted by SGP4', hint: 'in this browser' },
    ],
  });
  return {
    layer: 'satellites',
    objectId: el.noradId,
    observation: {
      layer: 'satellites',
      objectId: el.noradId,
      t: tMs,
      lon: state?.lon ?? 0,
      lat: state?.lat ?? 0,
      alt: state?.alt,
      speed: state ? state.speedKms * 1000 : undefined,
      props: { group: el.group, epoch: el.epoch },
    },
    title: el.name,
    subtitle: `NORAD ${el.noradId} · ${groupLabel(el.group)}`,
    sections,
    sources: ['CelesTrak'],
    live: true,
  };
}
