// Local calendar date, not UTC — toISOString() is UTC-based, so anyone
// ahead of UTC (e.g. IST) would see "today" flip over to tomorrow's date
// hours before their actual midnight, and vice versa for anyone behind UTC.
export function todayStr() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// The instants marking local midnight-to-midnight for a YYYY-MM-DD date, as
// UTC ISO strings the backend can filter timestamps against directly — see
// dayWindow() in server.js. Constructing these without a 'Z' suffix makes
// JS parse them in the browser's own timezone rather than UTC.
export function localDayRange(dateStr) {
  const start = new Date(`${dateStr}T00:00:00`);
  const end = new Date(`${dateStr}T23:59:59.999`);
  return { start: start.toISOString(), end: end.toISOString() };
}

// Local-calendar-day version of stepping a YYYY-MM-DD string back one day —
// avoids the UTC/local mismatch of doing this with setUTCDate.
export function prevLocalDateStr(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() - 1);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function fmtMinutes(rawMins) {
  const mins = rawMins > 0 ? Math.max(1, Math.round(rawMins)) : 0;
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

// Deterministic color per app name so timelines/legends stay readable across renders.
export function colorForApp(name) {
  if (!name) return '#3a3f4b';
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 55%, 50%)`;
}
