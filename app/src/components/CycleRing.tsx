interface Props {
  /** 1-based day within the current cycle, or null before any data. */
  cycleDay: number | null
  cycleLength: number
  /** Days until the next predicted period, or null. */
  daysUntilPeriod: number | null
  /** Days past the estimated start, or zero when not late. */
  daysLate?: number
}

const SIZE = 280
const STROKE = 14
const R = (SIZE - STROKE) / 2
const CIRC = 2 * Math.PI * R

/**
 * The Hello Kitty focal object: a glowing candy pink ring, sparkling accents,
 * and sweet, clear countdown typography.
 */
export function CycleRing({ cycleDay, cycleLength, daysUntilPeriod, daysLate = 0 }: Props) {
  const progress = cycleDay && cycleLength > 0 ? Math.min(cycleDay / cycleLength, 1) : 0
  const hasData = daysUntilPeriod !== null
  const announcement =
    daysLate > 0
      ? `Your period estimate is ${daysLate} ${daysLate === 1 ? 'day' : 'days'} late`
      : hasData
        ? `Your next period is estimated in ${daysUntilPeriod} ${daysUntilPeriod === 1 ? 'day' : 'days'}`
        : 'Log your last two periods to see a cycle estimate'

  return (
    <div className="cycle-ring" aria-label={announcement}>
      <span className="cycle-ring-petal petal-one" aria-hidden="true">🌸</span>
      <span className="cycle-ring-petal petal-two" aria-hidden="true">✨</span>
      <span className="cycle-ring-petal petal-three" aria-hidden="true">🎀</span>
      <svg className="cycle-ring-svg" viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true">
        <defs>
          <linearGradient id="ruby-cycle-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#ff758c" />
            <stop offset="45%" stopColor="#ff2e63" />
            <stop offset="100%" stopColor="#e91e63" />
          </linearGradient>
          <linearGradient id="ruby-track-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#ffe5ec" />
            <stop offset="100%" stopColor="#ffd4e1" />
          </linearGradient>
          <filter id="ruby-ring-glow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <g className="cycle-ring-orbit">
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={R}
            className="cycle-ring-track"
            strokeWidth={STROKE}
            stroke="url(#ruby-track-gradient)"
          />
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={R}
            className="cycle-ring-progress"
            strokeWidth={STROKE}
            strokeDasharray={CIRC}
            strokeDashoffset={CIRC * (1 - progress)}
            stroke="url(#ruby-cycle-gradient)"
            strokeLinecap="round"
            filter="url(#ruby-ring-glow)"
          />
        </g>
        {/* Satellite with cute heart/bow glow */}
        <g transform={`rotate(${progress * 360} ${SIZE / 2} ${SIZE / 2})`}>
          <circle
            className="cycle-ring-satellite-glow"
            cx={SIZE / 2}
            cy={STROKE / 2 + 1}
            r="8"
            fill="rgba(255, 46, 99, 0.4)"
          />
          <circle
            className="cycle-ring-satellite"
            cx={SIZE / 2}
            cy={STROKE / 2 + 1}
            r="6"
            fill="#ffffff"
            stroke="#ff2e63"
            strokeWidth="3"
          />
        </g>
      </svg>
      <div className="cycle-ring-core">
        {daysLate > 0 ? (
          <>
            <span className="cycle-ring-kicker">Period may be</span>
            <strong className="cycle-ring-number">{daysLate}</strong>
            <span className="cycle-ring-unit">
              {daysLate === 1 ? 'day late' : 'days late'}
            </span>
          </>
        ) : hasData ? (
          <>
            <span className="cycle-ring-kicker">Period in</span>
            <strong className="cycle-ring-number">{daysUntilPeriod}</strong>
            <span className="cycle-ring-unit">
              {daysUntilPeriod === 1 ? 'day' : 'days'}
            </span>
          </>
        ) : (
          <>
            <span className="cycle-ring-welcome">Your rhythm,<br />made sweet ✨</span>
            <span className="cycle-ring-empty">
              Log two periods to begin 🎀
            </span>
          </>
        )}
        {cycleDay && <span className="cycle-ring-day">Day {cycleDay} 💕</span>}
      </div>
    </div>
  )
}
