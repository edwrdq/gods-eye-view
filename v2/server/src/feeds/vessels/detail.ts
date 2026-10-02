import type { DetailSection, ObjectDetail, Observation } from '@gev/shared';
import { compass } from '../../geo.ts';
import { fmtInt, fmtLat, fmtLon, fmtUtc, pad3, row, rows } from '../format.ts';
import { KNOT_TO_MPS } from '../flights/parse.ts';
import { LAYER } from './parse.ts';

const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

export function buildVesselDetail(obs: Observation, historical: boolean): ObjectDetail {
  const p = obs.props;
  const name = str(p.name);
  const category = str(p.category);
  const kn = obs.speed === undefined ? undefined : obs.speed / KNOT_TO_MPS;
  const cog = num(p.cog);

  const sections: DetailSection[] = [
    {
      title: 'Position',
      rows: rows(
        row('Latitude', fmtLat(obs.lat), { mono: true }),
        row('Longitude', fmtLon(obs.lon), { mono: true }),
        kn === undefined ? null : row('Speed over ground', `${kn.toFixed(1)} kt`, { hint: `${fmtInt(kn * 1.852)} km/h` }),
        cog === undefined ? null : row('Course over ground', `${pad3(cog)}°`, { hint: compass(cog) }),
        obs.heading === undefined || obs.heading === cog ? null : row('Heading', `${pad3(obs.heading)}°`, { hint: compass(obs.heading) }),
        row('Status', str(p.navStatus)),
      ),
    },
    {
      title: 'Vessel',
      rows: rows(
        row('Name', name),
        row('MMSI', obs.objectId, { mono: true }),
        row('IMO', str(p.imo), { mono: true }),
        row('Call sign', str(p.callsign), { mono: true }),
        row('Type', category, num(p.shipType) !== undefined ? { hint: `AIS type ${num(p.shipType)}` } : {}),
        num(p.length) === undefined ? null : row('Length', `${fmtInt(num(p.length)!)} m`),
        num(p.beam) === undefined ? null : row('Beam', `${fmtInt(num(p.beam)!)} m`),
        num(p.draught) === undefined ? null : row('Max draught', `${num(p.draught)!.toFixed(1)} m`),
      ),
    },
  ];
  const voyage = rows(row('Destination', str(p.destination)), row('ETA', str(p.eta), { hint: 'UTC, as reported' }));
  if (voyage.length) sections.push({ title: 'Voyage', rows: voyage });
  sections.push({
    title: 'Source',
    rows: rows(
      row('Feed', 'AISStream'),
      row('Received', fmtUtc(obs.t), { mono: true }),
      historical ? row('Mode', 'Recorded history') : null,
    ),
  });

  return {
    layer: LAYER,
    objectId: obs.objectId,
    observation: obs,
    title: name ?? `MMSI ${obs.objectId}`,
    subtitle: [category, str(p.destination) ? `to ${str(p.destination)}` : undefined].filter(Boolean).join(' · ') || null,
    sections,
    sources: ['AISStream'],
  };
}
