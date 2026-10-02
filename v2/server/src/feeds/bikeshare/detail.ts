import type { Feature, FeatureDetail } from '@gev/shared';
import { fmtAgo, fmtInt, fmtLat, fmtLon, fmtUtc, row, rows } from '../format.ts';
import type { StationInfo, StationReading, StationState, StationStatus } from './gbfs.ts';
import type { IndexedSystem } from './systems.ts';

export const LAYER = 'bikeshare';
export const CATALOGUE_CREDIT = 'MobilityData GBFS systems catalogue (CC BY 3.0)';

const STATE_WORDS: Record<StationState, string> = {
  ok: 'Bikes to take and docks free',
  empty: 'No bike to take',
  full: 'No dock free',
  offline: 'Out of service',
  unknown: 'No reading',
};

export interface StationDetailInput {
  feature: Feature;
  system: IndexedSystem;
  station: StationInfo;
  status: StationStatus | undefined;
  reading: StationReading;
  /** When the status document was fetched (epoch ms). */
  fetchedAt: number | null;
  now: number;
}

/** Detail panel for one station; everything comes from the cached feed documents. */
export function buildStationDetail(i: StationDetailInput): FeatureDetail {
  const { system, station, status, reading } = i;
  const reported = status?.reportedAt ?? null;
  // A reading older than a day is shown but not claimed to be current.
  const reportedHint = reported !== null ? fmtAgo(i.now - reported) : undefined;
  const mech = status?.bikes != null && status.ebikes != null ? Math.max(0, status.bikes - status.ebikes) : null;
  const flags = status ? [status.installed ? null : 'Not installed', status.renting ? null : 'Not renting', status.returning ? null : 'Not accepting returns'].filter(Boolean).join(', ') : '';
  return {
    layer: LAYER,
    featureId: i.feature.id,
    feature: i.feature,
    title: station.name,
    subtitle: [system.name, system.location].filter(Boolean).join(' · '),
    sections: [
      {
        title: 'Availability',
        rows: rows(
          row('Right now', STATE_WORDS[reading.state]),
          row('Bikes', status?.bikes ?? undefined, mech !== null ? { hint: `${fmtInt(mech)} mechanical` } : {}),
          row('E-bikes', status?.ebikes ?? undefined, { hint: 'included in bikes' }),
          row('Free docks', status?.docks ?? undefined),
          row('Capacity', reading.capacity ?? undefined, station.capacity === null && reading.capacity !== null ? { hint: 'bikes plus free docks' } : {}),
          row('Docks with a bike', reading.fill !== null ? `${Math.round(reading.fill * 100)}%` : undefined),
          row('Service', flags || undefined),
        ),
      },
      {
        title: 'Station',
        rows: rows(
          row('Name', station.name),
          row('System', system.name),
          row('Place', system.location ? `${system.location}${system.country ? `, ${system.country}` : ''}` : undefined),
          row('Station id', station.id, { mono: true }),
          row('Coordinates', `${fmtLat(station.lat)}, ${fmtLon(station.lon)}`, { mono: true }),
        ),
      },
      {
        title: 'Source',
        rows: rows(
          row('Feed', 'GBFS station_status', { hint: system.name }),
          row('Station reported', reported !== null ? fmtUtc(reported) : undefined, { mono: true, ...(reportedHint ? { hint: reportedHint } : {}) }),
          row('Fetched', i.fetchedAt !== null ? fmtAgo(i.now - i.fetchedAt) : undefined),
          row('Operator site', system.website ? system.website.replace(/^https?:\/\//, '').replace(/\/$/, '') : undefined),
          row('Catalogue', CATALOGUE_CREDIT),
          row('Licence', 'Set by the operator', { hint: 'each system publishes under its own terms' }),
        ),
      },
    ].filter((s) => s.rows.length > 0),
    sources: [`${system.name} (GBFS)`, CATALOGUE_CREDIT],
    ...(system.website ? { url: system.website } : {}),
  };
}
