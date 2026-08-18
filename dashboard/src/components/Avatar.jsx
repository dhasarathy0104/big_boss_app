// Deterministic color per name, drawn from the app's validated data palette
// so avatars never introduce a hue outside the checked set.
const PALETTE = ['#3987e5', '#9085e9', '#199e70', '#d55181', '#c98500'];

function colorForName(name) {
  let hash = 0;
  for (let i = 0; i < (name || '').length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

function initialsFor(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return parts.length === 1 ? parts[0].slice(0, 2).toUpperCase() : (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function Avatar({ name, size = 32 }) {
  return (
    <div
      className="avatar"
      style={{
        width: size,
        height: size,
        fontSize: Math.max(10, size * 0.4),
        background: colorForName(name),
      }}
      title={name}
    >
      {initialsFor(name)}
    </div>
  );
}
