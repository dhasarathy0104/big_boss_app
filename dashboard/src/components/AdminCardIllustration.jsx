// Decorative graphic for the "Create a new admin" card — a profile card
// with a checkmark badge, duotone purple/lavender to match the brand.
export default function AdminCardIllustration({ width = 130 }) {
  return (
    <svg viewBox="0 0 160 150" width={width} xmlns="http://www.w3.org/2000/svg">
      <circle cx="95" cy="80" r="60" fill="var(--tint-10)" />
      <circle cx="24" cy="30" r="3" fill="#c7bdf0" />
      <circle cx="140" cy="118" r="2.6" fill="#a78bfa" />
      <rect x="42" y="28" width="90" height="86" rx="14" fill="#fff" stroke="#e3daf7" strokeWidth="2" />
      <circle cx="70" cy="58" r="14" fill="#7C3AED" />
      <path d="M60 66 a10 10 0 0 1 20 0" fill="#7C3AED" />
      <rect x="90" y="50" width="30" height="5" rx="2.5" fill="#c7bdf0" />
      <rect x="90" y="61" width="24" height="5" rx="2.5" fill="#e3daf7" />
      <rect x="54" y="86" width="66" height="4.5" rx="2.2" fill="#ede9fe" />
      <rect x="54" y="96" width="50" height="4.5" rx="2.2" fill="#ede9fe" />
      <circle cx="122" cy="112" r="17" fill="#10b981" />
      <path d="M114 112 l5.5 5.5 l11 -12" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
