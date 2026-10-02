import type { FeedStatus } from '@gev/shared';
import { fetchFeeds, isAbort } from '../api/index.ts';

const POLL_MS = 10_000;

/** Latest FeedStatus per layer, from /api/feeds and from every snapshot answer. */
export const feedStore = $state<{ byLayer: Record<string, FeedStatus>; loaded: boolean; failed: boolean }>({ byLayer: {}, loaded: false, failed: false });

export function noteFeed(feed: FeedStatus): void {
  feedStore.byLayer[feed.layer] = feed;
}

/** Poll /api/feeds while the tab is visible. Returns a stop function. */
export function startFeedPolling(): () => void {
  let ctl: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  async function poll() {
    ctl?.abort();
    ctl = new AbortController();
    try {
      const feeds = await fetchFeeds(ctl.signal);
      for (const f of feeds) feedStore.byLayer[f.layer] = f;
      feedStore.loaded = true;
      feedStore.failed = false;
    } catch (e) {
      if (isAbort(e)) return;
      feedStore.failed = true;
    }
    schedule();
  }
  function schedule() {
    clearTimeout(timer);
    if (stopped || document.hidden) return;
    timer = setTimeout(() => void poll(), POLL_MS);
  }
  const onVisibility = () => {
    if (document.hidden) clearTimeout(timer);
    else void poll();
  };
  document.addEventListener('visibilitychange', onVisibility);
  void poll();
  return () => {
    stopped = true;
    clearTimeout(timer);
    ctl?.abort();
    document.removeEventListener('visibilitychange', onVisibility);
  };
}
