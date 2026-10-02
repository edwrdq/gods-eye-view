import type { FeatureDetail } from '@gev/shared';
import { fmtLat, fmtLon, row, rows } from '../format.ts';
import type { StaticEntry } from '../static/static-feed.ts';
import { classLabel, installationFeature, LAYER, type Installation } from './parse.ts';

export const OVERTURE_CREDIT = 'Overture Maps Foundation';

export interface InstallationMeta {
  release: string | null;
  snapshots: string[];
}

function fmtArea(m2: number): string | undefined {
  if (!(m2 > 0)) return undefined;
  const km2 = m2 / 1e6;
  if (km2 >= 100) return `${Math.round(km2).toLocaleString('en-US')} km²`;
  if (km2 >= 1) return `${km2.toFixed(1)} km²`;
  return `${Math.round(m2 / 1e4).toLocaleString('en-US')} ha`;
}

const osmUrl = (id: string): string => {
  const kind = id[0] === 'r' ? 'relation' : id[0] === 'w' ? 'way' : 'node';
  return `https://www.openstreetmap.org/${kind}/${id.slice(1)}`;
};

export function buildInstallationDetail(entry: StaticEntry<Installation>, meta: InstallationMeta): FeatureDetail {
  const i = entry.data;
  const [w, s, e, n] = i.bounds;
  return {
    layer: LAYER,
    featureId: entry.id,
    feature: installationFeature(i),
    title: i.name,
    subtitle: `${classLabel(i.cls)} · mapped military area`,
    sections: [
      {
        title: 'Site',
        rows: rows(
          row('Name', i.name),
          row('Type', classLabel(i.cls), { hint: 'how the area is mapped, not its current use' }),
          row('Mapped area', fmtArea(i.areaM2), { hint: 'of the military area polygon' }),
        ),
      },
      {
        title: 'Location',
        rows: rows(
          row('Label point', `${fmtLat(i.lat)}, ${fmtLon(i.lon)}`, { mono: true }),
          row('Extent', `${fmtLat(s)} to ${fmtLat(n)}, ${fmtLon(w)} to ${fmtLon(e)}`, { mono: true, hint: 'bounding box of the area' }),
          row('OSM id', i.id, { mono: true }),
        ),
      },
      {
        title: 'Source',
        rows: rows(
          row('Feed', 'OpenStreetMap military areas, bundled name index'),
          row('Credit', `© OpenStreetMap contributors, via ${OVERTURE_CREDIT}`),
          row('Licence', 'ODbL 1.0', { hint: 'open database licence; share-alike applies to the data' }),
          row('Overture release', meta.release ?? undefined, { mono: true }),
          row('OSM snapshot', meta.snapshots.join(', ') || undefined, { mono: true }),
          row('Caution', 'A mapped area does not show current activity, ownership or complete coverage.'),
        ),
      },
    ].filter((sec) => sec.rows.length > 0),
    sources: [`OpenStreetMap via ${OVERTURE_CREDIT} (© OpenStreetMap contributors, ODbL 1.0)`],
    url: osmUrl(i.id),
  };
}
