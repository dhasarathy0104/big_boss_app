// Small decorative graphic for the sidebar footer — flat-style, brand palette only.
export default function DeskIllustration({ width = 140 }) {
  return (
    <svg viewBox="0 0 160 130" width={width} xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="80" cy="118" rx="62" ry="8" fill="var(--tint-10)" />
      <rect x="18" y="70" width="82" height="8" rx="3" fill="#9085e9" />
      <rect x="26" y="78" width="6" height="30" fill="#c7c2f3" />
      <rect x="86" y="78" width="6" height="30" fill="#c7c2f3" />
      <rect x="40" y="52" width="34" height="22" rx="3" fill="#3987e5" />
      <rect x="43" y="55" width="28" height="15" rx="2" fill="#eaf1fd" />
      <circle cx="118" cy="60" r="16" fill="#dff5ee" />
      <path d="M110 62 h16 M118 54 v16" stroke="var(--productive)" strokeWidth="2.4" strokeLinecap="round" />
      <rect x="128" y="90" width="10" height="26" rx="3" fill="#8b5cf6" />
      <ellipse cx="133" cy="86" rx="10" ry="7" fill="#a78bfa" />
      <circle cx="55" cy="30" r="12" fill="#f3d9c4" />
      <path d="M40 68 C40 48 48 38 55 38 C62 38 70 48 70 68 Z" fill="#7C3AED" />
      <rect x="24" y="100" width="112" height="6" rx="3" fill="var(--tint-10)" />
    </svg>
  );
}
