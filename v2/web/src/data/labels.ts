/** Text for an object's map label, from the snapshot prop vocabulary (flights: callsign; vessels: name). */
export function labelOf(props: Record<string, unknown> | undefined, fallback: string): string {
  for (const key of ['callsign', 'name', 'registration', 'label']) {
    const v = props?.[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return fallback;
}
