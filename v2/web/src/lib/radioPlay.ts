/** Whether a radio stream can be played in a plain <audio> element, and what to tell the listener when it cannot. */

export type PlayVerdict = { mode: 'audio'; mime: string } | { mode: 'link'; reason: string };

/** The MIME type to ask canPlayType about, per Radio Browser codec name. */
export function mimeFor(codec: string): string | null {
  switch (codec.toUpperCase()) {
    case 'MP3':
      return 'audio/mpeg';
    case 'AAC':
    case 'AAC+':
      return 'audio/aac';
    case 'OGG':
      return 'audio/ogg';
    case 'FLAC':
      return 'audio/flac';
    default:
      return null;
  }
}

export interface PlayInput {
  /** The server's hint: 'audio' (a codec browsers usually play) or 'link'. */
  play: string;
  codec: string;
  streamUrl: string;
  hls: boolean;
  /** location.protocol of the page. */
  pageProtocol: string;
  /** audio.canPlayType */
  canPlayType: (mime: string) => string;
}

/**
 * Plays natively only when the server marked the codec as a browser codec, the stream is not an
 * HLS playlist, this browser says it can decode it, and the page is allowed to load it (an https
 * page cannot play an http stream). Everything else is offered as an "Open stream" link.
 */
export function playVerdict(i: PlayInput): PlayVerdict {
  if (i.hls) return { mode: 'link', reason: 'This is an HLS playlist, which needs a player this app does not include.' };
  const mime = mimeFor(i.codec);
  if (i.play !== 'audio' || mime === null) return { mode: 'link', reason: i.codec && i.codec !== 'UNKNOWN' ? `The ${i.codec} format is not one this app plays.` : 'The stream format is not known.' };
  if (!/^https?:\/\//i.test(i.streamUrl)) return { mode: 'link', reason: 'The stream address is not a web address.' };
  if (i.pageProtocol === 'https:' && /^http:\/\//i.test(i.streamUrl)) return { mode: 'link', reason: 'The stream is not encrypted, so the browser blocks it on a secure page.' };
  if (i.canPlayType(mime) === '') return { mode: 'link', reason: `This browser cannot play ${i.codec}.` };
  return { mode: 'audio', mime };
}
