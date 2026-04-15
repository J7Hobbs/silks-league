/**
 * Silks League — Admin Panel
 *
 * Access: logged-in users with is_admin = true in profiles table
 *
 * TO MAKE A USER ADMIN, run this in Supabase → SQL Editor:
 *   UPDATE profiles SET is_admin = true WHERE id = '[user_uuid]';
 *   (Find user UUIDs at: supabase.com → Authentication → Users)
 */

import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

// ── Points calculation (mirrors the SQL calculate_points function) ──────────
// If you change this logic, update the SQL function too.
function parseFractionalOdds(str) {
  if (!str) return null
  const s = str.trim().toLowerCase()
  if (s === 'evs' || s === 'evens') return 2.0
  const parts = s.split('/')
  if (parts.length === 2) {
    const n = parseFloat(parts[0])
    const d = parseFloat(parts[1])
    if (!isNaN(n) && !isNaN(d) && d !== 0) return parseFloat(((n / d) + 1).toFixed(2))
  }
  const dec = parseFloat(s)
  if (!isNaN(dec) && dec > 1) return dec
  return null
}

function calcPoints(position, spDecimal) {
  const base = position === 1 ? 25 : position === 2 ? 15 : position === 3 ? 10 : 0
  let bonus = 0
  if (position === 1) {
    if (spDecimal >= 21.0)      bonus = 15
    else if (spDecimal >= 12.0) bonus = 10
    else if (spDecimal >= 5.5)  bonus = 5
    else if (spDecimal >= 3.0)  bonus = 2
  } else if (position === 2 || position === 3) {
    if (spDecimal >= 21.0)      bonus = 4
    else if (spDecimal >= 12.0) bonus = 3
    else if (spDecimal >= 5.5)  bonus = 2
    else if (spDecimal >= 3.0)  bonus = 1
  }
  return { base, bonus, total: Math.min(base + bonus, 40) }
}

// ────────────────────────────────────────────────────────────────────────────

