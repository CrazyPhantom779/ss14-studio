export function StudioLogo({ size = 28 }: { size?: number }) {
  return (
    <svg
      className="studio-logo"
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
    >
      <path
        className="logo-frame"
        d="M16 2.85 27.55 9.5v13.2L16 29.35 4.45 22.7V9.5L16 2.85Z"
        strokeWidth="1.35"
      />
      <path
        className="logo-trace"
        d="M10 19.4 16 9.6l5.8 9.5M10 19.4h11.7M16 9.6v12.55"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle className="logo-node logo-node-start" cx="16" cy="9.6" r="2.15" />
      <circle className="logo-node" cx="10" cy="19.4" r="1.8" />
      <circle className="logo-node" cx="21.7" cy="19.4" r="1.8" />
    </svg>
  );
}
