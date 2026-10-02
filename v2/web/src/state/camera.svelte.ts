import { nextPictureDelayMs } from '../lib/cameraRefresh.ts';

export type PicturePhase = 'idle' | 'loading' | 'ready' | 'error';

/** The picture shown for the selected camera. Only one camera is ever watched, and only while its panel is open and the tab is visible. */
export const picture = $state<{
  id: string | null;
  phase: PicturePhase;
  /** Object URL of the newest picture. */
  src: string | null;
  /** When the picture was taken (epoch ms), from the server. */
  frameTime: number | null;
  message: string;
  /** Last request failed and an older picture is still shown. */
  failedSince: boolean;
}>({ id: null, phase: 'idle', src: null, frameTime: null, message: '', failedSince: false });

let ctl: AbortController | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let dueAt = 0;
let failures = 0;
let refreshS = 60;
let path = '';
let watching = false;

const clear = () => {
  clearTimeout(timer);
  timer = undefined;
};

function release(): void {
  if (picture.src) URL.revokeObjectURL(picture.src);
  picture.src = null;
}

async function load(): Promise<void> {
  clear();
  const id = picture.id;
  if (!id || document.hidden) return;
  ctl?.abort();
  const mine = (ctl = new AbortController());
  if (picture.src === null) picture.phase = 'loading';
  let delay: number;
  try {
    const res = await fetch(path, { signal: mine.signal, cache: 'no-store' });
    if (mine.signal.aborted || picture.id !== id) return;
    if (!res.ok) {
      let message = 'The camera did not send a picture.';
      try {
        const body = (await res.json()) as { error?: string };
        if (typeof body.error === 'string' && body.error) message = body.error;
      } catch {
        /* not JSON */
      }
      failures++;
      picture.message = message;
      picture.failedSince = picture.src !== null;
      picture.phase = picture.src ? 'ready' : 'error';
      const ra = Number(res.headers.get('retry-after'));
      delay = nextPictureDelayMs({ refreshS, refreshAfterS: null, failures, retryAfterS: Number.isFinite(ra) ? ra : null });
    } else {
      const blob = await res.blob();
      if (mine.signal.aborted || picture.id !== id) return;
      const url = URL.createObjectURL(blob);
      release();
      picture.src = url;
      const t = Number(res.headers.get('x-frame-time'));
      picture.frameTime = Number.isFinite(t) && t > 0 ? t : Date.now();
      picture.phase = 'ready';
      picture.message = '';
      picture.failedSince = false;
      failures = 0;
      const ra = res.headers.get('x-refresh-after');
      delay = nextPictureDelayMs({ refreshS, refreshAfterS: ra === null || ra === '' ? null : Number(ra), failures: 0 });
    }
  } catch (e) {
    if (mine.signal.aborted || (e instanceof DOMException && e.name === 'AbortError') || picture.id !== id) return;
    failures++;
    picture.message = "Couldn't reach the server.";
    picture.failedSince = picture.src !== null;
    picture.phase = picture.src ? 'ready' : 'error';
    delay = nextPictureDelayMs({ refreshS, refreshAfterS: null, failures });
  }
  schedule(delay);
}

function schedule(delay: number): void {
  clear();
  dueAt = Date.now() + delay;
  if (document.hidden) return; // resumes on visibilitychange
  timer = setTimeout(() => void load(), delay);
}

function onVisibility(): void {
  if (!picture.id) return;
  if (document.hidden) {
    // Nobody is looking: stop asking, and drop a request that is still in flight.
    clear();
    ctl?.abort();
  } else if (Date.now() >= dueAt) void load();
  else schedule(dueAt - Date.now());
}

/** Start showing a camera's picture; ends any previous one. `imagePath` is the server's picture path from the camera's details. */
export function watchCamera(id: string, imagePath: string, intervalS: number): void {
  if (picture.id === id) return;
  stopCamera();
  picture.id = id;
  picture.phase = 'loading';
  picture.message = '';
  picture.frameTime = null;
  picture.failedSince = false;
  path = imagePath;
  refreshS = intervalS;
  failures = 0;
  dueAt = 0;
  if (!watching) {
    document.addEventListener('visibilitychange', onVisibility);
    watching = true;
  }
  void load();
}

/** Ask now (the Try again button). */
export function reloadCamera(): void {
  failures = 0;
  void load();
}

export function stopCamera(): void {
  clear();
  ctl?.abort();
  ctl = null;
  release();
  picture.id = null;
  picture.phase = 'idle';
  picture.frameTime = null;
  picture.message = '';
  picture.failedSince = false;
  if (watching) {
    document.removeEventListener('visibilitychange', onVisibility);
    watching = false;
  }
}
