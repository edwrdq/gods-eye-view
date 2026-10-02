// JetBrains Mono Variable, latin subset only (coordinates, ids, timestamps).
// Self-hosted from @fontsource-variable through the package's exported path, so
// nothing depends on where node_modules sits. Vite hashes and emits the one
// woff2; the @font-face is injected here rather than written in CSS, which
// would need a relative path into node_modules.
import monoUrl from '@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2?url';

const LATIN =
  'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';

export function installFonts(doc: Document = document): void {
  // Start the download now, in parallel with the rest of startup (fonts need crossorigin even same-origin).
  const link = doc.createElement('link');
  link.rel = 'preload';
  link.as = 'font';
  link.type = 'font/woff2';
  link.crossOrigin = 'anonymous';
  link.href = monoUrl;
  doc.head.append(link);

  const style = doc.createElement('style');
  style.textContent = `@font-face{font-family:'JetBrains Mono Variable';font-style:normal;font-display:swap;font-weight:100 800;src:url("${monoUrl}") format('woff2-variations');unicode-range:${LATIN}}`;
  doc.head.append(style);
}
