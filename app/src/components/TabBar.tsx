export type Tab = 'today' | 'insights' | 'graphs' | 'settings'

interface TabDef {
  id: Tab
  label: string
  icon: (active: boolean) => JSX.Element
  badge?: string
}

const TABS: TabDef[] = [
  {
    id: 'today',
    label: 'Today',
    icon: (active) => (
      <svg viewBox="0 0 24 24" fill={active ? 'var(--hk-red)' : 'none'} stroke="currentColor" strokeWidth={active ? '2' : '2.2'} strokeLinecap="round" strokeLinejoin="round">
        {/* Cute Bow / Heart Calendar */}
        <rect x="3" y="4" width="18" height="17" rx="4" fill={active ? 'var(--rose-100)' : 'none'} />
        <path d="M16 2v4M8 2v4M3 10h18" stroke={active ? 'var(--hk-red)' : 'currentColor'} />
        <path d="M12 14.5c-.8-.8-2-.8-2.5 0-.6.8-.4 2 .5 2.5l2 1.5 2-1.5c.9-.5 1.1-1.7.5-2.5-.5-.8-1.7-.8-2.5 0z" fill={active ? 'var(--hk-red)' : 'currentColor'} stroke="none" />
      </svg>
    ),
  },
  {
    id: 'insights',
    label: 'Insights',
    icon: (active) => (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? '2.4' : '2.2'} strokeLinecap="round" strokeLinejoin="round">
        {/* Cute Sparkle & Star Book */}
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" fill={active ? 'var(--rose-100)' : 'none'} />
        <path d="M12 6.5l.8 1.7 1.7.8-1.7.8-.8 1.7-.8-1.7-1.7-.8 1.7-.8.8-1.7z" fill={active ? 'var(--yellow-500)' : 'currentColor'} stroke="none" />
      </svg>
    ),
  },
  {
    id: 'graphs',
    label: 'Trends',
    icon: (active) => (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? '2.4' : '2.2'} strokeLinecap="round" strokeLinejoin="round">
        {/* Cute rounded bar chart with hearts */}
        <path d="M18 20V10M12 20V4M6 20v-6" />
        <circle cx="6" cy="14" r="2" fill={active ? 'var(--hk-red)' : 'none'} />
        <circle cx="12" cy="4" r="2" fill={active ? 'var(--hk-red)' : 'none'} />
        <circle cx="18" cy="10" r="2" fill={active ? 'var(--hk-red)' : 'none'} />
      </svg>
    ),
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: (active) => (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? '2.4' : '2.2'} strokeLinecap="round" strokeLinejoin="round">
        {/* Cute Flower gear / sliders */}
        <path d="M4 8h8M16 8h4M4 16h4M12 16h8" />
        <circle cx="14" cy="8" r="2.5" fill={active ? 'var(--rose-100)' : 'none'} stroke={active ? 'var(--hk-red)' : 'currentColor'} />
        <circle cx="10" cy="16" r="2.5" fill={active ? 'var(--rose-100)' : 'none'} stroke={active ? 'var(--hk-red)' : 'currentColor'} />
      </svg>
    ),
  },
]

export function TabBar({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  function changeTab(next: Tab) {
    if (next === active) {
      document.querySelector('main')?.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }
    onChange(next)
    requestAnimationFrame(() => {
      document.querySelector('main')?.scrollTo({ top: 0, behavior: 'auto' })
    })
  }

  return (
    <nav className="tabbar" aria-label="Primary navigation">
      <div className="tabbar-inner">
        {TABS.map((t) => {
          const selected = active === t.id
          return (
            <button
              key={t.id}
              type="button"
              className={`tabbar-item${selected ? ' is-active' : ''}`}
              onClick={() => changeTab(t.id)}
              aria-current={selected ? 'page' : undefined}
            >
              <span className="tabbar-icon">
                {t.icon(selected)}
              </span>
              <span className="tabbar-label">{t.label}</span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
