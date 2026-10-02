import type { FeatureDetail } from '@gev/shared';
import { compass } from '../../geo.ts';
import { fmtAgo, fmtLat, fmtLon, fmtUtc, pad3, row, rows } from '../format.ts';
import { cameraFeature, type Camera } from './camera.ts';
import type { CameraSource } from './sources/types.ts';

/** What the "Facing" row says about where the direction comes from. */
export function headingWords(c: Pick<Camera, 'headingConfidence' | 'headingBasis'>, provider: string): string {
  switch (c.headingBasis) {
    case 'published':
      return `${provider} publishes which way this camera faces.`;
    case 'name':
      return 'Read from the camera name, which gives a travel direction (such as "EB" for eastbound).';
    case 'curated':
      return 'Worked out by hand from imagery and map data by the original app\'s maintainers.';
    case 'placeholder':
      return 'The source does not say which way this camera faces. The direction shown is a placeholder taken from the camera id. It is not a measurement and can be wrong, so the map draws no wedge for it.';
  }
}

export function refreshWords(refreshS: number): string {
  if (refreshS < 90) return `about every ${refreshS} s`;
  const m = Math.round(refreshS / 60);
  return `about every ${m} min`;
}

export interface CameraDetailInput {
  camera: Camera;
  source: CameraSource;
  /** Seconds between pictures the server will fetch for this camera. */
  refreshS: number;
  /** Picture time known from a fetched picture, else the list's. */
  frameTime: number | null;
}

export function buildCameraDetail(i: CameraDetailInput, now: number = Date.now()): FeatureDetail {
  const { camera: c, source } = i;
  const video = c.type === 'video';
  const time = i.frameTime ?? c.imageTime ?? null;
  const feature = cameraFeature(c, source.name, true);
  if (!video) feature.props.refreshS = i.refreshS;
  if (time !== null) feature.props.imageTime = time;
  return {
    layer: 'cctv',
    featureId: c.id,
    feature,
    title: c.name,
    subtitle: [c.city, source.name].filter((v, k, a) => v && a.indexOf(v) === k).join(' · '),
    sections: [
      {
        title: 'View',
        rows: rows(
          row('Facing', `${compass(c.heading)} ${pad3(c.heading)}°`, { mono: true, hint: c.headingConfidence === 'known' ? 'known' : 'estimated' }),
          row('Heading', headingWords(c, source.provider)),
        ),
      },
      {
        title: video ? 'Video' : 'Picture',
        rows: rows(
          row('Kind', video ? 'Live video stream' : 'Still picture, refreshed by the source'),
          video ? row('In this app', 'Plays here only where your browser plays HLS; otherwise open the stream') : row('New picture', refreshWords(i.refreshS), { hint: 'the app asks no faster' }),
          time !== null ? row('Last picture', fmtUtc(time), { mono: true, hint: fmtAgo(now - time) }) : null,
        ),
      },
      {
        title: 'Location',
        rows: rows(row('Coordinates', `${fmtLat(c.lat)}, ${fmtLon(c.lon)}`, { mono: true }), row('Place', c.city)),
      },
      {
        title: 'Source',
        rows: rows(
          row('Operator', source.provider),
          row('Credit', c.credit),
          row('Terms', source.licence),
          row('Attribution', source.attribution),
          row('Camera id', c.id, { mono: true }),
        ),
      },
    ].filter((s) => s.rows.length > 0),
    sources: [source.attribution || source.provider],
    url: source.pageUrl,
  };
}