export default function Admin() {
  const navigate = useNavigate()

  // Auth
  const [authLoading, setAuthLoading] = useState(true)

  // UI
  const [activeTab, setActiveTab] = useState('seasons')
  const [msg, setMsg]             = useState({ type: '', text: '' })
  const [loading, setLoading]     = useState(false)

  // ── Section 1: Seasons ──
  const [seasons, setSeasons]               = useState([])
  const [activeSeason, setActiveSeason]     = useState(null)
  const [showSeasonForm, setShowSeasonForm] = useState(false)
  const [seasonForm, setSeasonForm]         = useState({
    name: '', quarter: 'Q1', year: new Date().getFullYear(), startDate: '', endDate: '',
  })

  // ── Section 2: Race week & races ──
  const [currentWeek, setCurrentWeek]       = useState(null)
  const [showWeekForm, setShowWeekForm]     = useState(false)
  const [weekDate, setWeekDate]             = useState('')
  const [races, setRaces]                   = useState([])
  const [showRaceForm, setShowRaceForm]     = useState({})  // keyed by race_number
  const [raceForms, setRaceForms]           = useState({})  // keyed by race_number
  const [runners, setRunners]               = useState({})  // keyed by race_id
  const [runnerInput, setRunnerInput]       = useState({})  // keyed by race_id

  // ── Section 3: Results ──
  const [raceResults, setRaceResults]   = useState({})  // keyed by race_id
  const [resultForms, setResultForms]   = useState({})  // keyed by race_id

  // ── Section 4: Leaderboard ──
  const [leaderboard, setLeaderboard] = useState([])

  // ── Init ────────────────────────────────────────────────────
  useEffect(() => { init() }, [])

  async function init() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { navigate('/auth'); return }

    const { data: profile } = await supabase
      .from('profiles').select('is_admin').eq('id', user.id).single()

    if (!profile?.is_admin) { navigate('/dashboard'); return }

    setAuthLoading(false)
    await loadSeasons()
  }

  // ── Data loaders ────────────────────────────────────────────
  async function loadSeasons() {
    const { data } = await supabase
      .from('seasons').select('*').order('created_at', { ascending: false })
    setSeasons(data || [])
    const active = data?.find(s => s.is_active)
    setActiveSeason(active || null)
    if (active) await loadCurrentWeek(active.id)
  }

  async function loadCurrentWeek(seasonId) {
    const { data } = await supabase
      .from('race_weeks').select('*').eq('season_id', seasonId)
      .order('saturday_date', { ascending: false }).limit(1)
    const week = data?.[0] || null
    setCurrentWeek(week)
    if (week) await loadRaces(week.id)
  }

  async function loadRaces(weekId) {
    const { data } = await supabase
      .from('races').select('*').eq('race_week_id', weekId).order('race_number')
    setRaces(data || [])
    for (const race of (data || [])) {
      await loadRunners(race.id)
      await loadResults(race.id)
    }
  }

  async function loadRunners(raceId) {
    const { data } = await supabase
      .from('runners').select('*').eq('race_id', raceId).order('created_at')
    setRunners(prev => ({ ...prev, [raceId]: data || [] }))
  }

  async function loadResults(raceId) {
    const { data } = await supabase
      .from('results').select('*').eq('race_id', raceId).order('position')
    if (data?.length) setRaceResults(prev => ({ ...prev, [raceId]: data }))
  }

  async function loadLeaderboard() {
    if (!activeSeason) return
    const { data: weeks } = await supabase
      .from('race_weeks').select('id').eq('season_id', activeSeason.id)
    if (!weeks?.length) { setLeaderboard([]); return }

    const { data: raceList } = await supabase
      .from('races').select('id').in('race_week_id', weeks.map(w => w.id))
    if (!raceList?.length) { setLeaderboard([]); return }

    const thisWeekRaceIds = new Set()
    if (currentWeek) {
      const { data: twRaces } = await supabase
        .from('races').select('id').eq('race_week_id', currentWeek.id)
      twRaces?.forEach(r => thisWeekRaceIds.add(r.id))
    }

    const { data: scores } = await supabase
      .from('scores')
      .select('user_id, total_points, race_id, profiles(full_name)')
      .in('race_id', raceList.map(r => r.id))

    const totals = {}
    for (const s of (scores || [])) {
      if (!totals[s.user_id]) {
        totals[s.user_id] = { name: s.profiles?.full_name || 'Unknown', total: 0, week: 0 }
      }
      totals[s.user_id].total += s.total_points
      if (thisWeekRaceIds.has(s.race_id)) totals[s.user_id].week += s.total_points
    }

    const sorted = Object.entries(totals)
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10)
    setLeaderboard(sorted)
  }

  // ── Season actions ───────────────────────────────────────────
  async function createSeason(e) {
    e.preventDefault()
    setLoading(true)
    const { error } = await supabase.from('seasons').insert({
      name: seasonForm.name,
      quarter: seasonForm.quarter,
      year: parseInt(seasonForm.year),
      start_date: seasonForm.startDate,
      end_date: seasonForm.endDate,
      is_active: false,
    })
    setLoading(false)
    if (error) { showMsg('error', error.message); return }
    showMsg('success', 'Season created')
    setShowSeasonForm(false)
    setSeasonForm({ name: '', quarter: 'Q1', year: new Date().getFullYear(), startDate: '', endDate: '' })
    await loadSeasons()
  }

  async function activateSeason(id) {
    setLoading(true)
    await supabase.from('seasons').update({ is_active: false }).neq('id', id)
    await supabase.from('seasons').update({ is_active: true }).eq('id', id)
    await loadSeasons()
    setLoading(false)
    showMsg('success', 'Active season updated')
  }

  // ── Race week actions ────────────────────────────────────────
  async function createRaceWeek(e) {
    e.preventDefault()
    if (!activeSeason) { showMsg('error', 'Set an active season first'); return }
    setLoading(true)
    const { data: weekList } = await supabase
      .from('race_weeks').select('id').eq('season_id', activeSeason.id)
    const weekNum = (weekList?.length || 0) + 1
    const { error } = await supabase.from('race_weeks').insert({
      season_id: activeSeason.id,
      week_number: weekNum,
      saturday_date: weekDate,
      picks_deadline: `${weekDate}T11:00:00`,
      is_locked: false,
    })
    setLoading(false)
    if (error) { showMsg('error', error.message); return }
    showMsg('success', 'Race week created')
    setShowWeekForm(false)
    await loadCurrentWeek(activeSeason.id)
  }

  // ── Race actions ─────────────────────────────────────────────
  async function saveRace(raceNumber) {
    if (!currentWeek) return
    const form = raceForms[raceNumber] || {}
    if (!form.venue || !form.raceName || !form.raceTime) {
      showMsg('error', 'Please fill in all race fields'); return
    }
    setLoading(true)
    const { error } = await supabase.from('races').insert({
      race_week_id: currentWeek.id,
      race_number:  raceNumber,
      venue:        form.venue,
      race_name:    form.raceName,
      race_time:    form.raceTime,
    })
    setLoading(false)
    if (error) { showMsg('error', error.message); return }
    showMsg('success', `Race ${raceNumber} saved`)
    setShowRaceForm(prev => ({ ...prev, [raceNumber]: false }))
    await loadRaces(currentWeek.id)
  }

  // ── Runner actions ───────────────────────────────────────────
  async function addRunner(raceId) {
    const name = (runnerInput[raceId] || '').trim()
    if (!name) return
    setLoading(true)
    const { error } = await supabase.from('runners').insert({ race_id: raceId, horse_name: name })
    setLoading(false)
    if (error) { showMsg('error', error.message); return }
    setRunnerInput(prev => ({ ...prev, [raceId]: '' }))
    await loadRunners(raceId)
  }

  async function removeRunner(raceId, runnerId) {
    await supabase.from('runners').delete().eq('id', runnerId)
    setRunners(prev => ({ ...prev, [raceId]: prev[raceId].filter(r => r.id !== runnerId) }))
  }

  // ── Results actions ──────────────────────────────────────────
  async function submitResults(race) {
    const form = resultForms[race.id] || {}
    if (!form.horse1 || !form.horse2 || !form.horse3) {
      showMsg('error', 'Please select all 3 finishers'); return
    }
    const sp1 = parseFractionalOdds(form.sp1)
    const sp2 = parseFractionalOdds(form.sp2)
    const sp3 = parseFractionalOdds(form.sp3)
    if (!sp1 || !sp2 || !sp3) {
      showMsg('error', 'Invalid SP format — use e.g. 7/1, 9/2, Evs'); return
    }
    setLoading(true)

    const { error: resErr } = await supabase.from('results').insert([
      { race_id: race.id, position: 1, horse_name: form.horse1, starting_price_decimal: sp1, starting_price_display: form.sp1.trim() },
      { race_id: race.id, position: 2, horse_name: form.horse2, starting_price_decimal: sp2, starting_price_display: form.sp2.trim() },
      { race_id: race.id, position: 3, horse_name: form.horse3, starting_price_decimal: sp3, starting_price_display: form.sp3.trim() },
    ])
    if (resErr) { showMsg('error', resErr.message); setLoading(false); return }

    // Calculate and save scores for all pickers
    const { data: picks } = await supabase
      .from('picks')
      .select('*, runners(horse_name)')
      .eq('race_id', race.id)

    if (picks?.length) {
      const placed = {
        [form.horse1]: { position: 1, sp: sp1 },
        [form.horse2]: { position: 2, sp: sp2 },
        [form.horse3]: { position: 3, sp: sp3 },
      }
      const scoresToInsert = picks.map(pick => {
        const horseName = pick.runners?.horse_name
        const p = placed[horseName]
        if (p) {
          const { base, bonus, total } = calcPoints(p.position, p.sp)
          return { user_id: pick.user_id, race_id: race.id, pick_id: pick.id, base_points: base, bonus_points: bonus, total_points: total, position_achieved: p.position }
        }
        return { user_id: pick.user_id, race_id: race.id, pick_id: pick.id, base_points: 0, bonus_points: 0, total_points: 0, position_achieved: null }
      })
      await supabase.from('scores').upsert(scoresToInsert)
    }

    await loadResults(race.id)
    setLoading(false)
    showMsg('success', `Race ${race.race_number} results saved — scores calculated`)
  }

  // ── Helpers ──────────────────────────────────────────────────
  function showMsg(type, text) {
    setMsg({ type, text })
    setTimeout(() => setMsg({ type: '', text: '' }), 5000)
  }

  // ── Loading gate ────────────────────────────────────────────
  if (authLoading) {
    return (
      <div style={{ minHeight: '100vh', background: '#0a1a08', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: '#c9a84c', fontFamily: "'DM Sans', sans-serif", fontSize: '0.9rem' }}>
          Checking admin access…
        </div>
      </div>
    )
  }

  const TABS = [
    { id: 'seasons',     label: '01 · Seasons'    },
    { id: 'races',       label: '02 · This Week'  },
    { id: 'results',     label: '03 · Results'    },
    { id: 'leaderboard', label: '04 · Leaderboard'},
  ]

  // ── Render ───────────────────────────────────────────────────
  return (
    <div style={st.page}>

      {/* Top bar */}
      <nav style={st.nav}>
        <div style={st.navInner}>
          <span style={st.navLogo}>Silks League</span>
          <span style={st.adminBadge}>Admin Panel</span>
          <a href="/dashboard" style={st.navBack}>← Dashboard</a>
        </div>
      </nav>

      {/* Tab bar */}
      <div style={st.tabBarWrap}>
        <div style={st.tabBar}>
          {TABS.map(tab => (
            <button
              key={tab.id}
              style={{ ...st.tabBtn, ...(activeTab === tab.id ? st.tabBtnActive : {}) }}
              onClick={() => {
                setActiveTab(tab.id)
                if (tab.id === 'leaderboard') loadLeaderboard()
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Message banner */}
      {msg.text && (
        <div style={{ ...st.msgBanner, ...(msg.type === 'error' ? st.msgError : st.msgSuccess) }}>
          <span>{msg.text}</span>
          <button onClick={() => setMsg({ type: '', text: '' })} style={st.msgClose}>×</button>
        </div>
      )}

      <main style={st.main}>

        {/* ══════════════════════════════════════
            SECTION 1 — SEASONS
        ══════════════════════════════════════ */}
        {activeTab === 'seasons' && (
          <div style={st.section}>
            <div style={st.sectionHeader}>
              <h2 style={st.sectionTitle}>Season Management</h2>
              <button style={st.btnGold} onClick={() => setShowSeasonForm(v => !v)}>
                {showSeasonForm ? 'Cancel' : '+ New Season'}
              </button>
            </div>

            {/* Active season card */}
            {activeSeason ? (
              <div style={st.infoCard}>
                <div style={st.infoCardBadge}>Active Season</div>
                <div style={st.infoCardTitle}>{activeSeason.name}</div>
                <div style={st.infoCardSub}>
                  {activeSeason.quarter} · {activeSeason.start_date} → {activeSeason.end_date}
                </div>
              </div>
            ) : (
              <div style={st.warningCard}>
                No active season. Create one below and click "Set Active".
              </div>
            )}

            {/* New season form */}
            {showSeasonForm && (
              <form onSubmit={createSeason} style={st.formCard}>
                <div style={st.formTitle}>Create New Season</div>
                <div style={st.formGrid}>
                  <div style={st.formField}>
                    <label style={st.label}>Season Name</label>
                    <input style={st.input} placeholder="Q1 2026"
                      value={seasonForm.name}
                      onChange={e => setSeasonForm({ ...seasonForm, name: e.target.value })} required />
                  </div>
                  <div style={st.formField}>
                    <label style={st.label}>Quarter</label>
                    <select style={st.input} value={seasonForm.quarter}
                      onChange={e => setSeasonForm({ ...seasonForm, quarter: e.target.value })}>
                      <option>Q1</option><option>Q2</option><option>Q3</option><option>Q4</option>
                    </select>
                  </div>
                  <div style={st.formField}>
                    <label style={st.label}>Year</label>
                    <input style={st.input} type="number" value={seasonForm.year}
                      onChange={e => setSeasonForm({ ...seasonForm, year: e.target.value })} required />
                  </div>
                  <div style={st.formField}>
                    <label style={st.label}>Start Date</label>
                    <input style={st.input} type="date" value={seasonForm.startDate}
                      onChange={e => setSeasonForm({ ...seasonForm, startDate: e.target.value })} required />
                  </div>
                  <div style={st.formField}>
                    <label style={st.label}>End Date</label>
                    <input style={st.input} type="date" value={seasonForm.endDate}
                      onChange={e => setSeasonForm({ ...seasonForm, endDate: e.target.value })} required />
                  </div>
                </div>
                <div style={st.formActions}>
                  <button type="submit" style={st.btnGold} disabled={loading}>
                    {loading ? 'Saving…' : 'Create Season'}
                  </button>
                  <button type="button" style={st.btnGhost} onClick={() => setShowSeasonForm(false)}>
                    Cancel
                  </button>
                </div>
              </form>
            )}

            {/* Seasons list */}
            {seasons.length > 0 && (
              <div style={st.tableCard}>
                <div style={st.tableHead}>
                  <span style={{ flex: 2 }}>Name</span>
                  <span style={{ flex: 1 }}>Quarter</span>
                  <span style={{ flex: 2 }}>Dates</span>
                  <span style={{ flex: 1 }}>Status</span>
                  <span style={{ flex: 1 }}>Action</span>
                </div>
                {seasons.map(s => (
                  <div key={s.id} style={st.tableRow}>
                    <span style={{ flex: 2, color: '#e8f0e8' }}>{s.name}</span>
                    <span style={{ flex: 1, color: '#5a8a5a' }}>{s.quarter} {s.year}</span>
                    <span style={{ flex: 2, color: '#5a8a5a', fontSize: '0.8rem' }}>
                      {s.start_date} → {s.end_date}
                    </span>
                    <span style={{ flex: 1 }}>
                      {s.is_active
                        ? <span style={st.badgeGreen}>Active</span>
                        : <span style={st.badgeMuted}>Inactive</span>}
                    </span>
                    <span style={{ flex: 1 }}>
                      {!s.is_active && (
                        <button style={st.btnSmall} onClick={() => activateSeason(s.id)} disabled={loading}>
                          Set Active
                        </button>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ══════════════════════════════════════
            SECTION 2 — THIS WEEK'S RACES
        ══════════════════════════════════════ */}
        {activeTab === 'races' && (
          <div style={st.section}>
            <div style={st.sectionHeader}>
              <h2 style={st.sectionTitle}>This Week's Races</h2>
              {activeSeason && !currentWeek && (
                <button style={st.btnGold} onClick={() => setShowWeekForm(v => !v)}>
                  + Create Race Week
                </button>
              )}
            </div>

            {!activeSeason && (
              <div style={st.warningCard}>No active season — go to the Seasons tab first.</div>
            )}

            {activeSeason && !currentWeek && !showWeekForm && (
              <div style={st.warningCard}>
                No race week yet. Click "Create Race Week" to set up this Saturday.
              </div>
            )}

            {/* Create race week form */}
            {showWeekForm && (
              <form onSubmit={createRaceWeek} style={st.formCard}>
                <div style={st.formTitle}>Create Race Week</div>
                <div style={st.formField}>
                  <label style={st.label}>Saturday Date</label>
                  <input style={{ ...st.input, maxWidth: '220px' }} type="date"
                    value={weekDate} onChange={e => setWeekDate(e.target.value)} required />
                </div>
                <p style={{ fontSize: '0.8rem', color: '#5a8a5a', margin: '0.5rem 0 1rem' }}>
                  Picks deadline will automatically be set to 11:00am on this date.
                </p>
                <div style={st.formActions}>
                  <button type="submit" style={st.btnGold} disabled={loading}>Create Week</button>
                  <button type="button" style={st.btnGhost} onClick={() => setShowWeekForm(false)}>Cancel</button>
                </div>
              </form>
            )}

            {currentWeek && (
              <>
                {/* Week summary */}
                <div style={st.infoCard}>
                  <div style={st.infoCardBadge}>Current Week</div>
                  <div style={st.infoCardTitle}>
                    Week {currentWeek.week_number} · {currentWeek.saturday_date}
                  </div>
                  <div style={st.infoCardSub}>
                    Picks deadline: 11:00am · {races.length}/5 races set up
                  </div>
                  {/* Progress bar */}
                  <div style={st.progressBar}>
                    <div style={{ ...st.progressFill, width: `${(races.length / 5) * 100}%` }} />
                  </div>
                  {/* Race number pills */}
                  <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.75rem' }}>
                    {[1,2,3,4,5].map(n => {
                      const done = !!races.find(r => r.race_number === n)
                      return (
                        <div key={n} style={{
                          width: '32px', height: '32px', borderRadius: '6px',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: '0.8rem', fontWeight: '700',
                          background: done ? 'rgba(74,222,128,0.12)' : 'rgba(0,0,0,0.3)',
                          border: `1px solid ${done ? 'rgba(74,222,128,0.35)' : 'rgba(201,168,76,0.12)'}`,
                          color: done ? '#4ade80' : '#5a8a5a',
                        }}>
                          {n}
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* Race cards */}
                {[1,2,3,4,5].map(raceNum => {
                  const race         = races.find(r => r.race_number === raceNum)
                  const raceRunners  = race ? (runners[race.id] || []) : []
                  const formOpen     = !!showRaceForm[raceNum]

                  return (
                    <div key={raceNum} style={st.raceCard}>
                      {/* Header */}
                      <div style={st.raceCardHead}>
                        <span style={st.raceCardNum}>Race {raceNum}</span>
                        {race ? (
                          <span style={st.raceCardMeta}>
                            <strong style={{ color: '#e8f0e8' }}>{race.race_time}</strong>
                            {' · '}
                            <span style={{ color: '#c9a84c' }}>{race.venue}</span>
                            {' · '}
                            <span style={{ color: '#5a8a5a' }}>{race.race_name}</span>
                          </span>
                        ) : (
                          <button style={st.btnSmall}
                            onClick={() => setShowRaceForm(p => ({ ...p, [raceNum]: !p[raceNum] }))}>
                            {formOpen ? 'Cancel' : '+ Add Race'}
                          </button>
                        )}
                      </div>

                      {/* Race entry form */}
                      {!race && formOpen && (
                        <div style={st.raceCardBody}>
                          <div style={st.formGrid}>
                            <div style={st.formField}>
                              <label style={st.label}>Race Time</label>
                              <input style={st.input} placeholder="13:30"
                                value={raceForms[raceNum]?.raceTime || ''}
                                onChange={e => setRaceForms(p => ({ ...p, [raceNum]: { ...p[raceNum], raceTime: e.target.value } }))} />
                            </div>
                            <div style={st.formField}>
                              <label style={st.label}>Venue</label>
                              <input style={st.input} placeholder="Cheltenham"
                                value={raceForms[raceNum]?.venue || ''}
                                onChange={e => setRaceForms(p => ({ ...p, [raceNum]: { ...p[raceNum], venue: e.target.value } }))} />
                            </div>
                            <div style={{ ...st.formField, gridColumn: '1 / -1' }}>
                              <label style={st.label}>Race Name</label>
                              <input style={st.input} placeholder="Novice Hurdle"
                                value={raceForms[raceNum]?.raceName || ''}
                                onChange={e => setRaceForms(p => ({ ...p, [raceNum]: { ...p[raceNum], raceName: e.target.value } }))} />
                            </div>
                          </div>
                          <button style={{ ...st.btnGold, marginTop: '0.85rem' }}
                            onClick={() => saveRace(raceNum)} disabled={loading}>
                            Save Race
                          </button>
                        </div>
                      )}

                      {/* Runners section (only when race exists) */}
                      {race && (
                        <div style={st.runnersSection}>
                          <div style={st.runnersLabel}>
                            Runners ({raceRunners.length})
                          </div>
                          {raceRunners.length > 0 && (
                            <div style={st.runnerChips}>
                              {raceRunners.map(runner => (
                                <div key={runner.id} style={st.chip}>
                                  {runner.horse_name}
                                  <button onClick={() => removeRunner(race.id, runner.id)} style={st.chipRemove}>
                                    ×
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                          <div style={st.addRunnerRow}>
                            <input
                              style={{ ...st.input, flex: 1 }}
                              placeholder="Horse name"
                              value={runnerInput[race.id] || ''}
                              onChange={e => setRunnerInput(p => ({ ...p, [race.id]: e.target.value }))}
                              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addRunner(race.id) } }}
                            />
                            <button style={st.btnGold} onClick={() => addRunner(race.id)} disabled={loading}>
                              Add
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </>
            )}
          </div>
        )}

        {/* ══════════════════════════════════════
            SECTION 3 — ENTER RESULTS
        ══════════════════════════════════════ */}
        {activeTab === 'results' && (
          <div style={st.section}>
            <div style={st.sectionHeader}>
              <h2 style={st.sectionTitle}>Enter Results</h2>
              {currentWeek && (
                <span style={st.weekLabel}>
                  Week {currentWeek.week_number} · {currentWeek.saturday_date}
                </span>
              )}
            </div>

            {!currentWeek && (
              <div style={st.warningCard}>No race week set up — go to "This Week" first.</div>
            )}
            {currentWeek && races.length === 0 && (
              <div style={st.warningCard}>No races set up — add races in "This Week" first.</div>
            )}

            {races.map(race => {
              const raceRunners    = runners[race.id] || []
              const existingRes    = raceResults[race.id]
              const isSubmitted    = !!(existingRes?.length)
              const form           = resultForms[race.id] || {}

              return (
                <div key={race.id} style={{ ...st.raceCard, ...(isSubmitted ? st.raceCardDone : {}) }}>
                  <div style={st.raceCardHead}>
                    <span style={st.raceCardNum}>Race {race.race_number}</span>
                    <span style={st.raceCardMeta}>
                      <strong style={{ color: '#e8f0e8' }}>{race.race_time}</strong>
                      {' · '}
                      <span style={{ color: '#c9a84c' }}>{race.venue}</span>
                      {' · '}
                      <span style={{ color: '#5a8a5a' }}>{race.race_name}</span>
                    </span>
                    {isSubmitted && <span style={st.badgeDone}>✓ Results in</span>}
                  </div>

                  {isSubmitted ? (
                    /* Show locked results */
                    <div style={st.raceCardBody}>
                      {existingRes.map(r => (
                        <div key={r.id} style={st.resultRow}>
                          <span style={{
                            ...st.posBadge,
                            background: r.position === 1 ? '#c9a84c' : r.position === 2 ? '#9ca3af' : '#b87333',
                          }}>
                            {r.position === 1 ? '1st' : r.position === 2 ? '2nd' : '3rd'}
                          </span>
                          <span style={{ color: '#e8f0e8', fontWeight: '500' }}>{r.horse_name}</span>
                          <span style={{ color: '#c9a84c', marginLeft: 'auto', fontSize: '0.85rem' }}>
                            {r.starting_price_display}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    /* Result entry form */
                    <div style={st.raceCardBody}>
                      {raceRunners.length === 0 ? (
                        <p style={{ color: '#5a8a5a', fontSize: '0.85rem', margin: 0 }}>
                          Add runners to this race first in the "This Week" tab.
                        </p>
                      ) : (
                        <>
                          {[1,2,3].map(pos => {
                            const horseKey = `horse${pos}`
                            const spKey    = `sp${pos}`
                            const label    = pos === 1 ? '1st' : pos === 2 ? '2nd' : '3rd'
                            const bgColor  = pos === 1 ? '#c9a84c' : pos === 2 ? '#9ca3af' : '#b87333'
                            return (
                              <div key={pos} style={st.resultInputRow}>
                                <span style={{ ...st.posBadge, background: bgColor, minWidth: '44px' }}>
                                  {label}
                                </span>
                                <select
                                  style={{ ...st.input, flex: 2 }}
                                  value={form[horseKey] || ''}
                                  onChange={e => setResultForms(p => ({
                                    ...p, [race.id]: { ...p[race.id], [horseKey]: e.target.value }
                                  }))}
                                >
                                  <option value="">Select horse…</option>
                                  {raceRunners.map(r => (
                                    <option key={r.id} value={r.horse_name}>{r.horse_name}</option>
                                  ))}
                                </select>
                                <input
                                  style={{ ...st.input, flex: 1, minWidth: '90px' }}
                                  placeholder="SP e.g. 7/1"
                                  value={form[spKey] || ''}
                                  onChange={e => setResultForms(p => ({
                                    ...p, [race.id]: { ...p[race.id], [spKey]: e.target.value }
                                  }))}
                                />
                              </div>
                            )
                          })}
                          <button
                            style={{ ...st.btnGold, marginTop: '0.5rem' }}
                            onClick={() => submitResults(race)}
                            disabled={loading}
                          >
                            {loading ? 'Saving…' : 'Submit Results & Calculate Scores'}
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* ══════════════════════════════════════
            SECTION 4 — LEADERBOARD
        ══════════════════════════════════════ */}
        {activeTab === 'leaderboard' && (
          <div style={st.section}>
            <div style={st.sectionHeader}>
              <h2 style={st.sectionTitle}>Season Leaderboard</h2>
              <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                {activeSeason && <span style={st.weekLabel}>{activeSeason.name}</span>}
                <button style={st.btnGhost} onClick={loadLeaderboard}>↻ Refresh</button>
              </div>
            </div>

            {!activeSeason ? (
              <div style={st.warningCard}>No active season.</div>
            ) : leaderboard.length === 0 ? (
              <div style={st.warningCard}>No scores recorded yet for this season.</div>
            ) : (
              <div style={st.tableCard}>
                <div style={st.tableHead}>
                  <span style={{ width: '48px' }}>#</span>
                  <span style={{ flex: 1 }}>Player</span>
                  <span style={{ width: '130px', textAlign: 'right' }}>This Week</span>
                  <span style={{ width: '130px', textAlign: 'right' }}>Season Total</span>
                </div>
                {leaderboard.map((entry, i) => (
                  <div key={entry.id} style={{ ...st.tableRow, ...(i === 0 ? st.tableRowFirst : {}) }}>
                    <span style={{
                      width: '48px',
                      fontFamily: "'Bebas Neue', sans-serif",
                      fontSize: '1.15rem',
                      color: i < 3 ? '#c9a84c' : '#5a8a5a',
                    }}>
                      {i === 0 ? '👑' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}
                    </span>
                    <span style={{ flex: 1, color: '#e8f0e8', fontWeight: '500' }}>{entry.name}</span>
                    <span style={{ width: '130px', textAlign: 'right', color: '#5a8a5a' }}>
                      {entry.week} pts
                    </span>
                    <span style={{
                      width: '130px', textAlign: 'right',
                      color: '#c9a84c', fontWeight: '600',
                      fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.15rem',
                    }}>
                      {entry.total} pts
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

      </main>
    </div>
  )
}

// ── Styles ──────────────────────────────────────────────────────────────────
const st = {
  page: {
    minHeight: '100vh',
    background: '#0a1a08',
    fontFamily: "'DM Sans', sans-serif",
    color: '#e8f0e8',
    paddingBottom: '4rem',
  },
  nav: {
    background: '#0d1f0d',
    borderBottom: '1px solid rgba(201,168,76,0.15)',
  },
  navInner: {
    maxWidth: '1100px', margin: '0 auto', padding: '0 1.5rem',
    height: '56px', display: 'flex', alignItems: 'center', gap: '1rem',
  },
  navLogo: {
    fontFamily: "'Bebas Neue', sans-serif",
    fontSize: '1.2rem', color: '#c9a84c', letterSpacing: '0.1em',
  },
  adminBadge: {
    fontSize: '0.7rem', fontWeight: '700', color: '#5a8a5a',
    letterSpacing: '0.1em', textTransform: 'uppercase',
    background: 'rgba(201,168,76,0.08)', padding: '0.2rem 0.65rem',
    borderRadius: '4px', border: '1px solid rgba(201,168,76,0.15)',
  },
  navBack: {
    marginLeft: 'auto', fontSize: '0.85rem', color: '#5a8a5a', textDecoration: 'none',
  },
  tabBarWrap: {
    background: '#0d1f0d',
    borderBottom: '1px solid rgba(201,168,76,0.1)',
  },
  tabBar: {
    maxWidth: '1100px', margin: '0 auto', padding: '0 1.5rem', display: 'flex',
  },
  tabBtn: {
    background: 'none', border: 'none',
    borderBottom: '3px solid transparent',
    padding: '0.85rem 1.1rem',
    fontSize: '0.85rem', fontWeight: '500', color: '#5a8a5a',
    cursor: 'pointer', fontFamily: "'DM Sans', sans-serif",
    transition: 'all 0.2s', whiteSpace: 'nowrap',
  },
  tabBtnActive: { color: '#c9a84c', borderBottomColor: '#c9a84c' },
  msgBanner: {
    maxWidth: '1100px', margin: '1rem auto 0', padding: '0.75rem 1.25rem',
    borderRadius: '8px', display: 'flex', justifyContent: 'space-between',
    alignItems: 'center', fontSize: '0.875rem',
  },
  msgSuccess: {
    background: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.3)', color: '#4ade80',
  },
  msgError: {
    background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171',
  },
  msgClose: {
    background: 'none', border: 'none', color: 'inherit',
    cursor: 'pointer', fontSize: '1.2rem', padding: '0 0.2rem',
  },
  main: {
    maxWidth: '1100px', margin: '0 auto', padding: '2rem 1.5rem',
  },
  section: { display: 'flex', flexDirection: 'column', gap: '1.25rem' },
  sectionHeader: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem',
  },
  sectionTitle: {
    fontFamily: "'Bebas Neue', sans-serif",
    fontSize: '1.9rem', color: '#e8f0e8', letterSpacing: '0.05em', margin: 0,
  },
  weekLabel: {
    fontSize: '0.78rem', color: '#5a8a5a',
    background: 'rgba(0,0,0,0.3)', padding: '0.3rem 0.75rem',
    borderRadius: '999px', border: '1px solid rgba(201,168,76,0.1)',
  },
  infoCard: {
    background: '#0d1f0d', border: '1px solid rgba(201,168,76,0.2)',
    borderRadius: '12px', padding: '1.25rem 1.5rem',
  },
  infoCardBadge: {
    fontSize: '0.68rem', fontWeight: '700', letterSpacing: '0.1em',
    textTransform: 'uppercase', color: '#c9a84c', marginBottom: '0.35rem',
  },
  infoCardTitle: {
    fontFamily: "'Bebas Neue', sans-serif",
    fontSize: '1.5rem', color: '#e8f0e8', letterSpacing: '0.04em',
  },
  infoCardSub: { fontSize: '0.85rem', color: '#5a8a5a', marginTop: '0.2rem' },
  warningCard: {
    background: 'rgba(201,168,76,0.05)', border: '1px solid rgba(201,168,76,0.18)',
    borderRadius: '10px', padding: '1rem 1.25rem', color: '#c9a84c', fontSize: '0.875rem',
  },
  formCard: {
    background: '#0d1f0d', border: '1px solid rgba(201,168,76,0.15)',
    borderRadius: '12px', padding: '1.5rem',
  },
  formTitle: {
    fontFamily: "'Bebas Neue', sans-serif",
    fontSize: '1.05rem', color: '#c9a84c', letterSpacing: '0.09em', marginBottom: '1.1rem',
  },
  formGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' },
  formField: { display: 'flex', flexDirection: 'column', gap: '0.35rem' },
  formActions: { display: 'flex', gap: '0.75rem', marginTop: '1rem' },
  label: {
    fontSize: '0.7rem', fontWeight: '700', letterSpacing: '0.08em',
    textTransform: 'uppercase', color: '#5a8a5a',
  },
  input: {
    background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(201,168,76,0.2)',
    borderRadius: '7px', padding: '0.65rem 0.85rem',
    fontFamily: "'DM Sans', sans-serif", fontSize: '0.875rem',
    color: '#e8f0e8', outline: 'none', width: '100%', boxSizing: 'border-box',
  },
  btnGold: {
    background: '#c9a84c', color: '#0a1a08', fontWeight: '700',
    fontSize: '0.875rem', padding: '0.6rem 1.25rem', borderRadius: '7px',
    border: 'none', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif",
    whiteSpace: 'nowrap',
  },
  btnGhost: {
    background: 'transparent', border: '1.5px solid rgba(201,168,76,0.3)',
    color: '#c9a84c', fontWeight: '600', fontSize: '0.875rem',
    padding: '0.6rem 1.25rem', borderRadius: '7px',
    cursor: 'pointer', fontFamily: "'DM Sans', sans-serif",
  },
  btnSmall: {
    background: 'rgba(201,168,76,0.08)', border: '1px solid rgba(201,168,76,0.22)',
    color: '#c9a84c', fontWeight: '600', fontSize: '0.78rem',
    padding: '0.35rem 0.75rem', borderRadius: '5px',
    cursor: 'pointer', fontFamily: "'DM Sans', sans-serif",
  },
  tableCard: {
    background: '#0d1f0d', border: '1px solid rgba(201,168,76,0.1)',
    borderRadius: '12px', overflow: 'hidden',
  },
  tableHead: {
    display: 'flex', gap: '1rem', padding: '0.75rem 1.25rem',
    background: 'rgba(0,0,0,0.3)',
    fontSize: '0.7rem', fontWeight: '700', letterSpacing: '0.08em',
    textTransform: 'uppercase', color: '#5a8a5a', alignItems: 'center',
  },
  tableRow: {
    display: 'flex', gap: '1rem', padding: '0.85rem 1.25rem',
    borderTop: '1px solid rgba(201,168,76,0.06)',
    alignItems: 'center', fontSize: '0.875rem',
  },
  tableRowFirst: { background: 'rgba(201,168,76,0.03)' },
  badgeGreen: {
    background: 'rgba(74,222,128,0.1)', color: '#4ade80',
    fontSize: '0.7rem', fontWeight: '700', padding: '0.2rem 0.6rem', borderRadius: '999px',
  },
  badgeMuted: {
    background: 'rgba(90,138,90,0.1)', color: '#5a8a5a',
    fontSize: '0.7rem', fontWeight: '700', padding: '0.2rem 0.6rem', borderRadius: '999px',
  },
  badgeDone: {
    background: 'rgba(74,222,128,0.1)', color: '#4ade80',
    fontSize: '0.7rem', fontWeight: '700', padding: '0.2rem 0.6rem', borderRadius: '999px',
    marginLeft: 'auto',
  },
  raceCard: {
    background: '#0d1f0d', border: '1px solid rgba(201,168,76,0.1)',
    borderRadius: '12px', overflow: 'hidden',
  },
  raceCardDone: { borderColor: 'rgba(74,222,128,0.2)' },
  raceCardHead: {
    display: 'flex', alignItems: 'center', gap: '1rem',
    padding: '0.85rem 1.25rem', background: 'rgba(0,0,0,0.18)',
  },
  raceCardNum: {
    fontFamily: "'Bebas Neue', sans-serif",
    fontSize: '1rem', color: '#c9a84c', letterSpacing: '0.08em', minWidth: '64px',
  },
  raceCardMeta: { fontSize: '0.875rem', flex: 1 },
  raceCardBody: {
    padding: '1rem 1.25rem', borderTop: '1px solid rgba(201,168,76,0.07)',
  },
  progressBar: {
    height: '4px', background: 'rgba(0,0,0,0.3)', borderRadius: '999px',
    marginTop: '0.75rem', overflow: 'hidden',
  },
  progressFill: {
    height: '100%', background: '#c9a84c',
    borderRadius: '999px', transition: 'width 0.4s ease',
  },
  runnersSection: {
    padding: '0.85rem 1.25rem', borderTop: '1px solid rgba(201,168,76,0.06)',
  },
  runnersLabel: {
    fontSize: '0.7rem', fontWeight: '700', color: '#5a8a5a',
    letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '0.6rem',
  },
  runnerChips: { display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '0.75rem' },
  chip: {
    background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(201,168,76,0.13)',
    borderRadius: '5px', padding: '0.25rem 0.6rem', fontSize: '0.8rem',
    color: '#e8f0e8', display: 'flex', alignItems: 'center', gap: '0.4rem',
  },
  chipRemove: {
    background: 'none', border: 'none', color: '#5a8a5a',
    cursor: 'pointer', fontSize: '0.95rem', padding: 0, lineHeight: 1,
  },
  addRunnerRow: { display: 'flex', gap: '0.5rem' },
  resultRow: {
    display: 'flex', alignItems: 'center', gap: '0.85rem', padding: '0.3rem 0',
  },
  resultInputRow: {
    display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem',
  },
  posBadge: {
    color: '#0a1a08', fontWeight: '700', fontSize: '0.75rem',
    padding: '0.25rem 0.5rem', borderRadius: '5px', textAlign: 'center',
    flexShrink: 0,
  },
}
