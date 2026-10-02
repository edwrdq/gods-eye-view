import type { FeatureDetail } from '@gev/shared';
import { fmtInt, fmtLat, fmtLon, row, rows } from '../format.ts';
import type { StaticEntry } from '../static/static-feed.ts';
import { datacenterFeature, displayName, LAYER, type Datacenter } from './parse.ts';

export const OSM_CREDIT = '© OpenStreetMap contributors';
export const ODBL = 'ODbL 1.0';

const httpUrl = (v: string | undefined): string | undefined => {
  if (!v) return undefined;
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : undefined;
  } catch {
    return undefined;
  }
};

/** Detail panel for one datacenter; everything comes from memory. */
export function buildDatacenterDetail(entry: StaticEntry<Datacenter>): FeatureDetail {
  const d = entry.data;
  const t = d.tags;
  const name = displayName(d);
  const website = httpUrl(t.website ?? t['contact:website']);
  const alt = [t.alt_name, t.short_name, t.old_name && `formerly ${t.old_name}`].filter(Boolean).join(', ');
  return {
    layer: LAYER,
    featureId: entry.id,
    feature: datacenterFeature(d),
    title: name,
    subtitle: d.operator && d.operator !== name ? d.operator : 'Data center',
    sections: [
      {
        title: 'Facility',
        rows: rows(
          row('Name', d.name),
          row('Also known as', alt || undefined),
          row('Operator', d.operator, t['operator:short'] && t['operator:short'] !== d.operator ? { hint: t['operator:short'] } : {}),
          row('Owner', t.owner),
          row('Reference', t.ref, { mono: true }),
          row('Website', website ? website.replace(/^https?:\/\//, '').replace(/\/$/, '') : undefined),
          row('Description', t.description),
        ),
      },
      {
        title: 'Building',
        rows: rows(
          row('Footprint', d.areaM2 !== null && d.areaM2 > 0 ? `${fmtInt(d.areaM2)} m²` : undefined, { hint: 'from the mapped outline' }),
          row('Floors', t['building:levels']),
          row('Height', t.height),
          row('Opened', t.start_date),
          row('Mapped as', d.mapped === 'outline' ? 'Building outline' : 'Single point'),
        ),
      },
      {
        title: 'Capacity',
        rows: rows(row('Power', t['data_center:power'], { hint: 'as tagged in OpenStreetMap' }), row('IT load', t['capacity:it_load']), row('Capacity', t.capacity)),
      },
      {
        title: 'Location',
        rows: rows(row('Coordinates', `${fmtLat(d.lat)}, ${fmtLon(d.lon)}`, { mono: true }), row('OSM id', d.id, { mono: true })),
      },
      {
        title: 'Source',
        rows: rows(
          row('Feed', 'OpenStreetMap data center extract'),
          row('Credit', OSM_CREDIT),
          row('Licence', ODBL, { hint: 'open database licence; share-alike applies to the data' }),
          row('Snapshot', '2026-09-10 or earlier', { hint: 'extraction date was not recorded' }),
          row('Coverage', 'Incomplete', { hint: 'only what mappers have tagged; no capacity or status guarantees' }),
        ),
      },
    ].filter((s) => s.rows.length > 0),
    sources: [`OpenStreetMap (${OSM_CREDIT}, ${ODBL})`],
    ...(website ? { url: website } : {}),
  };
}
