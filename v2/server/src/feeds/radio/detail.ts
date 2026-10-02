import type { FeatureDetail } from '@gev/shared';
import { fmtAgo, fmtInt, fmtLat, fmtLon, row, rows } from '../format.ts';
import { LAYER, playMode, stationFeature, type Station } from './parse.ts';

export const RADIO_CREDIT = 'Radio Browser (radio-browser.info), community directory';

const host = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

/** Detail panel for one station. The stream address rides in feature.props.streamUrl for the panel's player. */
export function buildStationDetail(s: Station, listedAt: number | null, now: number = Date.now()): FeatureDetail {
  const place = [s.state, s.country].filter(Boolean).join(', ');
  const mode = playMode(s);
  return {
    layer: LAYER,
    featureId: s.id,
    feature: stationFeature(s, true),
    title: s.name,
    subtitle: place || 'Radio station',
    sections: [
      {
        title: 'Station',
        rows: rows(
          row('Country', s.country ? (s.countryCode ? `${s.country} (${s.countryCode})` : s.country) : undefined),
          row('Region', s.state || undefined),
          row('Language', s.languages.join(', ') || undefined),
          row('Tags', s.tags.join(', ') || undefined),
          row('Website', s.homepage ? s.homepage.replace(/^https?:\/\//, '').replace(/\/$/, '') : undefined),
        ),
      },
      {
        title: 'Stream',
        rows: rows(
          row('Codec', s.codec || undefined, s.hls ? { hint: 'HLS playlist' } : {}),
          row('Bitrate', s.bitrate !== null ? `${s.bitrate} kbit/s` : undefined),
          row('Host', host(s.streamUrl), { mono: true }),
          row('In this app', mode === 'audio' ? 'Plays in the browser' : 'Open the stream in your player', { hint: mode === 'audio' ? undefined : 'not playable in a plain audio element' }),
        ),
      },
      {
        title: 'Location',
        rows: rows(row('Coordinates', `${fmtLat(s.lat)}, ${fmtLon(s.lon)}`, { mono: true }), row('Accuracy', 'Community-entered', { hint: 'often a city centre' })),
      },
      {
        title: 'Source',
        rows: rows(
          row('Feed', RADIO_CREDIT),
          row('Listens', fmtInt(s.clicks), { hint: 'starts counted by Radio Browser' }),
          row('Votes', s.votes > 0 ? fmtInt(s.votes) : undefined),
          row('Directory fetched', listedAt !== null ? fmtAgo(now - listedAt) : undefined),
          row('Licence', 'No data licence published', { hint: 'free to use; entries are community-maintained' }),
          row('Station id', s.id, { mono: true }),
        ),
      },
    ].filter((sec) => sec.rows.length > 0),
    sources: [RADIO_CREDIT],
    ...(s.homepage ? { url: s.homepage } : {}),
  };
}
