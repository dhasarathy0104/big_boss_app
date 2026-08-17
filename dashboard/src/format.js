export function todayStr() {
  return new Date().toISOString().slice(0, 10);
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
