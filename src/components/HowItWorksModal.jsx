/**
 * HowItWorksModal — the full-screen rules sheet.
 * Opened from the landing page, the profile menu and the welcome flow.
 *
 *   <HowItWorksModal open={show} onClose={...} section="scoring" />
 *
 * `section` (optional) opens that accordion section and scrolls to it. Ids:
 * basics · picks · scoring · places · bonus · nonrunners · seasons · festivals.
 *
 * Every number on the screen comes from lib/scoring.js: the example points are worked out
 * by calcTokenPoints, and the places and share tables are read from the same rules scoring uses.
 */

import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Silk from './Silk.jsx'
import { ordinal } from '../lib/format.js'
import { calcTokenPoints, placeTapers, placeTermTiers, SCORING_RULES } from '../lib/scoring.js'
import BonusRules from './BonusRules.jsx'
import '../styles/howitworks.css'

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'

const SECTION_IDS = ['basics', 'picks', 'scoring', 'places', 'bonus', 'nonrunners', 'seasons', 'festivals']

// Fractional price n/d as decimal odds (5/1 -> 6, 10/1 -> 11), the form scoring uses.
const decimalOdds = (n, d = 1) => n / d + 1
const money = x => (Number.isInteger(x) ? String(x) : String(+x.toFixed(2)))

// Three worked examples. Only the situation is written here; the points come from calcTokenPoints.
const EXAMPLES = [
  { id: 'win', n: 5, d: 1, betType: 'win', position: 1, runnerCount: 12,
    silk: { silk_colour: '#1a3a7a', silk_colour_secondary: '#ffffff', silk_pattern: 'hoops' } },
  { id: 'ew2', n: 10, d: 1, betType: 'each_way', position: 2, runnerCount: 12,
    silk: { silk_colour: '#5a1010', silk_colour_secondary: '#c9a84c', silk_pattern: 'stripes' } },
  { id: 'ew3', n: 10, d: 1, betType: 'each_way', position: 3, runnerCount: 12,
    silk: { silk_colour: '#0d3d1a', silk_colour_secondary: '#ffffff', silk_pattern: 'chevrons' } },
].map(ex => {
  const oddsDecimal = decimalOdds(ex.n, ex.d)
  const { totalPoints } = calcTokenPoints({ betType: ex.betType, position: ex.position, oddsDecimal, runnerCount: ex.runnerCount })
  return { ...ex, oddsDecimal, points: totalPoints }
})

function Chevron() {
  return (
    <svg className="hw-chev" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 8l5 5 5-5" />
    </svg>
  )
}

function Section({ id, title, open, onToggle, sectionRef, children }) {
  const uid = useId()
  const btnId = `${uid}-b`
  const panelId = `${uid}-p`
  return (
    <section className={`hw-acc${open ? ' hw-acc--open' : ''}`} ref={sectionRef} data-section={id}>
      <h2 className="hw-acc__h">
        <button type="button" id={btnId} className="hw-acc__btn" aria-expanded={open} aria-controls={panelId} onClick={() => onToggle(id)}>
          <span>{title}</span>
          <Chevron />
        </button>
      </h2>
      <div id={panelId} role="region" aria-labelledby={btnId} className="hw-acc__panel" hidden={!open}>
        {children}
      </div>
    </section>
  )
}

function SubSection({ title, children }) {
  const [open, setOpen] = useState(false)
  const uid = useId()
  return (
    <div className={`hw-sub-acc${open ? ' hw-sub-acc--open' : ''}`}>
      <button type="button" className="hw-sub-btn" aria-expanded={open} aria-controls={uid} onClick={() => setOpen(o => !o)}>
        <span>{title}</span>
        <Chevron />
      </button>
      <div id={uid} className="hw-sub-panel" hidden={!open}>{children}</div>
    </div>
  )
}

function ExampleCard({ ex }) {
  const bet = ex.betType === 'win' ? 'All-in win' : 'Each-way'
  const finish = ex.betType === 'win'
    ? `Won, ${ordinal(ex.position)}`
    : `Finished ${ordinal(ex.position)} in a ${ex.runnerCount}-runner race`
  return (
    <div className="hw-ex">
      <div className="hw-ex__silk"><Silk runner={ex.silk} /></div>
      <div className="hw-ex__main">
        <div className="hw-ex__top">
          <span className="hw-ex__odds">{ex.n}/{ex.d}</span>
          <span className="hw-ex__bet">{bet}</span>
        </div>
        <span className="hw-ex__fin">{finish}</span>
      </div>
      <div className="hw-ex__pts">{ex.points}<small>points</small></div>
    </div>
  )
}

function placesLabel(placesPaid) {
  return placesPaid > 0 ? `Top ${placesPaid}` : 'No each-way'
}

function fieldLabel(tier, tiers, i) {
  if (tier.to === null) return `${tier.from} or more`
  if (tier.from === 1) return `Under ${tiers[i + 1].from}`
  return `${tier.from} to ${tier.to}`
}

