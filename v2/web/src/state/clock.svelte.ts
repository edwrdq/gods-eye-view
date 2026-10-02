/** A shared one-second clock so relative ages ("2 s ago") stay current without per-component timers. */
export const clock = $state({ now: Date.now() });

let timer: ReturnType<typeof setInterval> | undefined;

function tick() {
  clock.now = Date.now();
}

export function startClock(): () => void {
  tick();
  timer = setInterval(() => {
    if (!document.hidden) tick();
  }, 1000);
  const onVisible = () => !document.hidden && tick();
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisible);
  };
}
