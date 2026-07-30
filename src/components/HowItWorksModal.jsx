/**
 * HowItWorksModal — full-screen overlay explaining Silks League rules.
 * Triggered from the ProfileDropdown. Closes on overlay click or ✕ button.
 */

import { useEffect } from 'react'

const PLACE_TERMS = [
  { range: '2 – 4 runners',  places: 'Win only — no each-way' },
  { range: '5 – 7 runners',  places: 'Top 2' },
  { range: '8 – 15 runners', places: 'Top 3' },
  { range: '16+ runners',    places: 'Top 4' },
]

const POSITION_TAPER = [
  { pos: '2nd', taper: 'Full place value', note: 'Paid in every each-way field (5+ runners)' },
  { pos: '3rd', taper: '65% of place value', note: 'Paid in 8+ runner fields' },
  { pos: '4th', taper: '40% of place value', note: 'Paid in 16+ runner fields only' },
]

export default function HowItWorksModal({ open, onClose }) {
  // Lock body scroll while open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [open])

  if (!open) return null

  return (
    <div style={m.overlay} onClick={onClose}>
      <div style={m.sheet} onClick={e => e.stopPropagation()}>

        {/* ── Header ── */}
        <div style={m.header}>
          <div>
            <div style={m.title}>HOW IT WORKS</div>
            <div style={m.subtitle}>Everything you need to know about Silks League</div>
          </div>
          <button style={m.closeBtn} onClick={onClose} aria-label="Close">✕</button>
        </div>

        {/* ── Scrollable content ── */}
        <div style={m.content}>

          {/* 1 — The Basics */}
          <Section label="The Basics">
            Every Saturday, 7 races are selected from across the UK racing card. Pick one horse per race
            before the 12pm Saturday deadline. During festival weeks like Royal Ascot, additional daily
            races are also available alongside the Saturday league — giving you more chances to score points.
          </Section>

          {/* 2 — Making Your Picks */}
          <Section label="Making Your Picks">
            Head to the Picks screen before 12pm on Saturday. Choose one horse per race. Once picks lock
            at 12pm they're final — no changes. During festivals, picks for each day's races also close
            at 12pm on that day.
          </Section>

          {/* 3 — Non-Runners */}
          <Section label="Non-Runners">
            If your selected horse is withdrawn from a race before the off, you'll automatically be
            assigned the race favourite based on the current odds. You'll see a notification on your
            picks screen showing your original pick and your replacement.
          </Section>

          {/* 4 — Scoring */}
          <div style={m.card}>
            <div style={m.sectionLabel}>Scoring — 2 Tokens Per Race</div>
            <p style={m.bodyText}>
              Every race, you get 2 tokens to back your pick with. Horses <strong>shorter than 4/1</strong> are
              win-only — both tokens ride on the win. Horses <strong>4/1 or bigger</strong> let you choose how
              to split them:
            </p>
            <div style={m.scoreGrid}>
              <div style={{ ...m.scoreCard, ...m.scoreGold }}>
                <span style={m.scorePos}>All-in Win</span>
                <span style={m.scoreValSmall}>Both tokens on the win</span>
              </div>
              <div style={{ ...m.scoreCard, ...m.scoreSilver }}>
                <span style={m.scorePos}>Each-way</span>
                <span style={m.scoreValSmall}>1 win token + 1 place token</span>
              </div>
            </div>
            <p style={m.bodyText}>
              <strong>All-in Win</strong> pays out only if your horse wins — but pays big: 2 × the decimal odds,
              scaled up ×10. <strong>Each-way</strong> pays a smaller win amount, plus a place amount if your horse
              finishes in the paid places (see below) — built from ¼ of the odds, tapered down the further back
              it finishes: full value for 2nd, 65% for 3rd, and 40% for 4th in the biggest fields. The picks screen
              always shows you the exact points on offer before you confirm.
            </p>
            <div style={m.scoreNote}>No cap — the bigger the odds, the bigger the reward.</div>
          </div>

          {/* 5 — Each-Way Place Terms */}
          <div style={m.card}>
            <div style={m.sectionLabel}>Each-Way Place Terms</div>
            <div style={m.oddsNote}>
              How many places pay out on an each-way pick depends on the number of runners in the race
              (counted at the picks deadline).
            </div>
            <table style={m.oddsTable}>
              <thead>
                <tr>
                  <th style={m.oddsTh}>Field Size</th>
                  <th style={{ ...m.oddsTh, textAlign: 'center' }}>Places Paid</th>
                </tr>
              </thead>
              <tbody>
                {PLACE_TERMS.map(row => (
                  <tr key={row.range}>
                    <td style={m.oddsTd}>{row.range}</td>
                    <td style={{ ...m.oddsTd, textAlign: 'center', color: '#c9a84c', fontWeight: '600' }}>{row.places}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 6 — Position Taper */}
          <div style={m.card}>
            <div style={m.sectionLabel}>Position Taper</div>
            <div style={m.oddsNote}>
              The place portion of an each-way pick isn't flat — it shrinks the further back your horse finishes.
            </div>
            <table style={m.oddsTable}>
              <thead>
                <tr>
                  <th style={m.oddsTh}>Finish</th>
                  <th style={{ ...m.oddsTh, textAlign: 'center' }}>Place Value</th>
                  <th style={{ ...m.oddsTh, textAlign: 'right' }}>When It Pays</th>
                </tr>
              </thead>
              <tbody>
                {POSITION_TAPER.map(row => (
                  <tr key={row.pos}>
                    <td style={m.oddsTd}>{row.pos}</td>
                    <td style={{ ...m.oddsTd, textAlign: 'center', color: '#c9a84c', fontWeight: '600' }}>{row.taper}</td>
                    <td style={{ ...m.oddsTd, textAlign: 'right', color: '#5a8a5a', fontSize: '0.72rem' }}>{row.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 7 — Seasons */}
          <Section label="Seasons">
            Silks League runs on monthly seasons — each calendar month is a fresh competition. Your points
            reset at the start of each new month and everyone competes for the monthly title.
          </Section>

          {/* 8 — Joining Mid-Season */}
          <Section label="Joining Mid-Season">
            Joined part way through the month? No problem. As soon as the first race week of the season
            has been played, any new joiner is automatically credited with points equal to the lowest score
            on the active leaderboard — so you're competitive from your very first Saturday, never starting
            from zero while everyone else has a head start.
          </Section>

          {/* 9 — Groups */}
          <Section label="Groups">
            Create or join a private group to compete against friends, family or colleagues alongside the
            main league. Group standings run on the same monthly season format.
          </Section>

          {/* 10 — Festivals */}
          <Section label="Festivals">
            During major race meetings like Royal Ascot and Cheltenham, special festival tournaments run
            alongside the regular weekly game with their own separate leaderboard. Festivals span multiple
            days — picks close at 12pm each day, and the same scoring system applies. Points accumulate
            across all days of the festival, with a combined leaderboard updated after each day's racing.
          </Section>

        </div>
      </div>
    </div>
  )
}

function Section({ label, children }) {
  return (
    <div style={m.card}>
      <div style={m.sectionLabel}>{label}</div>
      <p style={m.bodyText}>{children}</p>
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────
const m = {
  overlay: {
    position: 'fixed', inset: 0, zIndex: 10000,
    background: 'rgba(0,0,0,0.8)',
    display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
    padding: '1rem',
    overflowY: 'auto',
  },
  sheet: {
    width: '100%', maxWidth: '680px',
    background: '#0a1a08',
    border: '1px solid rgba(201,168,76,0.25)',
    borderRadius: '16px',
    marginTop: '2rem', marginBottom: '2rem',
    fontFamily: "'DM Sans', sans-serif",
    overflow: 'hidden',
    flexShrink: 0,
  },

  // Header
  header: {
    display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
    padding: '1.75rem 1.75rem 1.25rem',
    borderBottom: '1px solid rgba(201,168,76,0.12)',
    background: 'linear-gradient(180deg, #152e12 0%, #0a1a08 100%)',
    gap: '1rem',
  },
  title: {
    fontFamily: "'Bebas Neue', sans-serif",
    fontSize: '2.2rem', color: '#c9a84c', letterSpacing: '0.1em', lineHeight: 1,
  },
  subtitle: {
    fontSize: '0.85rem', color: '#8ab88a', marginTop: '0.4rem',
    fontFamily: "'DM Sans', sans-serif",
  },
  closeBtn: {
    background: 'rgba(201,168,76,0.08)', border: '1px solid rgba(201,168,76,0.2)',
    color: '#c9a84c', fontSize: '1rem', borderRadius: '8px',
    width: '36px', height: '36px', cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontFamily: "'DM Sans', sans-serif", flexShrink: 0,
    lineHeight: 1,
  },

  // Content wrapper
  content: {
    padding: '1.25rem 1.5rem 1.75rem',
    display: 'flex', flexDirection: 'column', gap: '0.85rem',
  },

  // Section card
  card: {
    background: 'linear-gradient(180deg, #152e12 0%, #0a1a08 100%)',
    border: '1px solid rgba(201,168,76,0.2)',
    borderRadius: '10px',
    padding: '1.1rem 1.25rem',
  },
  sectionLabel: {
    fontSize: '10px', fontWeight: '700', color: '#c9a84c',
    letterSpacing: '3px', textTransform: 'uppercase',
    marginBottom: '0.65rem', fontFamily: "'DM Sans', sans-serif",
  },
  bodyText: {
    fontSize: '14px', color: '#e8dcc8', lineHeight: 1.75, margin: 0,
    fontFamily: "'DM Sans', sans-serif",
  },

  // Scoring cards
  scoreGrid: {
    display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.5rem',
    marginBottom: '0.75rem',
  },
  scoreCard: {
    borderRadius: '8px', padding: '0.65rem 0.4rem',
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px',
  },
  scoreGold:   { background: 'linear-gradient(135deg, #c9a84c 0%, #8a6f20 100%)' },
  scoreSilver: { background: 'linear-gradient(135deg, #94a3b8 0%, #475569 100%)' },
  scoreBronze: { background: 'linear-gradient(135deg, #b87d4b 0%, #7c4a1e 100%)' },
  scoreEmpty:  { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' },
  scorePos: {
    fontSize: '9px', fontWeight: '600', color: 'rgba(255,255,255,0.75)',
    textTransform: 'uppercase', letterSpacing: '0.04em', textAlign: 'center',
    fontFamily: "'DM Sans', sans-serif",
  },
  scoreVal: {
    fontFamily: "'Bebas Neue', sans-serif",
    fontSize: '1.25rem', color: '#fff', letterSpacing: '0.04em', lineHeight: 1,
  },
  scoreValSmall: {
    fontSize: '0.72rem', color: 'rgba(255,255,255,0.85)', textAlign: 'center', lineHeight: 1.3,
    fontFamily: "'DM Sans', sans-serif",
  },
  scoreNote: {
    fontSize: '11px', color: '#5a8a5a', textAlign: 'center',
    fontFamily: "'DM Sans', sans-serif",
  },

  // Odds table
  oddsNote: {
    fontSize: '0.72rem', color: '#5a8a5a', marginBottom: '0.75rem', lineHeight: 1.5,
    fontFamily: "'DM Sans', sans-serif",
  },
  oddsTable: { width: '100%', borderCollapse: 'collapse' },
  oddsTh: {
    fontSize: '0.7rem', fontWeight: '600', color: '#5a8a5a',
    letterSpacing: '0.06em', textTransform: 'uppercase',
    paddingBottom: '0.4rem',
    borderBottom: '1px solid rgba(201,168,76,0.12)',
    textAlign: 'left', fontFamily: "'DM Sans', sans-serif",
  },
  oddsTd: {
    fontSize: '0.8rem', color: '#e8f0e8',
    padding: '0.35rem 0',
    borderBottom: '1px solid rgba(255,255,255,0.04)',
    fontFamily: "'DM Sans', sans-serif",
  },
}