function Body({ section }) {
  const [openIds, setOpenIds] = useState(() => new Set([SECTION_IDS.includes(section) ? section : 'basics']))
  const targetRef = useRef(null)
  const toggle = id => setOpenIds(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  // Opened straight to a section (the Welcome "Full scoring rules" link): bring it into view.
  useEffect(() => {
    targetRef.current?.scrollIntoView({ block: 'start' })
  }, [])

  const rules = SCORING_RULES
  const winOnlyBelow = `${money(rules.winOnlyBelowDecimal - 1)}/1`
  const quarter = rules.baseFraction === 0.25 ? '¼' : money(rules.baseFraction)
  const tiers = placeTermTiers()
  const tapers = placeTapers()
  const eachWayFrom = tiers.find(t => t.eachWayAvailable)?.from
  const [exWin, exEw2] = EXAMPLES
  const placePart = 1 + rules.baseFraction * (tapers.find(t => t.position === exEw2.position)?.share ?? 0) * (exEw2.oddsDecimal - 1)
  const secRef = id => (id === section && SECTION_IDS.includes(section) ? targetRef : undefined)
  const sec = (id, title, children) => (
    <Section id={id} title={title} open={openIds.has(id)} onToggle={toggle} sectionRef={secRef(id)}>{children}</Section>
  )

  return (
    <div className="hw-main">
      {sec('basics', 'The basics', (
        <ol className="hw-steps">
          <li className="hw-step">
            <span className="hw-step__num" aria-hidden="true">1</span>
            <div className="hw-step__body">
              <span className="hw-step__title">Pick a horse in every race</span>
              <span className="hw-step__text">One horse per race, every Saturday and at the big festivals.</span>
            </div>
          </li>
          <li className="hw-step">
            <span className="hw-step__num" aria-hidden="true">2</span>
            <div className="hw-step__body">
              <span className="hw-step__title">Score on the result</span>
              <span className="hw-step__text">Winners and placed horses score points. The bigger the price, the bigger the score.</span>
            </div>
          </li>
          <li className="hw-step">
            <span className="hw-step__num" aria-hidden="true">3</span>
            <div className="hw-step__body">
              <span className="hw-step__title">Beat your mates</span>
              <span className="hw-step__text">Climb the monthly table in your group and on the main Saturday League.</span>
            </div>
          </li>
        </ol>
      ))}

      {sec('picks', 'Picks and deadlines', (
        <ul className="hw-list">
          <li>Picks open when the races are published.</li>
          <li>Change your picks as often as you like until picks lock.</li>
          <li><strong>Picks lock 30 minutes before the first race.</strong> At a festival, each day locks 30 minutes before that day&rsquo;s first race.</li>
          <li>After that, your picks are final.</li>
        </ul>
      ))}

      {sec('scoring', 'Scoring', (
        <>
          <p className="hw-p">You get <strong>{rules.tokens} tokens</strong> in every race.</p>
          <p className="hw-p">A horse priced under <strong>{winOnlyBelow}</strong> is win only. Both tokens go on the win.</p>
          <p className="hw-p">At <strong>{winOnlyBelow}</strong> or bigger, you choose how to use them:</p>
          <div className="hw-choices">
            <div className="hw-choice">
              <span className="hw-choice__name">All-in win</span>
              <span className="hw-choice__text">Both tokens on the win. It only pays if your horse wins.</span>
            </div>
            <div className="hw-choice">
              <span className="hw-choice__name">Each-way</span>
              <span className="hw-choice__text">One token on the win, one on a place.</span>
            </div>
          </div>
          <div className="hw-label">Examples</div>
          <div className="hw-examples">
            {EXAMPLES.map(ex => <ExampleCard key={ex.id} ex={ex} />)}
          </div>
          <p className="hw-callout"><strong>No cap.</strong> The bigger the price, the bigger the score.</p>
          <SubSection title="How the maths works">
            <ul className="hw-formula">
              <li><strong>Decimal odds.</strong> Add 1 to the fraction. {exWin.n}/{exWin.d} is {money(exWin.oddsDecimal)}, and {exEw2.n}/{exEw2.d} is {money(exEw2.oddsDecimal)}.</li>
              <li><strong>All-in win.</strong> {rules.tokens} &times; the decimal odds, if your horse wins. Otherwise 0.</li>
              <li><strong>Each-way, win part.</strong> The decimal odds, if your horse wins.</li>
              <li><strong>Each-way, place part.</strong> 1 + {quarter} &times; (the decimal odds &minus; 1), if your horse finishes in a paid place. Further back means a smaller share of this part (see Each-way places).</li>
              <li><strong>A winning each-way pick</strong> gets the win part plus the full place part.</li>
              <li><strong>Points.</strong> Add the parts, multiply by {rules.multiplier} and round to a whole number.</li>
              <li>
                <strong>Worked example.</strong> {exEw2.n}/{exEw2.d} each-way, finishing {ordinal(exEw2.position)}. The win part is 0.
                The place part is 1 + {quarter} &times; ({money(exEw2.oddsDecimal)} &minus; 1) = {money(placePart)}.
                Times {rules.multiplier} is {exEw2.points} points.
              </li>
            </ul>
          </SubSection>
        </>
      ))}

      {sec('places', 'Each-way places', (
        <>
          <p className="hw-p">An each-way pick only pays a place part if your horse finishes in a paid place. The number of paid places depends on how many horses run. Non-runners are not counted.</p>
          <table className="hw-table">
            <thead>
              <tr><th scope="col">Runners</th><th scope="col">Places paid</th></tr>
            </thead>
            <tbody>
              {tiers.map((t, i) => (
                <tr key={t.from}>
                  <td>{fieldLabel(t, tiers, i)}</td>
                  <td className="hw-num">{placesLabel(t.placesPaid)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="hw-p">The place part gets smaller the further back your horse finishes.</p>
          <table className="hw-table">
            <thead>
              <tr><th scope="col">Finish</th><th scope="col">Place part</th><th scope="col">Paid with</th></tr>
            </thead>
            <tbody>
              {tapers.map(t => (
                <tr key={t.position}>
                  <td>{ordinal(t.position)}</td>
                  <td className="hw-num">{Math.round(t.share * 100)}%</td>
                  <td>{t.minRunners} or more runners</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="hw-p">Fewer than {eachWayFrom} runners means no each-way. Those races are win only.</p>
        </>
      ))}

      {sec('bonus', 'Bonus points', <BonusRules />)}

      {sec('nonrunners', 'Non-runners', (
        <ul className="hw-list">
          <li>If your horse is withdrawn, your pick switches to the race favourite automatically.</li>
          <li>The favourite is the horse with the shortest odds still running.</li>
          <li>You&rsquo;ll see a note on that race on your picks screen, so you know it changed.</li>
        </ul>
      ))}

      {sec('seasons', 'Seasons and groups', (
        <ul className="hw-list">
          <li>Each calendar month is a new season. Everyone&rsquo;s points reset on the 1st.</li>
          <li>Private groups use the same monthly table, so you can play against friends, family or colleagues.</li>
          <li>You&rsquo;re always on the main Saturday League table too.</li>
        </ul>
      ))}

      {sec('festivals', 'Festivals', (
        <ul className="hw-list">
          <li>Big race meetings run as festivals, with their own tournament and leaderboard.</li>
          <li>Picks lock 30 minutes before the first race each day.</li>
          <li>The scoring is the same as on a Saturday.</li>
          <li>Results go in after each race, and the festival leaderboard updates as they do.</li>
        </ul>
      ))}
    </div>
  )
}

export default function HowItWorksModal({ open, onClose, section }) {
  if (!open) return null
  return <Sheet section={section} onClose={onClose} />
}

// Mounted only while open, so each opening starts fresh (and honours `section`).
function Sheet({ section, onClose }) {
  const root = useRef(null)
  const closeBtn = useRef(null)
  const closeRef = useRef(onClose)
  useEffect(() => { closeRef.current = onClose })

  // Focus the close button; give focus back to whatever opened the sheet.
  useEffect(() => {
    const opener = document.activeElement
    closeBtn.current?.focus({ preventScroll: true })
    return () => {
      requestAnimationFrame(() => { if (opener?.isConnected) opener.focus({ preventScroll: true }) })
    }
  }, [])

  // Stop the page behind scrolling.
  useEffect(() => {
    const html = document.documentElement
    const before = [html.style.overflow, document.body.style.overflow]
    html.style.overflow = 'hidden'
    document.body.style.overflow = 'hidden'
    return () => { html.style.overflow = before[0]; document.body.style.overflow = before[1] }
  }, [])

  // Escape closes; Tab stays inside.
  useEffect(() => {
    const onKey = e => {
      if (e.key === 'Escape') { e.preventDefault(); closeRef.current?.(); return }
      if (e.key !== 'Tab') return
      const items = [...(root.current?.querySelectorAll(FOCUSABLE) || [])].filter(el => !el.closest('[hidden]'))
      if (!items.length) { e.preventDefault(); return }
      const first = items[0], last = items[items.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  return createPortal(
    <div className="hw" role="dialog" aria-modal="true" aria-labelledby="hw-title" ref={root}>
      <header className="hw-head">
        <div className="hw-head__in">
          <h1 className="hw-title" id="hw-title">How it works</h1>
          <p className="hw-sub">Everything you need to know about Silks League</p>
        </div>
        <button type="button" className="hw-close" aria-label="Close" onClick={() => onClose?.()} ref={closeBtn}>
          <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M3 3l12 12M15 3L3 15" />
          </svg>
        </button>
      </header>
      <div className="hw-scroll">
        <Body section={section} />
      </div>
    </div>,
    document.body,
  )
}
