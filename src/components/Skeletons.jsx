import '../styles/skeleton.css'

// Layout-shaped placeholders for the four tab pages. They use each page's own
// container classes, so the real content drops in without the page shifting.

const Block = ({ h, w, r, grow, className = '' }) => (
  <div className={`sk ${className}`} style={{ height: h, width: w, borderRadius: r, flex: w ? 'none' : grow ? 1 : undefined }} aria-hidden="true" />
)

// A busy region for screen readers; the blocks themselves are hidden from them.
const Busy = ({ children, className }) => (
  <div className={className} role="status" aria-busy="true" aria-label="Loading">{children}</div>
)

export function HomeSkeleton() {
  const date = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
  return (
    <div className="app-page home">
      <main className="home__main">
        <header className="home__intro">
          <div className="home__date">{date}</div>
          <Block h={32} w="62%" r={8} />
        </header>
        <Busy className="sk-col" >
          <Block h={236} r={18} />
        </Busy>
        <Block h={96} r={18} />
        <Block h={88} r={18} />
      </main>
    </div>
  )
}

export function PicksSkeleton() {
  return (
    <div className="app-page pk">
      <main className="pk__main">
        <header className="pk-head">
          <h1 className="pk-title">Picks</h1>
          <Block h={18} w={110} r={6} />
        </header>
        <Busy className="sk-row">
          {[1, 2, 3, 4, 5, 6].map(n => <Block key={n} h={52} w={46} r={12} />)}
        </Busy>
        <Block h={92} r={16} />
        <RunnerRowsSkeleton count={5} />
      </main>
    </div>
  )
}

export function RunnerRowsSkeleton({ count = 4 }) {
  return (
    <div className="pk-list" role="status" aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }, (_, n) => <Block key={n} h={64} r={14} />)}
    </div>
  )
}

export function StandingsRowsSkeleton({ count = 6 }) {
  return (
    <div className="lg-list" role="status" aria-busy="true" aria-label="Loading">
      <Block h={80} r={18} />
      {Array.from({ length: count }, (_, n) => <Block key={n} h={56} r={14} />)}
    </div>
  )
}

export function LeagueSkeleton() {
  return (
    <div className="app-page lg">
      <main className="lg__main">
        <h1 className="lg-title">Leaderboard</h1>
        <Block h={44} r={12} />
        <StandingsRowsSkeleton />
      </main>
    </div>
  )
}

// Summary tiles and race cards for one week or day.
export function ResultsBodySkeleton() {
  return (
    <div className="sk-col" style={{ gap: 14 }} role="status" aria-busy="true" aria-label="Loading">
      <div className="rs-tiles">
        {[1, 2, 3].map(n => <Block key={n} h={70} r={14} />)}
      </div>
      {[1, 2, 3].map(n => <Block key={n} h={104} r={16} />)}
    </div>
  )
}

export function ResultsSkeleton() {
  return (
    <div className="app-page rs">
      <main className="rs__main">
        <h1 className="rs-title">Results</h1>
        <div className="rs-period">
          <Block h={44} w={44} r={12} />
          <Block h={20} r={6} grow />
          <Block h={44} w={44} r={12} />
        </div>
        <ResultsBodySkeleton />
      </main>
    </div>
  )
}
