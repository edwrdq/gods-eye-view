import type { DetailRow, FeatureDetail } from '@gev/shared';
import { fmtInt, fmtLat, fmtLon, row, rows } from '../format.ts';
import type { StaticEntry } from '../static/static-feed.ts';
import { cableFeature, landingFeature, LAYER, LANDING_MATCH_KM, type Cable, type LandingPoint } from './parse.ts';

export const TELEGEOGRAPHY_SITE = 'https://www.submarinecablemap.com';
export const TELEGEOGRAPHY_CREDIT = '© TeleGeography, submarinecablemap.com';
export const TELEGEOGRAPHY_LICENCE = 'CC BY-NC-SA 3.0 (non-commercial, share-alike)';
export const SOURCE_NAME = 'TeleGeography Submarine Cable Map';

export type CableData =
  | { kind: 'cable'; cable: Cable; landings: LandingPoint[] }
  | { kind: 'landing'; landing: LandingPoint; cables: Cable[] };

const MAX_ROWS = 60;

function sourceSection(snapshot: string) {
  return {
    title: 'Source',
    rows: rows(
      row('Feed', SOURCE_NAME),
      row('Credit', TELEGEOGRAPHY_CREDIT),
      row('Licence', TELEGEOGRAPHY_LICENCE, { hint: 'bundled snapshot; remove it for commercial use' }),
      row('Snapshot', snapshot, { mono: true }),
    ),
  };
}

export function buildCableDetail(entry: StaticEntry<CableData>, snapshot: string): FeatureDetail {
  const d = entry.data;
  if (d.kind === 'cable') {
    const c = d.cable;
    const landingRows: DetailRow[] = d.landings.slice(0, MAX_ROWS).map((l) => ({ label: l.place, value: l.country ?? '', ...(l.tbd ? { hint: 'location to be determined' } : {}) }));
    const more = d.landings.length - landingRows.length;
    return {
      layer: LAYER,
      featureId: entry.id,
      feature: cableFeature(c),
      title: c.name,
      subtitle: `Submarine cable${d.landings.length ? ` · ${d.landings.length} landing point${d.landings.length === 1 ? '' : 's'}` : ''}`,
      sections: [
        {
          title: 'Cable',
          rows: rows(
            row('Name', c.name),
            row('Route length', `${fmtInt(c.lengthKm)} km`, { hint: 'measured along the drawn route; not the published length' }),
            row('Route parts', c.parts.length > 1 ? c.parts.length : undefined, { hint: 'main line and branches' }),
            row('Owners', 'Not in the bundled data', { hint: 'see the TeleGeography page' }),
            row('Ready for service', 'Not in the bundled data', { hint: 'see the TeleGeography page' }),
          ),
        },
        {
          title: 'Landing points',
          rows: [
            ...landingRows,
            ...rows(row('And more', more > 0 ? `${more} further landing points` : undefined)),
            ...rows(
              d.landings.length === 0
                ? row('Landing points', 'None matched', { hint: `no landing point within ${LANDING_MATCH_KM} km of a route end` })
                : row('How matched', `within ${LANDING_MATCH_KM} km of a route end`, { hint: 'derived from the map geometry' }),
            ),
          ],
        },
        sourceSection(snapshot),
      ].filter((s) => s.rows.length > 0),
      sources: [`${SOURCE_NAME} (${TELEGEOGRAPHY_CREDIT}, ${TELEGEOGRAPHY_LICENCE})`],
      url: `${TELEGEOGRAPHY_SITE}/submarine-cable/${encodeURIComponent(c.slug)}`,
    };
  }
  const l = d.landing;
  const cableRows: DetailRow[] = d.cables.slice(0, MAX_ROWS).map((c) => ({ label: c.name, value: `${fmtInt(c.lengthKm)} km` }));
  return {
    layer: LAYER,
    featureId: entry.id,
    feature: landingFeature(l),
    title: l.place,
    subtitle: `Cable landing point${l.country ? ` · ${l.country}` : ''}`,
    sections: [
      {
        title: 'Landing point',
        rows: rows(
          row('Place', l.place),
          row('Country', l.country),
          row('Cables', d.cables.length, { hint: 'systems whose route ends here' }),
          row('Status', l.tbd ? 'Location to be determined' : undefined),
          row('Coordinates', `${fmtLat(l.lat)}, ${fmtLon(l.lon)}`, { mono: true }),
        ),
      },
      { title: 'Cables landing here', rows: cableRows },
      sourceSection(snapshot),
    ].filter((s) => s.rows.length > 0),
    sources: [`${SOURCE_NAME} (${TELEGEOGRAPHY_CREDIT}, ${TELEGEOGRAPHY_LICENCE})`],
    url: `${TELEGEOGRAPHY_SITE}/landing-point/${encodeURIComponent(l.slug)}`,
  };
}
