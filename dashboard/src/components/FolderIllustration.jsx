// Small decorative graphic for the "Assign a project" card header.
export default function FolderIllustration({ width = 96 }) {
  return (
    <svg viewBox="0 0 120 110" width={width} xmlns="http://www.w3.org/2000/svg">
      <circle cx="18" cy="20" r="3" fill="#c7bdf0" />
      <circle cx="108" cy="16" r="2.4" fill="#a78bfa" />
      <circle cx="14" cy="80" r="2" fill="#9085e9" />
      <path d="M28 40 h34 l8 10 h30 a6 6 0 0 1 6 6 v34 a6 6 0 0 1 -6 6 h-72 a6 6 0 0 1 -6 -6 v-44 a6 6 0 0 1 6 -6 Z" fill="#7C3AED" />
      <path d="M40 30 h40 a6 6 0 0 1 6 6 v10 h-52 v-10 a6 6 0 0 1 6 -6 Z" fill="#9085e9" />
      <rect x="52" y="18" width="30" height="38" rx="3" fill="#fff" stroke="#e3daf7" strokeWidth="2" transform="rotate(6 67 37)" />
      <line x1="58" y1="28" x2="76" y2="26" stroke="#c7bdf0" strokeWidth="2.4" strokeLinecap="round" transform="rotate(6 67 37)" />
      <line x1="58" y1="35" x2="76" y2="33" stroke="#e3daf7" strokeWidth="2.4" strokeLinecap="round" transform="rotate(6 67 37)" />
      <circle cx="94" cy="76" r="13" fill="#10b981" />
      <path d="M88 76 l4 4 l8 -9" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
