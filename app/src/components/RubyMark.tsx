import '../styles/brand.css'

interface RubyMarkProps {
  className?: string
  decorative?: boolean
  label?: string
  size?: number
}

/**
 * The iconic Hello Kitty Ribbon Bow brand mark for Ruby.
 */
export function RubyMark({
  className = '',
  decorative = false,
  label = 'Ruby',
  size = 32,
}: RubyMarkProps) {
  return (
    <svg
      className={`ruby-bow${className ? ` ${className}` : ''}`}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      focusable="false"
      role={decorative ? undefined : 'img'}
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : label}
    >
      <defs>
        <linearGradient id="hk-bow-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#ff4572" />
          <stop offset="60%" stopColor="#ff2e63" />
          <stop offset="100%" stopColor="#d91b4f" />
        </linearGradient>
        <filter id="hk-bow-shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="2" stdDeviation="2.5" floodColor="#ff2e63" floodOpacity="0.35" />
        </filter>
      </defs>

      <g filter="url(#hk-bow-shadow)">
        {/* Left Loop */}
        <path
          d="M24 32C15 22 4 23 4 33c0 10 11 11 20 1z"
          fill="url(#hk-bow-grad)"
          stroke="#2d1822"
          strokeWidth="2.8"
          strokeLinejoin="round"
        />
        {/* Left loop inner crease */}
        <path
          d="M17 31c-3.5-2-7-1.5-8.5 1.5"
          stroke="#ff9bb7"
          strokeWidth="2"
          strokeLinecap="round"
        />

        {/* Right Loop */}
        <path
          d="M40 32c9-10 20-9 20 1 0 10-11 11-20 1z"
          fill="url(#hk-bow-grad)"
          stroke="#2d1822"
          strokeWidth="2.8"
          strokeLinejoin="round"
        />
        {/* Right loop inner crease */}
        <path
          d="M47 31c3.5-2 7-1.5 8.5 1.5"
          stroke="#ff9bb7"
          strokeWidth="2"
          strokeLinecap="round"
        />

        {/* Center Knot */}
        <circle
          cx="32"
          cy="32"
          r="9"
          fill="url(#hk-bow-grad)"
          stroke="#2d1822"
          strokeWidth="2.8"
        />

        {/* Knot Gloss Highlight */}
        <ellipse
          cx="29.5"
          cy="28.5"
          rx="3"
          ry="1.8"
          transform="rotate(-25 29.5 28.5)"
          fill="#ffffff"
          opacity="0.85"
        />
      </g>

      {/* Cute Sparkle ✨ */}
      <path
        d="M54 13l1.5 4.5L60 19l-4.5 1.5L54 25l-1.5-4.5L48 19l4.5-1.5L54 13z"
        fill="#ffea79"
      />
    </svg>
  )
}
