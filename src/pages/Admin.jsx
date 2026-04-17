/**
 * Silks League — Admin Panel (fully editable)
 *
 * ── TO MAKE A USER ADMIN ────────────────────────────────────────
 *   UPDATE profiles SET is_admin = true WHERE id = '[user_uuid]';
 *
 * ── RUNNER COLUMNS (run once) ───────────────────────────────────
 *   ALTER TABLE runners ADD COLUMN IF NOT EXISTS silk_colour   text;
 *   ALTER TABLE runners ADD COLUMN IF NOT EXISTS horse_number  integer;
 *   ALTER TABLE runners ADD COLUMN IF NOT EXISTS jockey        text;
 *   ALTER TABLE runners ADD COLUMN IF NOT EXISTS trainer       text;
 *
 * ── SCORES TABLE (run once) ─────────────────────────────────────
 *   -- Create the table if it doesn't exist:
 *   CREATE TABLE IF NOT EXISTS scores (
 *     id               uuid DEFAULT gen_random_uuid() PRIMARY KEY,
 *     user_id          uuid REFERENCES auth.users(id) ON DELETE CASCADE,
 *     race_id          uuid REFERENCES races(id) ON DELETE CASCADE,
 *     pick_id          uuid REFERENCES picks(id) ON DELETE CASCADE,
 *     base_points      integer NOT NULL DEFAULT 0,
 *     bonus_points     integer NOT NULL DEFAULT 0,
 *     total_points     integer NOT NULL DEFAULT 0,
 *     position_achieved integer,
 *     created_at       timestamptz DEFAULT now()
 *   );
 *
 *   -- Add missing columns if table already exists:
 *   ALTER TABLE scores ADD COLUMN IF NOT EXISTS pick_id          uuid REFERENCES picks(id) ON DELETE CASCADE;
 *   ALTER TABLE scores ADD COLUMN IF NOT EXISTS base_points      integer NOT NULL DEFAULT 0;
 *   ALTER TABLE scores ADD COLUMN IF NOT EXISTS bonus_points     integer NOT NULL DEFAULT 0;
 *   ALTER TABLE scores ADD COLUMN IF NOT EXISTS position_achieved integer;
 *
 *   -- RLS policies (IMPORTANT — without these, inserts/selects fail silently):
 *   ALTER TABLE scores ENABLE ROW LEVEL SECURITY;
 *
 *   DROP POLICY IF EXISTS "scores_select_all"   ON scores;
 *   DROP POLICY IF EXISTS "scores_insert_admin" ON scores;
 *   DROP POLICY IF EXISTS "scores_delete_admin" ON scores;
 *
 *   CREATE POLICY "scores_select_all"
 *     ON scores FOR SELECT
 *     USING (auth.role() = 'authenticated');
 *
 *   CREATE POLICY "scores_insert_admin"
 *     ON scores FOR INSERT
 *     WITH CHECK (auth.role() = 'authenticated');
 *
 *   CREATE POLICY "scores_delete_admin"
 *     ON scores FOR DELETE
 *     USING (auth.role() = 'authenticated');
 */

import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

// ── Points calculation ───────────────────────────────────────
function parseFractionalOdds(str) {
  if (!str) return null
  const s = str.trim().toLowerCase()
  if (s === 'evs' || s === 'evens') return 2.0
  const parts = s.split('/')
  if (parts.length === 2) {
    const n = parseFloat(parts[0]), d = parseFloat(parts[1])
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
    if (spDecimal >= 21.0) bonus = 15
    else if (spDecimal >= 12.0) bonus = 10
    else if (spDecimal >= 5.5) bonus = 5
    else if (spDecimal >= 3.0) bonus = 2
  } else if (position === 2 || position === 3) {
    if (spDecimal >= 21.0) bonus = 4
    else if (spDecimal >= 12.0) bonus = 3
    else if (spDecimal >= 5.5) bonus = 2
    else if (spDecimal >= 3.0) bonus = 1
  }
  return { base, bonus, total: Math.min(base + bonus, 40) }
}

// ── Silk colours ─────────────────────────────────────────────
const SILK_COLOURS = [
  { hex: '#1a3a7a', label: 'Royal Blue'    },
  { hex: '#5a1010', label: 'Crimson'       },
  { hex: '#0d3d1a', label: 'Forest Green'  },
  { hex: '#2d1a5a', label: 'Purple'        },
  { hex: '#4a3000', label: 'Gold'          },
  { hex: '#1a4a4a', label: 'Teal'          },
  { hex: '#1a1a1a', label: 'Black'         },
  { hex: '#4a1a2a', label: 'Maroon'        },
  { hex: '#3a1a00', label: 'Burnt Orange'  },
  { hex: '#1a2a4a', label: 'Navy'          },
  { hex: '#3a3a1a', label: 'Olive'         },
  { hex: '#3a2a00', label: 'Brown'         },
]

function SilkColourPicker({ value, onChange }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', alignItems: 'center' }}>
      {SILK_COLOURS.map(c => (
        <button
          key={c.hex}
          title={c.label}
          onClick={() => onChange(value === c.hex ? '' : c.hex)}
          style={{
            width: '18px', height: '18px', borderRadius: '50%',
            background: c.hex, border: 'none', cursor: 'pointer', padding: 0, flexShrink: 0,
            outline: value === c.hex ? '2px solid #c9a84c' : '2px solid transparent',
            outlineOffset: '2px',
            boxShadow: value === c.hex ? '0 0 0 1px rgba(201,168,76,0.4)' : 'none',
          }}
        />
      ))}
    </div>
  )
}

// ────────────────────────────────────────────────────────────

