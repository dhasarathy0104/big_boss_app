// Sidebar footer illustration — flat duotone (brand purple/lavender) scene:
// wall clock, a small bar-chart card, and a person at a desk with a laptop
// and a plant, matching the reference mockup's sidebar artwork.
export default function DeskIllustration({ width = 150 }) {
  return (
    <svg viewBox="0 0 200 180" width={width} xmlns="http://www.w3.org/2000/svg">
      {/* floor shadow */}
      <ellipse cx="100" cy="166" rx="78" ry="10" fill="var(--tint-10)" />

      {/* wall clock */}
      <circle cx="42" cy="46" r="26" fill="#fff" stroke="#c7bdf0" strokeWidth="3" />
      <circle cx="42" cy="46" r="2.6" fill="#5B21B6" />
      <line x1="42" y1="46" x2="42" y2="32" stroke="#5B21B6" strokeWidth="2.4" strokeLinecap="round" />
      <line x1="42" y1="46" x2="52" y2="50" stroke="#8b5cf6" strokeWidth="2.4" strokeLinecap="round" />
      {[0, 90, 180, 270].map((deg) => (
        <line
          key={deg}
          x1={42 + 22 * Math.cos((deg * Math.PI) / 180)}
          y1={46 + 22 * Math.sin((deg * Math.PI) / 180)}
          x2={42 + 25 * Math.cos((deg * Math.PI) / 180)}
          y2={46 + 25 * Math.sin((deg * Math.PI) / 180)}
          stroke="#c7bdf0"
          strokeWidth="2"
        />
      ))}

      {/* bar chart card */}
      <rect x="130" y="24" width="52" height="44" rx="8" fill="#fff" stroke="#e3daf7" strokeWidth="2" />
      <rect x="140" y="52" width="7" height="10" rx="2" fill="#c7bdf0" />
      <rect x="151" y="44" width="7" height="18" rx="2" fill="#9085e9" />
      <rect x="162" y="36" width="7" height="26" rx="2" fill="#5B21B6" />

      {/* plant */}
      <rect x="156" y="128" width="20" height="18" rx="3" fill="#7C3AED" />
      <path d="M166 128 C150 118 150 96 166 88 C182 96 182 118 166 128 Z" fill="#10b981" opacity="0.85" />
      <path d="M166 128 C156 120 156 104 166 96 C176 104 176 120 166 128 Z" fill="#34d399" opacity="0.9" />

      {/* desk */}
      <rect x="46" y="118" width="98" height="9" rx="3" fill="#9085e9" />
      <rect x="54" y="127" width="7" height="28" fill="#c7bdf0" />
      <rect x="130" y="127" width="7" height="28" fill="#c7bdf0" />

      {/* laptop */}
      <rect x="80" y="96" width="34" height="22" rx="2" fill="#3B0764" />
      <rect x="83" y="99" width="28" height="16" rx="1.5" fill="#a78bfa" />
      <rect x="76" y="117" width="42" height="4" rx="1.5" fill="#5B21B6" />

      {/* person */}
      <circle cx="97" cy="66" r="13" fill="#f3d9c4" />
      <path
        d="M78 118 C78 90 88 76 97 76 C106 76 116 90 116 118 Z"
        fill="#7C3AED"
      />
      <path d="M84 118 L84 140 L92 140 L92 122 Z" fill="#4C1D95" />
      <path d="M102 118 L100 140 L108 140 L110 118 Z" fill="#4C1D95" />
      <rect x="90" y="145" width="14" height="6" rx="2" fill="#3B0764" />
    </svg>
  );
}
