// Hidden for now: the 2026 annual table has no place on the Leaderboard yet. Kept, with its loader
// (loadAnnualLeague in lib/leagueData.js), so it can come back. The table is as it was in pages/League.jsx.

// ── Annual League table ──────────────────────────────────────
export default function AnnualLeagueTable({ rows, seasons = [], onPlayerClick }) {
  function abbrev(name) {
    if (!name) return '?'
    return name.split(' ')[0].slice(0, 3)
  }

  if (!rows.length) {
    return (
      <div style={st.card}>
        <div style={st.empty}>No scores yet across 2026 seasons — check back after results are in.</div>
      </div>
    )
  }

  return (
    <div style={st.card}>
      {/* Desktop */}
      <div className="league-desktop-only" style={{ overflowX: 'auto' }}>
        <div style={st.tableHeader} className="league-row">
          <span style={{ minWidth: '40px' }}>#</span>
          <span style={{ flex: 1 }}>Player</span>
          {seasons.map(s => (
            <span key={s.id} style={st.colRight} className="league-col-data">{abbrev(s.name)}</span>
          ))}
          <span style={st.colRight} className="league-col-data">Total</span>
        </div>
        {rows.map((row, idx) => (
          <div
            key={row.userId}
            className="league-row"
            style={{ ...st.row, ...(row.isMe ? st.rowMe : {}), ...(idx < rows.length - 1 ? {} : st.rowLast) }}>
            <div style={st.rankCell}>
              {row.rank === 1 ? '🥇' : row.rank === 2 ? '🥈' : row.rank === 3 ? '🥉' : (
                <span style={st.rankNum}>{row.rank}</span>
              )}
            </div>
            <div style={st.nameCell}>
              <span
                style={{ ...st.playerName, ...(row.isMe ? st.playerNameMe : {}), cursor: 'pointer', textDecoration: 'underline dotted' }}
                onClick={() => onPlayerClick && onPlayerClick(row)}>
                {row.name}
              </span>
              {row.isMe && <span style={st.youBadge}>You</span>}
            </div>
            {seasons.map(s => (
              <div key={s.id} style={st.dataCell} className="league-col-data">
                {row.seasonPts[s.id] !== undefined
                  ? row.seasonPts[s.id]
                  : <span style={{ color: 'rgba(90,138,90,0.3)' }}>—</span>}
              </div>
            ))}
            <div style={{ ...st.dataCell, ...st.totalCell }} className="league-col-data">{row.total}</div>
          </div>
        ))}
      </div>

      {/* Mobile */}
      <div className="league-mobile-only">
        {rows.map((row, idx) => (
          <div
            key={row.userId}
            style={{
              ...st.mobileCard,
              ...(row.isMe ? st.mobileCardMe : {}),
              ...(idx < rows.length - 1 ? {} : { borderBottom: 'none' }),
            }}>
            <div style={st.mobileCardRank}>
              {row.rank === 1 ? '🥇' : row.rank === 2 ? '🥈' : row.rank === 3 ? '🥉' : (
                <span style={st.rankNum}>{row.rank}</span>
              )}
            </div>
            <div style={st.mobileCardMid}>
              <div style={st.mobileNameRow}>
                <span
                  style={{ ...st.playerName, ...(row.isMe ? st.playerNameMe : {}), cursor: 'pointer', textDecoration: 'underline dotted' }}
                  onClick={() => onPlayerClick && onPlayerClick(row)}>
                  {row.name}
                </span>
                {row.isMe && <span style={st.youBadge}>You</span>}
              </div>
              {seasons.length > 0 && (
                <div style={st.mobilePillsRow}>
                  {seasons.map(s => (
                    <span key={s.id} style={st.mobilePill}>
                      {abbrev(s.name)}&nbsp;
                      <span style={st.mobilePillVal}>
                        {row.seasonPts[s.id] !== undefined ? row.seasonPts[s.id] : '—'}
                      </span>
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div style={{ ...st.totalCell, fontSize: '1.4rem' }}>{row.total}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Styles (used by the annual table) ──────────────────────────
const st = {
  loadingInline: { textAlign: 'center', color: '#5a8a5a', padding: '2.5rem 1rem', fontSize: '0.875rem' },

  // Leaderboard card
  card: {
    background: 'linear-gradient(180deg, #152e12 0%, #0a1a08 100%)',
    border: '1px solid #c9a84c', borderLeft: '4px solid #c9a84c',
    borderRadius: '8px', overflow: 'hidden',
  },
  empty: { padding: '3rem 2rem', textAlign: 'center', color: '#5a8a5a', fontSize: '0.9rem' },
  tableHeader: {
    display: 'flex', alignItems: 'center', gap: '0.75rem',
    padding: '0.75rem 1.5rem',
    background: 'rgba(0,0,0,0.25)',
    borderBottom: '1px solid rgba(201,168,76,0.2)',
    fontSize: '0.7rem', fontWeight: '700', letterSpacing: '0.08em',
    textTransform: 'uppercase', color: '#5a8a5a',
  },
  colRight: { minWidth: '60px', textAlign: 'right' },
  row: {
    display: 'flex', alignItems: 'center', gap: '0.75rem',
    padding: '0.9rem 1.5rem',
    borderBottom: '1px solid rgba(201,168,76,0.1)',
    transition: 'background 0.15s',
  },
  rowLast: { borderBottom: 'none' },
  rowMe: {
    background: 'rgba(201,168,76,0.05)',
    borderLeft: '4px solid #c9a84c',
    paddingLeft: 'calc(1.5rem - 4px)',
  },
  rankCell: { minWidth: '40px', fontSize: '1.1rem', textAlign: 'center' },
  rankNum:  { fontSize: '0.85rem', color: '#5a8a5a', fontWeight: '600' },
  nameCell: { flex: 1, display: 'flex', alignItems: 'center', gap: '0.5rem' },
  playerName: { fontSize: '0.95rem', fontWeight: '500', color: '#e8f0e8' },
  playerNameMe: { color: '#c9a84c' },
  youBadge: {
    fontSize: '0.62rem', fontWeight: '700', letterSpacing: '0.06em',
    background: 'rgba(201,168,76,0.15)', color: '#c9a84c',
    padding: '0.15rem 0.45rem', borderRadius: '4px',
  },
  dataCell: { minWidth: '60px', textAlign: 'right', fontSize: '0.9rem', color: '#5a8a5a' },
  totalCell: {
    fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.3rem',
    color: '#c9a84c', letterSpacing: '0.03em',
  },

  // Mobile card layout
  mobileCard: {
    display: 'flex', alignItems: 'center', gap: '0.75rem',
    padding: '0.85rem 1.1rem',
    borderBottom: '1px solid rgba(201,168,76,0.1)',
  },
  mobileCardMe: {
    background: 'rgba(201,168,76,0.05)',
    borderLeft: '4px solid #c9a84c',
    paddingLeft: 'calc(1.1rem - 4px)',
  },
  mobileCardRank: {
    minWidth: '36px', fontSize: '1.1rem', textAlign: 'center', flexShrink: 0,
  },
  mobileCardMid: {
    flex: 1, display: 'flex', flexDirection: 'column', gap: '0.3rem', minWidth: 0,
  },
  mobileNameRow: {
    display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap',
  },
  mobilePillsRow: {
    display: 'flex', flexWrap: 'wrap', gap: '0.3rem', marginTop: '0.1rem',
  },
  mobilePill: {
    fontSize: '0.7rem', fontWeight: '500',
    background: 'rgba(201,168,76,0.07)',
    border: '1px solid rgba(201,168,76,0.15)',
    borderRadius: '4px', padding: '0.12rem 0.4rem',
    color: '#5a8a5a', whiteSpace: 'nowrap',
  },
  mobilePillVal: {
    color: '#c9a84c', fontWeight: '700',
  },
}
