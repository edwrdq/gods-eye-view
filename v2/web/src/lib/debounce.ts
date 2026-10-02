export interface Debounced<A extends unknown[]> {
  (...args: A): void;
  cancel(): void;
  flush(): void;
}

/** Trailing-edge debounce with cancel and flush. */
export function debounce<A extends unknown[]>(fn: (...args: A) => void, waitMs: number): Debounced<A> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: A | undefined;
  const run = () => {
    timer = undefined;
    const args = pending;
    pending = undefined;
    if (args) fn(...args);
  };
  const d = ((...args: A) => {
    pending = args;
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(run, waitMs);
  }) as Debounced<A>;
  d.cancel = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    pending = undefined;
  };
  d.flush = () => {
    if (timer === undefined) return;
    clearTimeout(timer);
    run();
  };
  return d;
}
