import type { FeatureDetail } from '@gev/shared';
import { fmtAgo, fmtLat, fmtLon, fmtUtc, row, rows } from '../format.ts';
import { launchFeature, LAYER, type LaunchRecord } from './parse.ts';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Format NET honestly for its precision: a month-level NET is not a time. */
export function fmtNet(ms: number, precision: string | null): string {
  const d = new Date(ms);
  const iso = d.toISOString();
  switch (precision?.toLowerCase()) {
    case 'year':
      return `${d.getUTCFullYear()}`;
    case 'half year':
    case 'quarter':
    case 'month':
      return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
    case 'day':
      return `${iso.slice(0, 10)} (time not set)`;
    case 'hour':
      return `${iso.slice(0, 13).replace('T', ' ')}:xx UTC`;
    default:
      return fmtUtc(ms);
  }
}

const STATUS_TITLE: Record<string, string> = { success: 'Success', failure: 'Failure', partial: 'Partial failure', upcoming: 'Scheduled' };

export function buildLaunchDetail(l: LaunchRecord, now: number): FeatureDetail {
  const exact = !l.netPrecision || ['second', 'minute'].includes(l.netPrecision.toLowerCase());
  const windowDiffers = l.windowStart !== null && l.windowEnd !== null && l.windowEnd !== l.windowStart;
  const info = l.infoUrls[0];
  return {
    layer: LAYER,
    featureId: l.id,
    feature: launchFeature(l),
    title: l.label,
    subtitle: [l.vehicle, l.provider].filter(Boolean).join(' · ') || null,
    sections: [
      {
        title: 'Launch',
        rows: rows(
          row('Status', l.statusName ?? STATUS_TITLE[l.status]),
          row('NET', fmtNet(l.net, l.netPrecision), { hint: exact ? fmtAgo(now - l.net) : `${l.netPrecision?.toLowerCase()} precision`, mono: exact }),
          windowDiffers ? row('Window', `${fmtUtc(l.windowStart!)} to ${fmtUtc(l.windowEnd!)}`, { mono: true }) : null,
          row('Probability', l.probability !== null ? `${Math.round(l.probability)}%` : undefined, { hint: 'chance of launching in the window' }),
          row('Hold reason', l.holdReason),
          row('Failure reason', l.failReason),
          l.webcastLive ? row('Webcast', 'Live now') : null,
        ),
      },
      {
        title: 'Mission',
        rows: rows(
          row('Mission', l.mission),
          row('Type', l.missionType),
          row('Orbit', l.orbit),
          row('Description', l.missionDescription),
        ),
      },
      {
        title: 'Vehicle',
        rows: rows(row('Rocket', l.vehicle), row('Provider', l.provider, l.providerAbbrev ? { hint: l.providerAbbrev } : {})),
      },
      {
        title: 'Pad',
        rows: rows(
          row('Pad', l.padName),
          row('Site', l.locationName, l.country ? { hint: l.country } : {}),
          row('Coordinates', `${fmtLat(l.lat)}, ${fmtLon(l.lon)}`, { mono: true }),
        ),
      },
      {
        title: 'Links',
        rows: [
          ...l.vidUrls.slice(0, 3).map((v) => ({ label: 'Webcast', value: v.url, hint: v.title ?? undefined, mono: true })),
          ...l.infoUrls.slice(0, 3).map((v) => ({ label: 'Info', value: v.url, hint: v.title ?? undefined, mono: true })),
        ],
      },
    ].filter((sec) => sec.rows.length > 0),
    sources: ['Launch Library 2 (The Space Devs)'],
    ...(info ? { url: info.url } : {}),
  };
}
