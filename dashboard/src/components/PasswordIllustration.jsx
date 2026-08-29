// Decorative graphic for the "Change an admin's password" card — a padlock
// with a masked-password pill and a refresh badge.
export default function PasswordIllustration({ width = 130 }) {
  return (
    <svg viewBox="0 0 160 150" width={width} xmlns="http://www.w3.org/2000/svg">
      <circle cx="85" cy="78" r="60" fill="var(--tint-10)" />
      <circle cx="130" cy="30" r="3" fill="#c7bdf0" />
      <circle cx="26" cy="118" r="2.6" fill="#a78bfa" />
      <rect x="52" y="62" width="56" height="46" rx="10" fill="#7C3AED" />
      <path d="M62 62 v-14 a18 18 0 0 1 36 0 v14" fill="none" stroke="#7C3AED" strokeWidth="9" />
      <circle cx="80" cy="84" r="6" fill="#3B0764" />
      <rect x="77" y="84" width="6" height="12" rx="2" fill="#3B0764" />
      <rect x="60" y="96" width="80" height="24" rx="12" fill="#fff" stroke="#e3daf7" strokeWidth="2" />
      {[0, 1, 2, 3, 4].map((i) => (
        <circle key={i} cx={74 + i * 13} cy="108" r="4" fill="#7C3AED" />
      ))}
      <circle cx="124" cy="112" r="17" fill="#10b981" />
      <path
        d="M117 112 a7 7 0 1 1 2 4.9 M117 112 l0 -5 M117 112 l5 1"
        fill="none"
        stroke="#fff"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
