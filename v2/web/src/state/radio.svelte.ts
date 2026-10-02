import { playVerdict, type PlayVerdict } from '../lib/radioPlay.ts';

export type RadioPhase = 'idle' | 'loading' | 'playing' | 'error';

/** The one stream that may be playing. Audio starts only from playStation, which only a click calls. */
export const radio = $state<{ id: string | null; phase: RadioPhase; message: string; volume: number }>({ id: null, phase: 'idle', message: '', volume: 0.8 });

let audio: HTMLAudioElement | null = null;

function element(): HTMLAudioElement {
  if (audio) return audio;
  const a = new Audio();
  a.preload = 'none';
  a.volume = radio.volume;
  a.addEventListener('playing', () => {
    if (radio.id) radio.phase = 'playing';
  });
  a.addEventListener('waiting', () => {
    if (radio.id && radio.phase === 'playing') radio.phase = 'loading';
  });
  a.addEventListener('stalled', () => {
    if (radio.id && radio.phase === 'playing') radio.phase = 'loading';
  });
  a.addEventListener('error', () => {
    if (!radio.id || !a.getAttribute('src')) return; // clearing the source also raises an error
    radio.phase = 'error';
    radio.message = a.error?.code === 4 ? "The station's stream isn't available, or the browser can't play it." : 'The stream stopped. The station may be off the air.';
  });
  a.addEventListener('ended', () => stopRadio());
  audio = a;
  return a;
}

/** What the browser says about a stream; call from the click handler or when rendering the control. */
export function verdictFor(input: { play: string; codec: string; streamUrl: string; hls: boolean }): PlayVerdict {
  const probe = typeof document !== 'undefined' ? document.createElement('audio') : null;
  return playVerdict({ ...input, pageProtocol: typeof location !== 'undefined' ? location.protocol : 'https:', canPlayType: (m) => probe?.canPlayType(m) ?? '' });
}

/** Start a stream. Only call this from a user's click. */
export function playStation(id: string, streamUrl: string): void {
  const a = element();
  radio.id = id;
  radio.phase = 'loading';
  radio.message = '';
  a.src = streamUrl;
  a.volume = radio.volume;
  a.play().catch((e: unknown) => {
    if (radio.id !== id) return;
    if (e instanceof DOMException && e.name === 'AbortError') return; // a newer play or a stop interrupted it
    radio.phase = 'error';
    radio.message = e instanceof DOMException && e.name === 'NotAllowedError' ? 'The browser did not allow playback. Try again.' : "Couldn't start the stream.";
  });
}

/** Stop and release the connection to the station. */
export function stopRadio(): void {
  radio.id = null;
  radio.phase = 'idle';
  radio.message = '';
  if (!audio) return;
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
}

export function setVolume(v: number): void {
  radio.volume = Math.max(0, Math.min(1, v));
  if (audio) audio.volume = radio.volume;
}
