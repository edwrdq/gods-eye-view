import type { FeatureDetail } from '@gev/shared';
import type { FeatureRow } from '../../db/features.ts';
import { fmtAgo, fmtLat, fmtLon, fmtUtc, row, rows } from '../format.ts';
import { LAYER } from './parse.ts';

const PAGER: Record<string, string> = {
  green: 'Green: little or no damage expected',
  yellow: 'Yellow: some damage possible, local response',
  orange: 'Orange: significant damage likely, regional response',
  red: 'Red: extensive damage likely, national or international response',
};

export const EVENT_PAGE = (id: string): string => `https://earthquake.usgs.gov/earthquakes/eventpage/${encodeURIComponent(id)}`;

const s = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);
const n = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** Detail panel for one stored event. Works offline: everything comes from the row. */
export function buildQuakeDetail(r: FeatureRow, now: number): FeatureDetail {
  const p = r.props;
  const x = r.extra;
  const mag = n(p.mag);
  const type = s(p.type) ?? 'earthquake';
  const felt = n(x.felt);
  const alert = s(p.alert);
  const url = s(x.url) ?? EVENT_PAGE(r.id);
  const magType = s(x.magType);

  return {
    layer: LAYER,
    featureId: r.id,
    feature: {
      id: r.id,
      geometry: { type: 'Point', coordinates: [r.lon, r.lat] },
      t: r.t,
      ...(r.label ? { label: r.label } : {}),
      props: p,
    },
    title: mag !== undefined ? `M ${mag.toFixed(1)} ${type === 'earthquake' ? 'earthquake' : type}` : type,
    subtitle: s(p.place) ?? null,
    sections: [
      {
        title: 'Event',
        rows: rows(
          row('Magnitude', mag !== undefined ? mag.toFixed(1) : undefined, magType ? { hint: magType } : {}),
          row('Type', type),
          row('Depth', n(p.depthKm) !== undefined ? `${n(p.depthKm)!.toFixed(1)} km` : undefined),
          row('Status', s(x.status), { hint: s(x.status) === 'reviewed' ? 'checked by a seismologist' : 'computed automatically' }),
          row('Significance', n(x.sig), { hint: '0 to 1000, combines magnitude and impact' }),
        ),
      },
      {
        title: 'When and where',
        rows: rows(
          row('Time (UTC)', fmtUtc(r.t), { hint: fmtAgo(now - r.t), mono: true }),
          row('Location', s(p.place)),
          row('Coordinates', `${fmtLat(r.lat)}, ${fmtLon(r.lon)}`, { mono: true }),
          row('Last updated', fmtUtc(r.updated), { hint: fmtAgo(now - r.updated), mono: true }),
        ),
      },
      {
        title: 'Impact',
        rows: rows(
          row('Felt reports', felt, { hint: 'USGS "Did You Feel It?"' }),
          row('Community intensity', n(x.cdi), { hint: 'maximum, from felt reports' }),
          row('Instrumental intensity', n(x.mmi), { hint: 'maximum ShakeMap MMI' }),
          row('PAGER alert', alert ? alert.toUpperCase() : undefined, alert ? { hint: PAGER[alert] } : {}),
          row('Tsunami flag', p.tsunami === true ? 'Set' : 'Not set', {
            hint: p.tsunami === true ? 'large event in an oceanic region; does not mean a tsunami occurred' : undefined,
          }),
        ),
      },
      {
        title: 'Network',
        rows: rows(
          row('Contributing network', s(x.net), { mono: true }),
          row('Stations used', n(x.nst)),
          row('Azimuthal gap', n(x.gap) !== undefined ? `${n(x.gap)}°` : undefined),
          row('Nearest station', n(x.dmin) !== undefined ? `${n(x.dmin)}°` : undefined, { hint: 'distance in degrees' }),
          row('RMS residual', n(x.rms), { hint: 'seconds' }),
          row('Event ID', r.id, { mono: true }),
        ),
      },
    ].filter((sec) => sec.rows.length > 0),
    sources: ['USGS Earthquake Hazards Program'],
    url,
  };
}