export default function Admin() {
  const navigate = useNavigate()

  // Auth
  const [authLoading, setAuthLoading] = useState(true)

  // UI
  const [activeTab, setActiveTab]   = useState('seasons')
  const [loading, setLoading]       = useState(false)
  const [toast, setToast]           = useState(null)           // { type, text }
  const [deleteConfirm, setDeleteConfirm] = useState(null)     // { title, body, onConfirm }

  // ── Seasons ──
  const [seasons, setSeasons]               = useState([])
  const [activeSeason, setActiveSeason]     = useState(null)
  const [showSeasonForm, setShowSeasonForm] = useState(false)
  const [seasonForm, setSeasonForm]         = useState({ name: '', quarter: 'Q1', year: new Date().getFullYear(), startDate: '', endDate: '' })
  const [editingSeason, setEditingSeason]   = useState(null)   // id being edited
  const [editSeasonForm, setEditSeasonForm] = useState({})

  // ── Race week ──
  const [currentWeek, setCurrentWeek]     = useState(null)
  const [showWeekForm, setShowWeekForm]   = useState(false)
  const [weekDate, setWeekDate]           = useState('')
  const [editingWeek, setEditingWeek]     = useState(false)
  const [editWeekForm, setEditWeekForm]   = useState({ saturdayDate: '', picksDeadline: '' })

  // ── Races ──
  const [races, setRaces]               = useState([])
  const [showRaceForm, setShowRaceForm] = useState({})
  const [raceForms, setRaceForms]       = useState({})
  const [editingRace, setEditingRace]   = useState(null)       // race_id being edited
  const [editRaceForm, setEditRaceForm] = useState({})

  // ── Runners ──
  const EMPTY_RUNNER = { number: '', name: '', jockey: '', trainer: '', colour: '' }
  const [runners, setRunners]             = useState({})
  const [newRunnerForm, setNewRunnerForm] = useState({})       // keyed by raceId → EMPTY_RUNNER
  const [editingRunner, setEditingRunner] = useState(null)     // runner_id being edited
  const [editRunnerForm, setEditRunnerForm] = useState(EMPTY_RUNNER)

  // ── Results ──
  const [raceResults, setRaceResults]     = useState({})
  const [resultForms, setResultForms]     = useState({})
  const [unlockedResults, setUnlockedResults] = useState(new Set())

  // ── Leaderboard ──
  const [leaderboard, setLeaderboard] = useState([])

  // ── Init ────────────────────────────────────────────────────
  useEffect(() => { init() }, [])

  async function init() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { navigate('/auth'); return }
    const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single()
    if (!profile?.is_admin) { navigate('/dashboard'); return }
    setAuthLoading(false)
    await loadSeasons()
  }

  // ── Loaders ──────────────────────────────────────────────────
  async function loadSeasons() {
    const { data } = await supabase.from('seasons').select('*').order('created_at', { ascending: false })
    setSeasons(data || [])
    const active = data?.find(s => s.is_active)
    setActiveSeason(active || null)
    if (active) await loadCurrentWeek(active.id)
  }

  async function loadCurrentWeek(seasonId) {
    const { data } = await supabase.from('race_weeks').select('*').eq('season_id', seasonId)
      .order('saturday_date', { ascending: false }).limit(1)
    const week = data?.[0] || null
    setCurrentWeek(week)
    if (week) await loadRaces(week.id)
  }

  async function loadRaces(weekId) {
    const { data } = await supabase.from('races').select('*').eq('race_week_id', weekId).order('race_number')
    setRaces(data || [])
    for (const race of (data || [])) {
      await loadRunners(race.id)
      await loadResults(race.id)
    }
  }

  async function loadRunners(raceId) {
    const { data } = await supabase.from('runners').select('*').eq('race_id', raceId).order('created_at')
    setRunners(prev => ({ ...prev, [raceId]: data || [] }))
  }

  async function loadResults(raceId) {
    const { data } = await supabase.from('results').select('*').eq('race_id', raceId).order('position')
    setRaceResults(prev => ({ ...prev, [raceId]: data?.length ? data : [] }))
  }

  async function loadLeaderboard() {
    if (!activeSeason) return
    const { data: weeks } = await supabase.from('race_weeks').select('id').eq('season_id', activeSeason.id)
    if (!weeks?.length) { setLeaderboard([]); return }
    const { data: raceList } = await supabase.from('races').select('id').in('race_week_id', weeks.map(w => w.id))
    if (!raceList?.length) { setLeaderboard([]); return }
    const thisWeekIds = new Set()
    if (currentWeek) {
      const { data: twRaces } = await supabase.from('races').select('id').eq('race_week_id', currentWeek.id)
      twRaces?.forEach(r => thisWeekIds.add(r.id))
    }
    const { data: scores } = await supabase.from('scores')
      .select('user_id, total_points, race_id, profiles(full_name)').in('race_id', raceList.map(r => r.id))
    const totals = {}
    for (const s of (scores || [])) {
      if (!totals[s.user_id]) totals[s.user_id] = { name: s.profiles?.full_name || 'Unknown', total: 0, week: 0 }
      totals[s.user_id].total += s.total_points
      if (thisWeekIds.has(s.race_id)) totals[s.user_id].week += s.total_points
    }
    setLeaderboard(Object.entries(totals).map(([id, v]) => ({ id, ...v })).sort((a, b) => b.total - a.total).slice(0, 10))
  }

  // ── Toast helper ─────────────────────────────────────────────
  function showToast(type, text) {
    setToast({ type, text })
    setTimeout(() => setToast(null), 3500)
  }

  // ── Confirm helper ───────────────────────────────────────────
  function confirm(title, body, onConfirm) {
    setDeleteConfirm({ title, body, onConfirm })
  }

  // ── Season CRUD ──────────────────────────────────────────────
  async function createSeason(e) {
    e.preventDefault(); setLoading(true)
    const { error } = await supabase.from('seasons').insert({
      name: seasonForm.name, quarter: seasonForm.quarter,
      year: parseInt(seasonForm.year), start_date: seasonForm.startDate, end_date: seasonForm.endDate, is_active: false,
    })
    setLoading(false)
    if (error) { showToast('error', error.message); return }
    showToast('success', 'Season created')
    setShowSeasonForm(false)
    setSeasonForm({ name: '', quarter: 'Q1', year: new Date().getFullYear(), startDate: '', endDate: '' })
    await loadSeasons()
  }

  function startEditSeason(s) {
    setEditingSeason(s.id)
    setEditSeasonForm({ name: s.name, quarter: s.quarter, year: s.year, startDate: s.start_date, endDate: s.end_date })
  }

  async function saveEditSeason(id) {
    setLoading(true)
    const { error } = await supabase.from('seasons').update({
      name: editSeasonForm.name, quarter: editSeasonForm.quarter,
      year: parseInt(editSeasonForm.year), start_date: editSeasonForm.startDate, end_date: editSeasonForm.endDate,
    }).eq('id', id)
    setLoading(false)
    if (error) { showToast('error', error.message); return }
    showToast('success', 'Season updated')
    setEditingSeason(null)
    await loadSeasons()
  }

  async function activateSeason(id) {
    setLoading(true)
    await supabase.from('seasons').update({ is_active: false }).neq('id', id)
    await supabase.from('seasons').update({ is_active: true }).eq('id', id)
    await loadSeasons()
    setLoading(false)
    showToast('success', 'Active season updated')
  }

  async function deleteSeason(id) {
    const s = seasons.find(x => x.id === id)
    if (s?.is_active) { showToast('error', 'Cannot delete the active season — set another season as active first'); return }
    confirm(
      'Delete season?',
      `"${s?.name}" will be permanently deleted along with all its race weeks, races and runners.`,
      async () => {
        const { error } = await supabase.from('seasons').delete().eq('id', id)
        if (error) { showToast('error', error.message); return }
        showToast('success', 'Season deleted')
        await loadSeasons()
      }
    )
  }

  // ── Race week CRUD ───────────────────────────────────────────
  async function createRaceWeek(e) {
    e.preventDefault()
    if (!activeSeason) { showToast('error', 'Set an active season first'); return }
    setLoading(true)
    const { data: weekList } = await supabase.from('race_weeks').select('id').eq('season_id', activeSeason.id)
    const { error } = await supabase.from('race_weeks').insert({
      season_id: activeSeason.id, week_number: (weekList?.length || 0) + 1,
      saturday_date: weekDate, picks_deadline: `${weekDate}T11:00:00`, is_locked: false,
    })
    setLoading(false)
    if (error) { showToast('error', error.message); return }
    showToast('success', 'Race week created')
    setShowWeekForm(false)
    await loadCurrentWeek(activeSeason.id)
  }

  function startEditWeek() {
    setEditWeekForm({
      saturdayDate: currentWeek.saturday_date,
      picksDeadline: currentWeek.picks_deadline?.slice(11, 16) || '11:00',
    })
    setEditingWeek(true)
  }

  async function saveEditWeek() {
    setLoading(true)
    const deadline = `${editWeekForm.saturdayDate}T${editWeekForm.picksDeadline}:00`
    const { error } = await supabase.from('race_weeks').update({
      saturday_date: editWeekForm.saturdayDate, picks_deadline: deadline,
    }).eq('id', currentWeek.id)
    setLoading(false)
    if (error) { showToast('error', error.message); return }
    showToast('success', 'Race week updated')
    setEditingWeek(false)
    await loadCurrentWeek(activeSeason.id)
  }

  function deleteRaceWeek() {
    confirm(
      'Delete race week?',
      `Week ${currentWeek.week_number} (${currentWeek.saturday_date}) and all its races, runners and results will be deleted.`,
      async () => {
        const { error } = await supabase.from('race_weeks').delete().eq('id', currentWeek.id)
        if (error) { showToast('error', error.message); return }
        setCurrentWeek(null); setRaces([]); setRunners({}); setRaceResults({})
        showToast('success', 'Race week deleted')
      }
    )
  }

  // ── Race CRUD ────────────────────────────────────────────────
  async function saveRace(raceNumber) {
    if (!currentWeek) return
    const form = raceForms[raceNumber] || {}
    if (!form.venue || !form.raceName || !form.raceTime) { showToast('error', 'Fill in all race fields'); return }
    setLoading(true)
    const { error } = await supabase.from('races').insert({
      race_week_id: currentWeek.id, race_number: raceNumber,
      venue: form.venue, race_name: form.raceName, race_time: form.raceTime,
    })
    setLoading(false)
    if (error) { showToast('error', error.message); return }
    showToast('success', `Race ${raceNumber} saved`)
    setShowRaceForm(prev => ({ ...prev, [raceNumber]: false }))
    await loadRaces(currentWeek.id)
  }

  function startEditRace(race) {
    setEditingRace(race.id)
    setEditRaceForm({ venue: race.venue, raceName: race.race_name, raceTime: race.race_time, raceNumber: race.race_number })
  }

  async function saveEditRace(race) {
    // Check for race number conflict
    if (parseInt(editRaceForm.raceNumber) !== race.race_number) {
      const conflict = races.find(r => r.race_number === parseInt(editRaceForm.raceNumber) && r.id !== race.id)
      if (conflict) { showToast('error', `Race ${editRaceForm.raceNumber} already exists — change that race's number first`); return }
    }
    setLoading(true)
    const { error } = await supabase.from('races').update({
      venue: editRaceForm.venue, race_name: editRaceForm.raceName,
      race_time: editRaceForm.raceTime, race_number: parseInt(editRaceForm.raceNumber),
    }).eq('id', race.id)
    setLoading(false)
    if (error) { showToast('error', error.message); return }
    showToast('success', 'Race updated')
    setEditingRace(null)
    await loadRaces(currentWeek.id)
  }

  function deleteRace(race) {
    confirm(
      `Delete Race ${race.race_number}?`,
      `${race.venue} — ${race.race_name} and all its runners will be deleted.`,
      async () => {
        const { error } = await supabase.from('races').delete().eq('id', race.id)
        if (error) { showToast('error', error.message); return }
        setRaces(prev => prev.filter(r => r.id !== race.id))
        const newRunners = { ...runners }; delete newRunners[race.id]
        setRunners(newRunners)
        showToast('success', `Race ${race.race_number} deleted`)
      }
    )
  }

  // ── Runner CRUD ──────────────────────────────────────────────
  function nrf(raceId) { return newRunnerForm[raceId] || { number: '', name: '', jockey: '', trainer: '', colour: '' } }
  function setNrf(raceId, patch) { setNewRunnerForm(p => ({ ...p, [raceId]: { ...nrf(raceId), ...patch } })) }

  async function addRunner(raceId) {
    const form = nrf(raceId)
    if (!form.name.trim()) { showToast('error', 'Horse name is required'); return }
    setLoading(true)
    const { error } = await supabase.from('runners').insert({
      race_id: raceId,
      horse_name: form.name.trim(),
      horse_number: form.number ? parseInt(form.number) : null,
      jockey: form.jockey.trim() || null,
      trainer: form.trainer.trim() || null,
      silk_colour: form.colour || null,
    })
    setLoading(false)
    if (error) { showToast('error', error.message); return }
    setNewRunnerForm(p => ({ ...p, [raceId]: { number: '', name: '', jockey: '', trainer: '', colour: '' } }))
    await loadRunners(raceId)
    showToast('success', 'Runner added')
  }

  function startEditRunner(runner) {
    setEditingRunner(runner.id)
    setEditRunnerForm({
      number:  runner.horse_number?.toString() || '',
      name:    runner.horse_name || '',
      jockey:  runner.jockey || '',
      trainer: runner.trainer || '',
      colour:  runner.silk_colour || '',
    })
  }

  async function saveEditRunner(raceId, runnerId) {
    if (!editRunnerForm.name.trim()) { showToast('error', 'Horse name is required'); return }
    setLoading(true)
    const { error } = await supabase.from('runners').update({
      horse_name:   editRunnerForm.name.trim(),
      horse_number: editRunnerForm.number ? parseInt(editRunnerForm.number) : null,
      jockey:       editRunnerForm.jockey.trim() || null,
      trainer:      editRunnerForm.trainer.trim() || null,
      silk_colour:  editRunnerForm.colour || null,
    }).eq('id', runnerId)
    setLoading(false)
    if (error) { showToast('error', error.message); return }
    setEditingRunner(null)
    await loadRunners(raceId)
    showToast('success', 'Runner updated')
  }

  async function removeRunner(raceId, runnerId) {
    const { error } = await supabase.from('runners').delete().eq('id', runnerId)
    if (error) { showToast('error', error.message); return }
    setRunners(prev => ({ ...prev, [raceId]: prev[raceId].filter(r => r.id !== runnerId) }))
    showToast('success', 'Runner removed')
  }

  // ── Results CRUD ─────────────────────────────────────────────
  function unlockResults(race) {
    const existing = raceResults[race.id]
    if (existing?.length) {
      setResultForms(p => ({
        ...p, [race.id]: {
          horse1: existing.find(r => r.position === 1)?.horse_name || '',
          sp1:    existing.find(r => r.position === 1)?.starting_price_display || '',
          horse2: existing.find(r => r.position === 2)?.horse_name || '',
          sp2:    existing.find(r => r.position === 2)?.starting_price_display || '',
          horse3: existing.find(r => r.position === 3)?.horse_name || '',
          sp3:    existing.find(r => r.position === 3)?.starting_price_display || '',
        }
      }))
    }
    setUnlockedResults(prev => new Set([...prev, race.id]))
  }

  function lockResults(raceId) {
    setUnlockedResults(prev => { const s = new Set(prev); s.delete(raceId); return s })
  }

  // ── Shared helper: score one race from its results + picks ───
  async function calculateScoresForRace(raceId, raceNumber) {
    console.log(`[Scores] Starting race ${raceNumber} (${raceId})`)

    // 1. Wipe existing scores for this race
    const { error: delErr } = await supabase.from('scores').delete().eq('race_id', raceId)
    if (delErr) {
      console.error(`[Scores] Delete failed:`, delErr)
      return { ok: false, msg: `Delete failed: ${delErr.message}` }
    }

    // 2. Load the top-3 results
    const { data: raceResults, error: resReadErr } = await supabase
      .from('results')
      .select('position, horse_name, starting_price_decimal')
      .eq('race_id', raceId)
    console.log(`[Scores] Results for race ${raceNumber}:`, raceResults, resReadErr)

    if (resReadErr) return { ok: false, msg: `Read results failed: ${resReadErr.message}` }
    if (!raceResults?.length) return { ok: true, msg: 'No results yet', count: 0 }

    const placed = {}
    raceResults.forEach(r => {
      placed[r.horse_name] = { position: r.position, sp: r.starting_price_decimal }
    })

    // 3. Load picks for this race
    const { data: picks, error: picksErr } = await supabase
      .from('picks').select('id, user_id, runner_id').eq('race_id', raceId)
    console.log(`[Scores] Picks for race ${raceNumber}:`, picks, picksErr)

    if (picksErr) return { ok: false, msg: `Picks fetch failed: ${picksErr.message}` }
    if (!picks?.length) return { ok: true, msg: 'No picks for this race', count: 0 }

    // 4. Resolve runner_id → horse_name
    const runnerIds = [...new Set(picks.map(p => p.runner_id).filter(Boolean))]
    const { data: runnerRows, error: runErr } = await supabase
      .from('runners').select('id, horse_name').in('id', runnerIds)
    console.log(`[Scores] Runners:`, runnerRows, runErr)

    if (runErr) return { ok: false, msg: `Runners fetch failed: ${runErr.message}` }
    const nameMap = {}
    runnerRows?.forEach(r => { nameMap[r.id] = r.horse_name })

    // 5. Build score rows
    const scoresToInsert = picks.map(pick => {
      const horseName = nameMap[pick.runner_id]
      const p = horseName ? placed[horseName] : null
      if (p) {
        const { base, bonus, total } = calcPoints(p.position, p.sp)
        return {
          user_id: pick.user_id, race_id: raceId, pick_id: pick.id,
          base_points: base, bonus_points: bonus, total_points: total,
          position_achieved: p.position,
        }
      }
      return {
        user_id: pick.user_id, race_id: raceId, pick_id: pick.id,
        base_points: 0, bonus_points: 0, total_points: 0, position_achieved: null,
      }
    })
    console.log(`[Scores] Rows to insert for race ${raceNumber}:`, scoresToInsert)

    // 6. Try full insert first
    const { error: insErr } = await supabase.from('scores').insert(scoresToInsert)
    if (!insErr) {
      console.log(`[Scores] Insert OK — ${scoresToInsert.length} rows`)
      return { ok: true, count: scoresToInsert.length }
    }

    console.error(`[Scores] Full insert failed:`, insErr)

    // 7. Full insert failed — likely missing columns. Retry with minimal columns only.
    console.warn(`[Scores] Retrying with minimal columns (user_id, race_id, total_points)`)
    const minimal = scoresToInsert.map(s => ({
      user_id: s.user_id,
      race_id: s.race_id,
      total_points: s.total_points,
    }))
    const { error: minErr } = await supabase.from('scores').insert(minimal)
    if (!minErr) {
      console.log(`[Scores] Minimal insert OK — ${minimal.length} rows`)
      return {
        ok: true, count: minimal.length,
        warn: `Saved with minimal columns — run ALTER TABLE SQL to add pick_id, base_points, bonus_points, position_achieved`,
      }
    }

    console.error(`[Scores] Minimal insert also failed:`, minErr)
    return { ok: false, msg: `Insert failed: ${minErr.message} (original: ${insErr.message})` }
  }

  async function submitResults(race, isEdit = false) {
    const form = resultForms[race.id] || {}
    if (!form.horse1 || !form.horse2 || !form.horse3) { showToast('error', 'Select all 3 finishers'); return }
    const sp1 = parseFractionalOdds(form.sp1), sp2 = parseFractionalOdds(form.sp2), sp3 = parseFractionalOdds(form.sp3)
    if (!sp1 || !sp2 || !sp3) { showToast('error', 'Invalid SP — use e.g. 7/1 or Evs'); return }
    setLoading(true)

    // ── Step 1: delete old results for this race ────────────────
    const { error: delResErr } = await supabase.from('results').delete().eq('race_id', race.id)
    if (delResErr) { showToast('error', `Delete results failed: ${delResErr.message}`); setLoading(false); return }

    // ── Step 2: insert the three result rows ────────────────────
    const { error: resErr } = await supabase.from('results').insert([
      { race_id: race.id, position: 1, horse_name: form.horse1, starting_price_decimal: sp1, starting_price_display: form.sp1.trim() },
      { race_id: race.id, position: 2, horse_name: form.horse2, starting_price_decimal: sp2, starting_price_display: form.sp2.trim() },
      { race_id: race.id, position: 3, horse_name: form.horse3, starting_price_decimal: sp3, starting_price_display: form.sp3.trim() },
    ])
    if (resErr) { showToast('error', `Save results failed: ${resErr.message}`); setLoading(false); return }

    // ── Step 3: calculate scores ────────────────────────────────
    const result = await calculateScoresForRace(race.id, race.race_number)

    lockResults(race.id)
    await loadResults(race.id)
    setLoading(false)

    if (!result.ok) {
      showToast('error', `Results saved but scores failed — ${result.msg}`)
    } else if (result.warn) {
      showToast('error', result.warn)
    } else if (result.count === 0) {
      showToast('success', `Race ${race.race_number} results saved — ${result.msg}`)
    } else {
      showToast('success', `Race ${race.race_number} done — ${result.count} score${result.count !== 1 ? 's' : ''} saved`)
    }
  }

  // ── Recalculate ALL scores for current week ──────────────────
  async function recalculateAllScores() {
    setLoading(true)

    const { data: season } = await supabase
      .from('seasons').select('id').eq('is_active', true).single()
    if (!season) { showToast('error', 'No active season'); setLoading(false); return }

    const { data: weekArr } = await supabase
      .from('race_weeks').select('id')
      .eq('season_id', season.id)
      .order('saturday_date', { ascending: false })
      .limit(1)
    if (!weekArr?.[0]) { showToast('error', 'No race week found'); setLoading(false); return }

    const { data: weekRaces } = await supabase
      .from('races').select('id, race_number').eq('race_week_id', weekArr[0].id)
    if (!weekRaces?.length) { showToast('error', 'No races this week'); setLoading(false); return }

    console.log(`[Scores] Recalculating ${weekRaces.length} races…`)

    let totalInserted = 0
    const errors = []

    for (const race of weekRaces) {
      // Skip races that have no results yet
      const { data: hasResults } = await supabase
        .from('results').select('id').eq('race_id', race.id).limit(1)
      if (!hasResults?.length) { console.log(`[Scores] Race ${race.race_number} — no results, skipping`); continue }

      const result = await calculateScoresForRace(race.id, race.race_number)
      if (!result.ok) {
        errors.push(`Race ${race.race_number}: ${result.msg}`)
      } else {
        totalInserted += (result.count || 0)
        if (result.warn) errors.push(`Race ${race.race_number}: ${result.warn}`)
      }
    }

    setLoading(false)

    if (errors.length && totalInserted === 0) {
      showToast('error', errors[0])
    } else if (errors.length) {
      showToast('error', `Partial success — ${totalInserted} rows saved. First issue: ${errors[0]}`)
    } else {
      showToast('success', `Done — ${totalInserted} score row${totalInserted !== 1 ? 's' : ''} written`)
    }
  }

  // ── Auth gate ────────────────────────────────────────────────
  if (authLoading) {
    return (
      <div style={{ minHeight: '100vh', background: '#0a1a08', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: '#c9a84c', fontFamily: "'DM Sans', sans-serif" }}>Checking admin access…</div>
      </div>
    )
  }

  const TABS = [
    { id: 'seasons',     label: '01 · Seasons'     },
    { id: 'races',       label: '02 · This Week'   },
    { id: 'results',     label: '03 · Results'     },
    { id: 'leaderboard', label: '04 · Leaderboard' },
  ]

  return (
    <div style={st.page}>

      {/* ── Top bar ── */}
      <nav style={st.nav}>
        <div style={st.navInner}>
          <span style={st.navLogo}>Silks League</span>
          <span style={st.adminBadge}>Admin Panel</span>
          <a href="/dashboard" style={st.navBack}>← Dashboard</a>
        </div>
      </nav>

      {/* ── Tabs ── */}
      <div style={st.tabBarWrap}>
        <div style={st.tabBar}>
          {TABS.map(tab => (
            <button key={tab.id}
              style={{ ...st.tabBtn, ...(activeTab === tab.id ? st.tabBtnActive : {}) }}
              onClick={() => { setActiveTab(tab.id); if (tab.id === 'leaderboard') loadLeaderboard() }}>
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Toast ── */}
      {toast && (
        <div style={{ ...st.toast, ...(toast.type === 'error' ? st.toastError : st.toastSuccess) }}>
          {toast.type === 'error' ? '⚠ ' : '✓ '}{toast.text}
        </div>
      )}

      {/* ── Delete confirmation modal ── */}
      {deleteConfirm && (
        <div style={st.overlay} onClick={() => setDeleteConfirm(null)}>
          <div style={st.confirmBox} onClick={e => e.stopPropagation()}>
            <div style={st.confirmTitle}>{deleteConfirm.title}</div>
            <div style={st.confirmBody}>{deleteConfirm.body}</div>
            <div style={st.confirmActions}>
              <button style={st.btnDanger} onClick={() => { deleteConfirm.onConfirm(); setDeleteConfirm(null) }}>
                Yes, delete
              </button>
              <button style={st.btnGhost} onClick={() => setDeleteConfirm(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      <main style={st.main}>

        {/* ══════════════ SEASONS ══════════════ */}
        {activeTab === 'seasons' && (
          <div style={st.section}>
            <div style={st.sectionHeader}>
              <h2 style={st.sectionTitle}>Season Management</h2>
              <button style={st.btnGold} onClick={() => setShowSeasonForm(v => !v)}>
                {showSeasonForm ? 'Cancel' : '+ New Season'}
              </button>
            </div>

            {activeSeason ? (
              <div style={st.infoCard}>
                <div style={st.infoCardBadge}>Active Season</div>
                <div style={st.infoCardTitle}>{activeSeason.name}</div>
                <div style={st.infoCardSub}>{activeSeason.quarter} · {activeSeason.start_date} → {activeSeason.end_date}</div>
              </div>
            ) : (
              <div style={st.warningCard}>No active season. Create one and click "Set Active".</div>
            )}

            {/* Create form */}
            {showSeasonForm && (
              <form onSubmit={createSeason} style={st.formCard}>
                <div style={st.formTitle}>Create New Season</div>
                <div style={st.formGrid}>
                  <div style={st.formField}>
                    <label style={st.label}>Season Name</label>
                    <input style={st.input} placeholder="Q2 2026" value={seasonForm.name}
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
                  <button type="submit" style={st.btnGold} disabled={loading}>{loading ? 'Saving…' : 'Create Season'}</button>
                  <button type="button" style={st.btnGhost} onClick={() => setShowSeasonForm(false)}>Cancel</button>
                </div>
              </form>
            )}

            {/* Seasons list */}
            {seasons.length > 0 && (
              <div style={st.tableCard}>
                {seasons.map(s => (
                  <div key={s.id}>
                    {/* Season row */}
                    {editingSeason !== s.id ? (
                      <div style={st.tableRow}>
                        <div style={{ flex: 2 }}>
                          <div style={{ color: '#e8f0e8', fontWeight: '500' }}>{s.name}</div>
                          <div style={{ color: '#5a8a5a', fontSize: '0.78rem', marginTop: '0.1rem' }}>
                            {s.quarter} {s.year} · {s.start_date} → {s.end_date}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                          {s.is_active
                            ? <span style={st.badgeGreen}>Active</span>
                            : <button style={st.btnSmall} onClick={() => activateSeason(s.id)}>Set Active</button>}
                          <button style={st.btnSmallGhost} onClick={() => startEditSeason(s)}>Edit</button>
                          <button style={st.btnSmallDanger} onClick={() => deleteSeason(s.id)}>Delete</button>
                        </div>
                      </div>
                    ) : (
                      /* Inline edit form */
                      <div style={{ ...st.tableRow, flexDirection: 'column', alignItems: 'stretch', gap: '0.75rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ color: '#c9a84c', fontSize: '0.8rem', fontWeight: '600', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Editing: {s.name}</span>
                        </div>
                        <div style={st.formGrid}>
                          <div style={st.formField}>
                            <label style={st.label}>Name</label>
                            <input style={st.input} value={editSeasonForm.name}
                              onChange={e => setEditSeasonForm({ ...editSeasonForm, name: e.target.value })} />
                          </div>
                          <div style={st.formField}>
                            <label style={st.label}>Quarter</label>
                            <select style={st.input} value={editSeasonForm.quarter}
                              onChange={e => setEditSeasonForm({ ...editSeasonForm, quarter: e.target.value })}>
                              <option>Q1</option><option>Q2</option><option>Q3</option><option>Q4</option>
                            </select>
                          </div>
                          <div style={st.formField}>
                            <label style={st.label}>Year</label>
                            <input style={st.input} type="number" value={editSeasonForm.year}
                              onChange={e => setEditSeasonForm({ ...editSeasonForm, year: e.target.value })} />
                          </div>
                          <div style={st.formField}>
                            <label style={st.label}>Start Date</label>
                            <input style={st.input} type="date" value={editSeasonForm.startDate}
                              onChange={e => setEditSeasonForm({ ...editSeasonForm, startDate: e.target.value })} />
                          </div>
                          <div style={st.formField}>
                            <label style={st.label}>End Date</label>
                            <input style={st.input} type="date" value={editSeasonForm.endDate}
                              onChange={e => setEditSeasonForm({ ...editSeasonForm, endDate: e.target.value })} />
                          </div>
                        </div>
                        <div style={st.formActions}>
                          <button style={st.btnGold} onClick={() => saveEditSeason(s.id)} disabled={loading}>Save</button>
                          <button style={st.btnGhost} onClick={() => setEditingSeason(null)}>Cancel</button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ══════════════ THIS WEEK ══════════════ */}
        {activeTab === 'races' && (
          <div style={st.section}>
            <div style={st.sectionHeader}>
              <h2 style={st.sectionTitle}>This Week's Races</h2>
              {activeSeason && !currentWeek && (
                <button style={st.btnGold} onClick={() => setShowWeekForm(v => !v)}>+ Create Race Week</button>
              )}
            </div>

            {!activeSeason && <div style={st.warningCard}>No active season — go to Seasons tab first.</div>}
            {activeSeason && !currentWeek && !showWeekForm && (
              <div style={st.warningCard}>No race week yet. Click "Create Race Week".</div>
            )}

            {showWeekForm && (
              <form onSubmit={createRaceWeek} style={st.formCard}>
                <div style={st.formTitle}>Create Race Week</div>
                <div style={st.formField}>
                  <label style={st.label}>Saturday Date</label>
                  <input style={{ ...st.input, maxWidth: '220px' }} type="date" value={weekDate}
                    onChange={e => setWeekDate(e.target.value)} required />
                </div>
                <p style={{ fontSize: '0.8rem', color: '#5a8a5a', margin: '0.5rem 0 1rem' }}>
                  Picks deadline automatically set to 11:00am on this date.
                </p>
                <div style={st.formActions}>
                  <button type="submit" style={st.btnGold} disabled={loading}>Create Week</button>
                  <button type="button" style={st.btnGhost} onClick={() => setShowWeekForm(false)}>Cancel</button>
                </div>
              </form>
            )}

            {currentWeek && (
              <>
                {/* Week summary card */}
                {editingWeek ? (
                  <div style={st.formCard}>
                    <div style={st.formTitle}>Edit Race Week</div>
                    <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                      <div style={st.formField}>
                        <label style={st.label}>Saturday Date</label>
                        <input style={st.input} type="date" value={editWeekForm.saturdayDate}
                          onChange={e => setEditWeekForm({ ...editWeekForm, saturdayDate: e.target.value })} />
                      </div>
                      <div style={st.formField}>
                        <label style={st.label}>Picks Deadline (time)</label>
                        <input style={st.input} type="time" value={editWeekForm.picksDeadline}
                          onChange={e => setEditWeekForm({ ...editWeekForm, picksDeadline: e.target.value })} />
                      </div>
                    </div>
                    <div style={st.formActions}>
                      <button style={st.btnGold} onClick={saveEditWeek} disabled={loading}>Save</button>
                      <button style={st.btnGhost} onClick={() => setEditingWeek(false)}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div style={st.infoCard}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <div style={st.infoCardBadge}>Current Week</div>
                        <div style={st.infoCardTitle}>Week {currentWeek.week_number} · {currentWeek.saturday_date}</div>
                        <div style={st.infoCardSub}>Picks deadline: {currentWeek.picks_deadline?.slice(11, 16) || '11:00'} · {races.length}/5 races</div>
                      </div>
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button style={st.btnSmallGhost} onClick={startEditWeek}>Edit</button>
                        <button style={st.btnSmallDanger} onClick={deleteRaceWeek}>Delete Week</button>
                      </div>
                    </div>
                    <div style={st.progressBar}>
                      <div style={{ ...st.progressFill, width: `${(races.length / 5) * 100}%` }} />
                    </div>
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
                          }}>{n}</div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Race cards */}
                {[1,2,3,4,5].map(raceNum => {
                  const race        = races.find(r => r.race_number === raceNum)
                  const raceRunners = race ? (runners[race.id] || []) : []

                  return (
                    <div key={raceNum} style={st.raceCard}>
                      {/* Card header */}
                      <div style={st.raceCardHead}>
                        {editingRace === race?.id ? (
                          <span style={st.raceCardNum}>Race {raceNum}</span>
                        ) : (
                          <>
                            <span style={st.raceCardNum}>Race {raceNum}</span>
                            {race ? (
                              <>
                                <span style={st.raceCardMeta}>
                                  <strong style={{ color: '#e8f0e8' }}>{race.race_time}</strong>
                                  {' · '}<span style={{ color: '#c9a84c' }}>{race.venue}</span>
                                  {' · '}<span style={{ color: '#5a8a5a' }}>{race.race_name}</span>
                                </span>
                                <div style={{ display: 'flex', gap: '0.4rem', marginLeft: 'auto' }}>
                                  <button style={st.btnSmallGhost} onClick={() => startEditRace(race)}>Edit</button>
                                  <button style={st.btnSmallDanger} onClick={() => deleteRace(race)}>Delete</button>
                                </div>
                              </>
                            ) : (
                              <button style={st.btnSmall}
                                onClick={() => setShowRaceForm(p => ({ ...p, [raceNum]: !p[raceNum] }))}>
                                {showRaceForm[raceNum] ? 'Cancel' : '+ Add Race'}
                              </button>
                            )}
                          </>
                        )}
                      </div>

                      {/* Edit race form */}
                      {race && editingRace === race.id && (
                        <div style={st.raceCardBody}>
                          <div style={st.formGrid}>
                            <div style={st.formField}>
                              <label style={st.label}>Race Number</label>
                              <input style={st.input} type="number" min="1" max="5"
                                value={editRaceForm.raceNumber}
                                onChange={e => setEditRaceForm({ ...editRaceForm, raceNumber: e.target.value })} />
                            </div>
                            <div style={st.formField}>
                              <label style={st.label}>Race Time</label>
                              <input style={st.input} placeholder="13:30" value={editRaceForm.raceTime}
                                onChange={e => setEditRaceForm({ ...editRaceForm, raceTime: e.target.value })} />
                            </div>
                            <div style={st.formField}>
                              <label style={st.label}>Venue</label>
                              <input style={st.input} value={editRaceForm.venue}
                                onChange={e => setEditRaceForm({ ...editRaceForm, venue: e.target.value })} />
                            </div>
                            <div style={st.formField}>
                              <label style={st.label}>Race Name</label>
                              <input style={st.input} value={editRaceForm.raceName}
                                onChange={e => setEditRaceForm({ ...editRaceForm, raceName: e.target.value })} />
                            </div>
                          </div>
                          <div style={st.formActions}>
                            <button style={st.btnGold} onClick={() => saveEditRace(race)} disabled={loading}>Save</button>
                            <button style={st.btnGhost} onClick={() => setEditingRace(null)}>Cancel</button>
                          </div>
                        </div>
                      )}

                      {/* New race form */}
                      {!race && showRaceForm[raceNum] && (
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
                            onClick={() => saveRace(raceNum)} disabled={loading}>Save Race</button>
                        </div>
                      )}

                      {/* Runners */}
                      {race && editingRace !== race.id && (
                        <div style={st.runnersSection}>
                          <div style={st.runnersLabel}>Runners ({raceRunners.length})</div>

                          {/* Runner cards */}
                          {raceRunners.map(runner => (
                            <div key={runner.id} style={st.runnerCard}>
                              {editingRunner === runner.id ? (
                                /* ── Inline edit form ── */
                                <div style={{ padding: '0.85rem 1rem' }}>
                                  <div style={{ fontSize: '0.7rem', fontWeight: '700', color: '#c9a84c', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '0.75rem' }}>Editing Runner</div>
                                  <div style={st.runnerFormGrid}>
                                    <div style={st.formField}>
                                      <label style={st.label}>No.</label>
                                      <input style={{ ...st.input, width: '70px' }} type="number" min="1" placeholder="1"
                                        value={editRunnerForm.number}
                                        onChange={e => setEditRunnerForm(f => ({ ...f, number: e.target.value }))} />
                                    </div>
                                    <div style={{ ...st.formField, gridColumn: 'span 2' }}>
                                      <label style={st.label}>Horse Name</label>
                                      <input style={st.input} placeholder="Horse name" autoFocus
                                        value={editRunnerForm.name}
                                        onChange={e => setEditRunnerForm(f => ({ ...f, name: e.target.value }))} />
                                    </div>
                                    <div style={{ ...st.formField, gridColumn: 'span 3' }}>
                                      <label style={st.label}>Jockey</label>
                                      <input style={st.input} placeholder="Jockey name"
                                        value={editRunnerForm.jockey}
                                        onChange={e => setEditRunnerForm(f => ({ ...f, jockey: e.target.value }))} />
                                    </div>
                                    <div style={{ ...st.formField, gridColumn: 'span 3' }}>
                                      <label style={st.label}>Trainer</label>
                                      <input style={st.input} placeholder="Trainer name"
                                        value={editRunnerForm.trainer}
                                        onChange={e => setEditRunnerForm(f => ({ ...f, trainer: e.target.value }))} />
                                    </div>
                                    <div style={{ ...st.formField, gridColumn: '1 / -1' }}>
                                      <label style={st.label}>Silk Colour</label>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                                        {editRunnerForm.colour && (
                                          <span style={{ width: '22px', height: '22px', borderRadius: '50%', background: editRunnerForm.colour, flexShrink: 0, border: '2px solid rgba(201,168,76,0.4)' }}
                                            title={SILK_COLOURS.find(c => c.hex === editRunnerForm.colour)?.label} />
                                        )}
                                        <SilkColourPicker value={editRunnerForm.colour} onChange={col => setEditRunnerForm(f => ({ ...f, colour: col }))} />
                                      </div>
                                    </div>
                                  </div>
                                  <div style={st.formActions}>
                                    <button style={st.btnGold} onClick={() => saveEditRunner(race.id, runner.id)} disabled={loading}>Save</button>
                                    <button style={st.btnGhost} onClick={() => setEditingRunner(null)}>Cancel</button>
                                  </div>
                                </div>
                              ) : (
                                /* ── Runner display row ── */
                                <div style={st.runnerCardRow}>
                                  <div style={st.runnerCardLeft}>
                                    {runner.horse_number && (
                                      <span style={st.runnerNum}>{runner.horse_number}</span>
                                    )}
                                    {runner.silk_colour ? (
                                      <span style={{ width: '20px', height: '20px', borderRadius: '50%', background: runner.silk_colour, flexShrink: 0, border: '1px solid rgba(255,255,255,0.15)' }}
                                        title={SILK_COLOURS.find(c => c.hex === runner.silk_colour)?.label || runner.silk_colour} />
                                    ) : (
                                      <span style={{ width: '20px', height: '20px', borderRadius: '50%', background: 'rgba(255,255,255,0.06)', flexShrink: 0, border: '1px dashed rgba(201,168,76,0.2)' }} />
                                    )}
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                                      <span style={{ color: '#e8f0e8', fontWeight: '600', fontSize: '0.875rem' }}>{runner.horse_name}</span>
                                      <div style={{ display: 'flex', gap: '0.85rem', flexWrap: 'wrap' }}>
                                        {runner.jockey && <span style={st.runnerMeta}>J: {runner.jockey}</span>}
                                        {runner.trainer && <span style={st.runnerMeta}>T: {runner.trainer}</span>}
                                        {!runner.jockey && !runner.trainer && <span style={{ ...st.runnerMeta, fontStyle: 'italic' }}>No jockey / trainer set</span>}
                                      </div>
                                    </div>
                                  </div>
                                  <div style={{ display: 'flex', gap: '0.4rem' }}>
                                    <button style={st.btnSmallGhost} onClick={() => startEditRunner(runner)}>Edit</button>
                                    <button style={st.btnSmallDanger} onClick={() => removeRunner(race.id, runner.id)}>Delete</button>
                                  </div>
                                </div>
                              )}
                            </div>
                          ))}

                          {/* Add runner form */}
                          <div style={st.addRunnerCard}>
                            <div style={{ fontSize: '0.7rem', fontWeight: '700', color: '#5a8a5a', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '0.75rem' }}>Add Runner</div>
                            <div style={st.runnerFormGrid}>
                              <div style={st.formField}>
                                <label style={st.label}>No.</label>
                                <input style={{ ...st.input, width: '70px' }} type="number" min="1" placeholder="1"
                                  value={nrf(race.id).number}
                                  onChange={e => setNrf(race.id, { number: e.target.value })} />
                              </div>
                              <div style={{ ...st.formField, gridColumn: 'span 2' }}>
                                <label style={st.label}>Horse Name *</label>
                                <input style={st.input} placeholder="Horse name"
                                  value={nrf(race.id).name}
                                  onChange={e => setNrf(race.id, { name: e.target.value })}
                                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addRunner(race.id) } }} />
                              </div>
                              <div style={{ ...st.formField, gridColumn: 'span 3' }}>
                                <label style={st.label}>Jockey</label>
                                <input style={st.input} placeholder="Jockey name"
                                  value={nrf(race.id).jockey}
                                  onChange={e => setNrf(race.id, { jockey: e.target.value })} />
                              </div>
                              <div style={{ ...st.formField, gridColumn: 'span 3' }}>
                                <label style={st.label}>Trainer</label>
                                <input style={st.input} placeholder="Trainer name"
                                  value={nrf(race.id).trainer}
                                  onChange={e => setNrf(race.id, { trainer: e.target.value })} />
                              </div>
                              <div style={{ ...st.formField, gridColumn: '1 / -1' }}>
                                <label style={st.label}>Silk Colour</label>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                                  {nrf(race.id).colour && (
                                    <span style={{ width: '22px', height: '22px', borderRadius: '50%', background: nrf(race.id).colour, flexShrink: 0, border: '2px solid rgba(201,168,76,0.4)' }}
                                      title={SILK_COLOURS.find(c => c.hex === nrf(race.id).colour)?.label} />
                                  )}
                                  <SilkColourPicker value={nrf(race.id).colour} onChange={col => setNrf(race.id, { colour: col })} />
                                </div>
                              </div>
                            </div>
                            <button style={{ ...st.btnGold, marginTop: '0.85rem' }} onClick={() => addRunner(race.id)} disabled={loading}>
                              {loading ? 'Adding…' : '+ Add Runner'}
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

        {/* ══════════════ RESULTS ══════════════ */}
        {activeTab === 'results' && (
          <div style={st.section}>
            <div style={st.sectionHeader}>
              <h2 style={st.sectionTitle}>Enter Results</h2>
              {currentWeek && <span style={st.weekLabel}>Week {currentWeek.week_number} · {currentWeek.saturday_date}</span>}
              <button
                style={{ ...st.btnSmall, marginLeft: 'auto', background: 'rgba(201,168,76,0.15)', border: '1px solid rgba(201,168,76,0.4)' }}
                onClick={recalculateAllScores}
                disabled={loading}
                title="Re-scores all races that already have results entered — use this if scores are missing"
              >
                ⟳ Recalculate All Scores
              </button>
            </div>

            {!currentWeek && <div style={st.warningCard}>No race week — go to "This Week" first.</div>}
            {currentWeek && races.length === 0 && <div style={st.warningCard}>No races set up — add races in "This Week" first.</div>}

            {races.map(race => {
              const raceRunners  = runners[race.id] || []
              const existingRes  = raceResults[race.id] || []
              const isSubmitted  = existingRes.length > 0
              const isUnlocked   = unlockedResults.has(race.id)
              const form         = resultForms[race.id] || {}

              return (
                <div key={race.id} style={{ ...st.raceCard, ...(isSubmitted && !isUnlocked ? st.raceCardDone : {}) }}>
                  <div style={st.raceCardHead}>
                    <span style={st.raceCardNum}>Race {race.race_number}</span>
                    <span style={st.raceCardMeta}>
                      <strong style={{ color: '#e8f0e8' }}>{race.race_time}</strong>
                      {' · '}<span style={{ color: '#c9a84c' }}>{race.venue}</span>
                      {' · '}<span style={{ color: '#5a8a5a' }}>{race.race_name}</span>
                    </span>
                    {isSubmitted && !isUnlocked && (
                      <button style={{ ...st.btnSmallGhost, marginLeft: 'auto' }} onClick={() => unlockResults(race)}>
                        ✎ Edit Results
                      </button>
                    )}
                    {isSubmitted && !isUnlocked && <span style={st.badgeDone}>✓ Results in</span>}
                    {isUnlocked && <span style={{ ...st.badgeDone, background: 'rgba(251,191,36,0.12)', color: '#fbbf24', marginLeft: 'auto' }}>Editing…</span>}
                  </div>

                  {/* Show locked results */}
                  {isSubmitted && !isUnlocked && (
                    <div style={st.raceCardBody}>
                      {existingRes.map(r => (
                        <div key={r.id} style={st.resultRow}>
                          <span style={{ ...st.posBadge, background: r.position === 1 ? '#c9a84c' : r.position === 2 ? '#9ca3af' : '#b87333' }}>
                            {r.position === 1 ? '1st' : r.position === 2 ? '2nd' : '3rd'}
                          </span>
                          <span style={{ color: '#e8f0e8', fontWeight: '500' }}>{r.horse_name}</span>
                          <span style={{ color: '#c9a84c', marginLeft: 'auto', fontSize: '0.85rem' }}>{r.starting_price_display}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Entry / edit form */}
                  {(!isSubmitted || isUnlocked) && (
                    <div style={st.raceCardBody}>
                      {raceRunners.length === 0 ? (
                        <p style={{ color: '#5a8a5a', fontSize: '0.85rem', margin: 0 }}>
                          Add runners in "This Week" first.
                        </p>
                      ) : (
                        <>
                          {isUnlocked && (
                            <div style={{ fontSize: '0.8rem', color: '#fbbf24', marginBottom: '0.75rem', padding: '0.5rem 0.75rem', background: 'rgba(251,191,36,0.08)', borderRadius: '6px', border: '1px solid rgba(251,191,36,0.2)' }}>
                              Editing results — existing scores will be recalculated on save.
                            </div>
                          )}
                          {[1,2,3].map(pos => {
                            const hKey = `horse${pos}`, spKey = `sp${pos}`
                            const label = pos === 1 ? '1st' : pos === 2 ? '2nd' : '3rd'
                            const bg    = pos === 1 ? '#c9a84c' : pos === 2 ? '#9ca3af' : '#b87333'
                            return (
                              <div key={pos} style={st.resultInputRow}>
                                <span style={{ ...st.posBadge, background: bg, minWidth: '44px' }}>{label}</span>
                                <select style={{ ...st.input, flex: 2 }} value={form[hKey] || ''}
                                  onChange={e => setResultForms(p => ({ ...p, [race.id]: { ...p[race.id], [hKey]: e.target.value } }))}>
                                  <option value="">Select horse…</option>
                                  {raceRunners.map(r => <option key={r.id} value={r.horse_name}>{r.horse_name}</option>)}
                                </select>
                                <input style={{ ...st.input, flex: 1, minWidth: '90px' }} placeholder="SP e.g. 7/1"
                                  value={form[spKey] || ''}
                                  onChange={e => setResultForms(p => ({ ...p, [race.id]: { ...p[race.id], [spKey]: e.target.value } }))} />
                              </div>
                            )
                          })}
                          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
                            <button style={st.btnGold}
                              onClick={() => submitResults(race, isUnlocked)}
                              disabled={loading}>
                              {loading ? 'Saving…' : isUnlocked ? 'Update Results & Recalculate' : 'Submit Results & Calculate Scores'}
                            </button>
                            {isUnlocked && (
                              <button style={st.btnGhost} onClick={() => lockResults(race.id)}>Cancel</button>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* ══════════════ LEADERBOARD ══════════════ */}
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
              <div style={st.warningCard}>No scores yet for this season.</div>
            ) : (
              <div style={st.tableCard}>
                <div style={{ ...st.tableRow, background: 'rgba(0,0,0,0.3)', borderTop: 'none', fontSize: '0.7rem', fontWeight: '700', letterSpacing: '0.08em', textTransform: 'uppercase', color: '#5a8a5a' }}>
                  <span style={{ width: '48px' }}>#</span>
                  <span style={{ flex: 1 }}>Player</span>
                  <span style={{ width: '130px', textAlign: 'right' }}>This Week</span>
                  <span style={{ width: '130px', textAlign: 'right' }}>Season Total</span>
                </div>
                {leaderboard.map((entry, i) => (
                  <div key={entry.id} style={{ ...st.tableRow, ...(i === 0 ? { background: 'rgba(201,168,76,0.04)' } : {}) }}>
                    <span style={{ width: '48px', fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.1rem', color: i < 3 ? '#c9a84c' : '#5a8a5a' }}>
                      {i === 0 ? '👑' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}
                    </span>
                    <span style={{ flex: 1, color: '#e8f0e8', fontWeight: '500' }}>{entry.name}</span>
                    <span style={{ width: '130px', textAlign: 'right', color: '#5a8a5a' }}>{entry.week} pts</span>
                    <span style={{ width: '130px', textAlign: 'right', color: '#c9a84c', fontWeight: '600', fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.1rem' }}>
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
  page:        { minHeight: '100vh', background: '#0a1a08', fontFamily: "'DM Sans', sans-serif", color: '#e8f0e8', paddingBottom: '4rem' },
  nav:         { background: '#0d1f0d', borderBottom: '1px solid rgba(201,168,76,0.15)' },
  navInner:    { maxWidth: '1100px', margin: '0 auto', padding: '0 1.5rem', height: '56px', display: 'flex', alignItems: 'center', gap: '1rem' },
  navLogo:     { fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.2rem', color: '#c9a84c', letterSpacing: '0.1em' },
  adminBadge:  { fontSize: '0.7rem', fontWeight: '700', color: '#5a8a5a', letterSpacing: '0.1em', textTransform: 'uppercase', background: 'rgba(201,168,76,0.08)', padding: '0.2rem 0.65rem', borderRadius: '4px', border: '1px solid rgba(201,168,76,0.15)' },
  navBack:     { marginLeft: 'auto', fontSize: '0.85rem', color: '#5a8a5a', textDecoration: 'none' },
  tabBarWrap:  { background: '#0d1f0d', borderBottom: '1px solid rgba(201,168,76,0.1)' },
  tabBar:      { maxWidth: '1100px', margin: '0 auto', padding: '0 1.5rem', display: 'flex' },
  tabBtn:      { background: 'none', border: 'none', borderBottom: '3px solid transparent', padding: '0.85rem 1.1rem', fontSize: '0.85rem', fontWeight: '500', color: '#5a8a5a', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", transition: 'all 0.2s', whiteSpace: 'nowrap' },
  tabBtnActive:{ color: '#c9a84c', borderBottomColor: '#c9a84c' },
  toast:       { position: 'fixed', top: '1.25rem', right: '1.25rem', padding: '0.75rem 1.25rem', borderRadius: '9px', fontSize: '0.875rem', fontWeight: '500', zIndex: 9999, fontFamily: "'DM Sans', sans-serif", boxShadow: '0 8px 32px rgba(0,0,0,0.4)' },
  toastSuccess:{ background: '#0d1f0d', border: '1px solid rgba(74,222,128,0.4)', color: '#4ade80' },
  toastError:  { background: '#0d1f0d', border: '1px solid rgba(239,68,68,0.4)', color: '#f87171' },
  overlay:     { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9000 },
  confirmBox:  { background: '#162a1a', border: '1px solid #c9a84c', borderLeft: '4px solid #c9a84c', borderRadius: '8px', padding: '2rem', maxWidth: '420px', width: '90%', boxShadow: '0 24px 80px rgba(0,0,0,0.6)' },
  confirmTitle:{ fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.4rem', color: '#e8f0e8', letterSpacing: '0.05em', marginBottom: '0.75rem' },
  confirmBody: { fontSize: '0.875rem', color: '#5a8a5a', lineHeight: 1.6, marginBottom: '1.5rem' },
  confirmActions:{ display: 'flex', gap: '0.75rem' },
  main:        { maxWidth: '1100px', margin: '0 auto', padding: '2rem 1.5rem' },
  section:     { display: 'flex', flexDirection: 'column', gap: '1.25rem' },
  sectionHeader:{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' },
  sectionTitle:{ fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.9rem', color: '#e8f0e8', letterSpacing: '0.05em', margin: 0 },
  weekLabel:   { fontSize: '0.78rem', color: '#5a8a5a', background: 'rgba(0,0,0,0.3)', padding: '0.3rem 0.75rem', borderRadius: '999px', border: '1px solid rgba(201,168,76,0.1)' },
  infoCard:    { background: '#162a1a', border: '1px solid #c9a84c', borderLeft: '4px solid #c9a84c', borderRadius: '8px', padding: '1.25rem 1.5rem' },
  infoCardBadge:{ fontSize: '0.68rem', fontWeight: '700', letterSpacing: '0.1em', textTransform: 'uppercase', color: '#c9a84c', marginBottom: '0.35rem' },
  infoCardTitle:{ fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.5rem', color: '#e8f0e8', letterSpacing: '0.04em' },
  infoCardSub: { fontSize: '0.85rem', color: '#5a8a5a', marginTop: '0.2rem' },
  warningCard: { background: 'rgba(201,168,76,0.08)', border: '1px solid #c9a84c', borderLeft: '4px solid #c9a84c', borderRadius: '8px', padding: '1rem 1.25rem', color: '#c9a84c', fontSize: '0.875rem' },
  formCard:    { background: '#162a1a', border: '1px solid #c9a84c', borderLeft: '4px solid #c9a84c', borderRadius: '8px', padding: '1.5rem' },
  formTitle:   { fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.05rem', color: '#c9a84c', letterSpacing: '0.09em', marginBottom: '1.1rem' },
  formGrid:    { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' },
  formField:   { display: 'flex', flexDirection: 'column', gap: '0.35rem' },
  formActions: { display: 'flex', gap: '0.75rem', marginTop: '1rem' },
  label:       { fontSize: '0.7rem', fontWeight: '700', letterSpacing: '0.08em', textTransform: 'uppercase', color: '#5a8a5a' },
  input:       { background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(201,168,76,0.2)', borderRadius: '7px', padding: '0.65rem 0.85rem', fontFamily: "'DM Sans', sans-serif", fontSize: '0.875rem', color: '#e8f0e8', outline: 'none', width: '100%', boxSizing: 'border-box' },
  btnGold:     { background: '#c9a84c', color: '#0a1a08', fontWeight: '700', fontSize: '0.875rem', padding: '0.6rem 1.25rem', borderRadius: '7px', border: 'none', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", whiteSpace: 'nowrap' },
  btnGhost:    { background: 'transparent', border: '1.5px solid rgba(201,168,76,0.3)', color: '#c9a84c', fontWeight: '600', fontSize: '0.875rem', padding: '0.6rem 1.25rem', borderRadius: '7px', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
  btnDanger:   { background: '#ef4444', color: '#fff', fontWeight: '700', fontSize: '0.875rem', padding: '0.6rem 1.25rem', borderRadius: '7px', border: 'none', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
  btnSmall:    { background: 'rgba(201,168,76,0.08)', border: '1px solid rgba(201,168,76,0.22)', color: '#c9a84c', fontWeight: '600', fontSize: '0.78rem', padding: '0.35rem 0.75rem', borderRadius: '5px', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", whiteSpace: 'nowrap' },
  btnSmallGhost:{ background: 'transparent', border: '1px solid rgba(201,168,76,0.22)', color: '#c9a84c', fontWeight: '600', fontSize: '0.78rem', padding: '0.35rem 0.75rem', borderRadius: '5px', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", whiteSpace: 'nowrap' },
  btnSmallDanger:{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', color: '#f87171', fontWeight: '600', fontSize: '0.78rem', padding: '0.35rem 0.75rem', borderRadius: '5px', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", whiteSpace: 'nowrap' },
  tableCard:   { background: '#162a1a', border: '1px solid #c9a84c', borderLeft: '4px solid #c9a84c', borderRadius: '8px', overflow: 'hidden' },
  tableRow:    { display: 'flex', gap: '1rem', padding: '0.85rem 1.25rem', borderTop: '1px solid rgba(201,168,76,0.15)', alignItems: 'center', fontSize: '0.875rem' },
  badgeGreen:  { background: 'rgba(74,222,128,0.1)', color: '#4ade80', fontSize: '0.7rem', fontWeight: '700', padding: '0.2rem 0.6rem', borderRadius: '999px', whiteSpace: 'nowrap' },
  badgeDone:   { background: 'rgba(74,222,128,0.1)', color: '#4ade80', fontSize: '0.7rem', fontWeight: '700', padding: '0.2rem 0.6rem', borderRadius: '999px', whiteSpace: 'nowrap' },
  raceCard:    { background: '#162a1a', border: '1px solid #c9a84c', borderLeft: '4px solid #c9a84c', borderRadius: '8px', overflow: 'hidden' },
  raceCardDone:{ borderColor: '#4ade80', borderLeftColor: '#4ade80' },
  raceCardHead:{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.85rem 1.25rem', background: 'rgba(0,0,0,0.15)', flexWrap: 'wrap' },
  raceCardNum: { fontFamily: "'Bebas Neue', sans-serif", fontSize: '1rem', color: '#c9a84c', letterSpacing: '0.08em', minWidth: '64px' },
  raceCardMeta:{ fontSize: '0.875rem', flex: 1 },
  raceCardBody:{ padding: '1rem 1.25rem', borderTop: '1px solid rgba(201,168,76,0.07)' },
  progressBar: { height: '4px', background: 'rgba(0,0,0,0.3)', borderRadius: '999px', marginTop: '0.75rem', overflow: 'hidden' },
  progressFill:{ height: '100%', background: '#c9a84c', borderRadius: '999px', transition: 'width 0.4s ease' },
  runnersSection:  { padding: '0.85rem 1.25rem', borderTop: '1px solid rgba(201,168,76,0.06)', display: 'flex', flexDirection: 'column', gap: '0.5rem' },
  runnersLabel:    { fontSize: '0.7rem', fontWeight: '700', color: '#5a8a5a', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '0.1rem' },
  runnerCard:      { background: 'rgba(201,168,76,0.04)', border: '1px solid rgba(201,168,76,0.25)', borderRadius: '6px', overflow: 'hidden' },
  runnerCardRow:   { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', padding: '0.65rem 0.85rem' },
  runnerCardLeft:  { display: 'flex', alignItems: 'center', gap: '0.6rem', flex: 1, minWidth: 0 },
  runnerNum:       { fontFamily: "'Bebas Neue', sans-serif", fontSize: '1rem', color: '#c9a84c', minWidth: '22px', textAlign: 'center' },
  runnerMeta:      { fontSize: '0.75rem', color: '#5a8a5a' },
  runnerFormGrid:  { display: 'grid', gridTemplateColumns: 'auto 1fr 1fr 1fr 1fr 1fr', gap: '0.6rem', alignItems: 'end' },
  addRunnerCard:   { background: 'rgba(201,168,76,0.03)', border: '1px dashed rgba(201,168,76,0.18)', borderRadius: '8px', padding: '0.85rem 1rem', marginTop: '0.25rem' },
  addRunnerRow:    { display: 'flex', gap: '0.5rem' },
  resultRow:   { display: 'flex', alignItems: 'center', gap: '0.85rem', padding: '0.3rem 0' },
  resultInputRow:{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' },
  posBadge:    { color: '#0a1a08', fontWeight: '700', fontSize: '0.75rem', padding: '0.25rem 0.5rem', borderRadius: '5px', textAlign: 'center', flexShrink: 0 },
}
