/**
 * Silks League — Admin Panel (fully editable)
 *
 * ── TO MAKE A USER ADMIN ────────────────────────────────────────
 *   UPDATE profiles SET is_admin = true WHERE id = '[user_uuid]';
 *
 * ── RUNNER COLUMNS (run once) ───────────────────────────────────
 *   ALTER TABLE runners ADD COLUMN IF NOT EXISTS silk_colour            text;
 *   ALTER TABLE runners ADD COLUMN IF NOT EXISTS horse_number           integer;
 *   ALTER TABLE runners ADD COLUMN IF NOT EXISTS jockey                 text;
 *   ALTER TABLE runners ADD COLUMN IF NOT EXISTS trainer                text;
 *   ALTER TABLE runners ADD COLUMN IF NOT EXISTS silk_colour_secondary  text;
 *   ALTER TABLE runners ADD COLUMN IF NOT EXISTS silk_pattern           text;
 *
 * ── RACE COLUMNS (run once) ─────────────────────────────────────
 *   ALTER TABLE races ADD COLUMN IF NOT EXISTS class_type  text;
 *   ALTER TABLE races ADD COLUMN IF NOT EXISTS distance    text;
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
import RunnerCard from '../components/RunnerCard.jsx'
import { ChevronDown, ChevronUp } from 'lucide-react'

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
  const [seasonForm, setSeasonForm]         = useState({ name: '', displayName: '', quarter: 'Q1', year: new Date().getFullYear(), startDate: '', endDate: '' })
  const [editingSeason, setEditingSeason]   = useState(null)   // id being edited
  const [editSeasonForm, setEditSeasonForm] = useState({})

  // ── Race week ──
  const [allWeeks, setAllWeeks]           = useState([])
  const [currentWeek, setCurrentWeek]     = useState(null)   // the week currently being viewed/edited
  const [showWeekForm, setShowWeekForm]   = useState(false)
  const [weekDate, setWeekDate]           = useState('')
  const [weekDeadlineTime, setWeekDeadlineTime] = useState('12:00')
  const [editingWeek, setEditingWeek]     = useState(false)
  const [editWeekForm, setEditWeekForm]   = useState({ saturdayDate: '', picksDeadline: '' })

  // ── Races ──
  const [races, setRaces]               = useState([])
  const [showRaceForm, setShowRaceForm] = useState({})
  const [raceForms, setRaceForms]       = useState({})
  const [editingRace, setEditingRace]   = useState(null)       // race_id being edited
  const [editRaceForm, setEditRaceForm] = useState({})

  // ── Runners ──
  const EMPTY_RUNNER = { number: '', name: '', jockey: '', trainer: '', colour: '', odds: '', form: '' }
  const [runners, setRunners]             = useState({})
  const [newRunnerForm, setNewRunnerForm] = useState({})       // keyed by raceId → EMPTY_RUNNER
  const [editingRunner, setEditingRunner] = useState(null)     // runner_id being edited
  const [editRunnerForm, setEditRunnerForm] = useState(EMPTY_RUNNER)

  // ── Bulk import (runner-only, per race) ──
  const [bulkImportOpen,   setBulkImportOpen]   = useState(new Set())   // Set of raceIds
  const [bulkImportText,   setBulkImportText]   = useState({})          // { [raceId]: string }
  const [bulkImportResult, setBulkImportResult] = useState({})          // { [raceId]: { errors, warnings } }

  // ── Race card expand/collapse ──
  const [expandedRaces, setExpandedRaces] = useState(new Set())

  // ── Combined import (race + runners together) ──
  const [combinedImportOpen,   setCombinedImportOpen]   = useState(false)
  const [combinedImportText,   setCombinedImportText]   = useState('')
  const [combinedImportResult, setCombinedImportResult] = useState(null)  // { errors, warnings, success }
  const [showFormatGuide,      setShowFormatGuide]      = useState(false)

  // ── Festivals ──
  const [festivals, setFestivals]                     = useState([])
  const [selectedFestival, setSelectedFestival]       = useState(null)
  const [festivalDays, setFestivalDays]               = useState([])
  const [selectedDay, setSelectedDay]                 = useState(null)
  const [festivalRaces, setFestivalRaces]             = useState([])
  const [festivalRunners, setFestivalRunners]         = useState({})  // { raceId: [...] }
  const [festivalResults, setFestivalResults]         = useState({})  // { raceId: [...] }
  const [showFestivalForm, setShowFestivalForm]       = useState(false)
  const [festivalForm, setFestivalForm]               = useState({ name: '', displayName: '', bannerColour: '#c9a84c', startDate: '', endDate: '' })
  const [editingFestival, setEditingFestival]         = useState(null)
  const [editFestivalForm, setEditFestivalForm]       = useState({})
  const [festivalBulkOpen, setFestivalBulkOpen]       = useState(new Set())
  const [festivalBulkText, setFestivalBulkText]       = useState({})
  const [festivalBulkResult, setFestivalBulkResult]   = useState({})
  const [festivalResultForms, setFestivalResultForms] = useState({})
  const [festivalUnlocked, setFestivalUnlocked]       = useState(new Set())
  const [showFestivalRaceForm, setShowFestivalRaceForm] = useState({})
  const [festivalRaceForms, setFestivalRaceForms]     = useState({})
  // ── Festival combined bulk import (race + runners per day) ──
  const [festivalCombinedBulkOpen,   setFestivalCombinedBulkOpen]   = useState(new Set())   // Set of dayIds
  const [festivalCombinedBulkText,   setFestivalCombinedBulkText]   = useState({})          // { [dayId]: string }
  const [festivalCombinedBulkResult, setFestivalCombinedBulkResult] = useState({})          // { [dayId]: { errors, warnings, success } }

  // ── Withdrawals ──
  // (no extra state needed — withdrawal state lives on runners.is_withdrawn in DB)

  // ── Results ──
  const [raceResults, setRaceResults]         = useState({})
  const [resultForms, setResultForms]         = useState({})
  const [unlockedResults, setUnlockedResults] = useState(new Set())

  // ── Results accordion (all weeks) ──
  const [allResultWeeks,      setAllResultWeeks]      = useState([])   // [{ week, races }]
  const [expandedResultWeeks, setExpandedResultWeeks] = useState(new Set())
  const [expandedResultRaces, setExpandedResultRaces] = useState(new Set())
  const [resultWeeksLoaded,   setResultWeeksLoaded]   = useState(false)

  // ── Leaderboard ──
  const [leaderboard, setLeaderboard] = useState([])

  // ── Init ────────────────────────────────────────────────────
  useEffect(() => { init() }, [])

  // Load all-weeks results accordion when tab is opened for the first time
  useEffect(() => {
    if (activeTab === 'results' && !resultWeeksLoaded && activeSeason) {
      loadAllResultWeeks()
    }
  }, [activeTab, activeSeason, resultWeeksLoaded])

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
    if (active) await loadAllWeeks(active.id)
  }

  // Returns the ID of the "active" week — closest upcoming Saturday, or most recent past
  function getActiveWeekId(weeks) {
    if (!weeks.length) return null
    const todayStr = new Date().toISOString().split('T')[0]
    const upcoming = weeks
      .filter(w => w.saturday_date >= todayStr)
      .sort((a, b) => a.saturday_date.localeCompare(b.saturday_date))
    if (upcoming.length) return upcoming[0].id
    return weeks[0].id  // weeks[0] = most recent (desc-sorted)
  }

  async function loadAllWeeks(seasonId, selectId) {
    const { data } = await supabase.from('race_weeks').select('*').eq('season_id', seasonId)
      .order('saturday_date', { ascending: false })
    const weeks = data || []
    setAllWeeks(weeks)
    const targetId = selectId || getActiveWeekId(weeks)
    const week = weeks.find(w => w.id === targetId) || weeks[0] || null
    setCurrentWeek(week)
    if (week) await loadRaces(week.id)
  }

  async function switchToWeek(week) {
    if (week.id === currentWeek?.id) return
    setCurrentWeek(week)
    setRaces([])
    setRunners({})
    setRaceResults({})
    await loadRaces(week.id)
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

  async function loadAllResultWeeks() {
    if (!activeSeason) return
    setLoading(true)
    const { data: weeks } = await supabase
      .from('race_weeks').select('*')
      .eq('season_id', activeSeason.id)
      .order('saturday_date', { ascending: false })
    const allW = weeks || []

    // Default-expand the active week
    const activeWId = getActiveWeekId(allW)
    setExpandedResultWeeks(new Set(activeWId ? [activeWId] : []))

    const weeksWithRaces = []
    for (const week of allW) {
      const { data: raceData } = await supabase
        .from('races').select('*').eq('race_week_id', week.id).order('race_number')
      const raceList = raceData || []
      weeksWithRaces.push({ week, races: raceList })
      for (const race of raceList) {
        await loadRunners(race.id)
        await loadResults(race.id)
      }
    }

    setAllResultWeeks(weeksWithRaces)
    setResultWeeksLoaded(true)
    setLoading(false)
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
      .select('user_id, total_points, race_id, profiles(username, full_name)').in('race_id', raceList.map(r => r.id))
    const totals = {}
    for (const s of (scores || [])) {
      if (!totals[s.user_id]) totals[s.user_id] = { name: s.profiles?.username || s.profiles?.full_name || 'Unknown', total: 0, week: 0 }
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
      name: seasonForm.name, display_name: seasonForm.displayName || null, quarter: seasonForm.quarter,
      year: parseInt(seasonForm.year), start_date: seasonForm.startDate, end_date: seasonForm.endDate, is_active: false,
    })
    setLoading(false)
    if (error) { showToast('error', error.message); return }
    showToast('success', 'Season created')
    setShowSeasonForm(false)
    setSeasonForm({ name: '', displayName: '', quarter: 'Q1', year: new Date().getFullYear(), startDate: '', endDate: '' })
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

    // Duplicate check — warn if a week already exists for this Saturday
    const { data: existing } = await supabase
      .from('race_weeks').select('id, week_number').eq('season_id', activeSeason.id).eq('saturday_date', weekDate)
    if (existing?.length) {
      setLoading(false)
      showToast('error', `A race week already exists for ${weekDate} (Week ${existing[0].week_number}) — select it from the week list`)
      return
    }

    const { data: weekList } = await supabase.from('race_weeks').select('id').eq('season_id', activeSeason.id)
    const { data: newWeek, error } = await supabase.from('race_weeks').insert({
      season_id: activeSeason.id,
      week_number: (weekList?.length || 0) + 1,
      saturday_date: weekDate,
      picks_deadline: `${weekDate}T${weekDeadlineTime}:00`,
      is_locked: false,
    }).select().single()
    setLoading(false)
    if (error) { showToast('error', error.message); return }
    showToast('success', `Week ${(weekList?.length || 0) + 1} created — now add your 7 races below`)
    setShowWeekForm(false)
    setWeekDate('')
    setWeekDeadlineTime('12:00')
    await loadAllWeeks(activeSeason.id, newWeek?.id)
  }

  function startEditWeek() {
    setEditWeekForm({
      saturdayDate: currentWeek.saturday_date,
      picksDeadline: currentWeek.picks_deadline?.slice(11, 16) || '12:00',
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
    await loadAllWeeks(activeSeason.id, currentWeek.id)
  }

  function deleteRaceWeek() {
    confirm(
      'Delete race week?',
      `Week ${currentWeek.week_number} (${currentWeek.saturday_date}) and all its races, runners and results will be deleted.`,
      async () => {
        const { error } = await supabase.from('race_weeks').delete().eq('id', currentWeek.id)
        if (error) { showToast('error', error.message); return }
        setRaces([]); setRunners({}); setRaceResults({})
        showToast('success', 'Race week deleted')
        await loadAllWeeks(activeSeason.id)
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
  function nrf(raceId) { return newRunnerForm[raceId] || { number: '', name: '', jockey: '', trainer: '', colour: '', odds: '', form: '' } }
  function setNrf(raceId, patch) { setNewRunnerForm(p => ({ ...p, [raceId]: { ...nrf(raceId), ...patch } })) }

  async function addRunner(raceId) {
    const form = nrf(raceId)
    if (!form.name.trim()) { showToast('error', 'Horse name is required'); return }
    setLoading(true)
    const oddsDecimal = parseFractionalOdds(form.odds) || null
    const { error } = await supabase.from('runners').insert({
      race_id: raceId,
      horse_name: form.name.trim(),
      horse_number: form.number ? parseInt(form.number) : null,
      jockey: form.jockey.trim() || null,
      trainer: form.trainer.trim() || null,
      silk_colour: form.colour || null,
      odds_fractional: form.odds.trim() || null,
      odds_decimal: oddsDecimal,
      form_string: form.form.trim() || null,
    })
    setLoading(false)
    if (error) { showToast('error', error.message); return }
    setNewRunnerForm(p => ({ ...p, [raceId]: { number: '', name: '', jockey: '', trainer: '', colour: '', odds: '', form: '' } }))
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
      odds:    runner.odds_fractional || '',
      form:    runner.form_string || '',
    })
  }

  async function saveEditRunner(raceId, runnerId) {
    if (!editRunnerForm.name.trim()) { showToast('error', 'Horse name is required'); return }
    setLoading(true)
    const oddsDecimal = parseFractionalOdds(editRunnerForm.odds) || null
    const { error } = await supabase.from('runners').update({
      horse_name:      editRunnerForm.name.trim(),
      horse_number:    editRunnerForm.number ? parseInt(editRunnerForm.number) : null,
      jockey:          editRunnerForm.jockey.trim() || null,
      trainer:         editRunnerForm.trainer.trim() || null,
      silk_colour:     editRunnerForm.colour || null,
      odds_fractional: editRunnerForm.odds.trim() || null,
      odds_decimal:    oddsDecimal,
      form_string:     editRunnerForm.form.trim() || null,
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

  // ── Bulk import ──────────────────────────────────────────────
  function toggleBulkImport(raceId) {
    setBulkImportOpen(prev => {
      const s = new Set(prev)
      if (s.has(raceId)) { s.delete(raceId) } else { s.add(raceId) }
      return s
    })
    setBulkImportResult(p => { const n = { ...p }; delete n[raceId]; return n })
  }

  async function bulkImportRunners(raceId) {
    const text = bulkImportText[raceId] || ''
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0)
    if (!lines.length) { showToast('error', 'Paste some runners first'); return }

    const existingRunners = runners[raceId] || []
    const existingNames   = new Set(existingRunners.map(r => r.horse_name.toLowerCase()))

    const errors   = []
    const warnings = []
    const toInsert = []

    lines.forEach((line, i) => {
      const lineNum = i + 1
      // Split on comma but limit to 6 parts so a colour like #1a3a10 doesn't get clipped
      const raw   = line.split(',')
      const parts = raw.map(p => p.trim())

      if (parts.length < 6) {
        errors.push(`Line ${lineNum}: expected at least 6 fields (got ${parts.length}) — "${line}"`)
        return
      }

      const [numStr, name, jockey, trainer, oddsStr, colour, ...rest] = parts
      const formStr = rest.join(',').trim() || null   // 7th field (optional)

      if (!name) {
        errors.push(`Line ${lineNum}: horse name is empty`)
        return
      }

      // Duplicate check
      if (existingNames.has(name.toLowerCase())) {
        warnings.push(`Line ${lineNum}: "${name}" already exists in this race — skipped`)
        return
      }

      // Odds
      const oddsDecimal = parseFractionalOdds(oddsStr)
      if (oddsStr && !oddsDecimal) {
        warnings.push(`Line ${lineNum}: odds "${oddsStr}" not recognised — imported with no odds`)
      }

      // Silk colour — validate hex
      const hexValid  = /^#[0-9a-fA-F]{6}$/.test(colour)
      const silkColour = hexValid ? colour : (colour ? '#1a3a10' : null)
      if (colour && !hexValid) {
        warnings.push(`Line ${lineNum}: colour "${colour}" is not a valid hex — defaulted to #1a3a10`)
      }

      const horseNum = parseInt(numStr)
      toInsert.push({
        race_id:         raceId,
        horse_number:    !isNaN(horseNum) ? horseNum : null,
        horse_name:      name,
        jockey:          jockey || null,
        trainer:         trainer || null,
        odds_fractional: oddsStr  || null,
        odds_decimal:    oddsDecimal || null,
        silk_colour:     silkColour,
        form_string:     formStr,
      })
    })

    // Show errors and stop if nothing valid to insert
    if (toInsert.length === 0) {
      setBulkImportResult(p => ({ ...p, [raceId]: { errors, warnings } }))
      return
    }

    // If there are line errors, show them and don't proceed
    if (errors.length > 0) {
      setBulkImportResult(p => ({ ...p, [raceId]: { errors, warnings } }))
      return
    }

    setLoading(true)
    const { error } = await supabase.from('runners').insert(toInsert)
    setLoading(false)

    if (error) {
      setBulkImportResult(p => ({ ...p, [raceId]: { errors: [`Database error: ${error.message}`], warnings } }))
      return
    }

    await loadRunners(raceId)

    // Close panel + clear state
    setBulkImportOpen(prev => { const s = new Set(prev); s.delete(raceId); return s })
    setBulkImportText(p => { const n = { ...p }; delete n[raceId]; return n })
    setBulkImportResult(p => { const n = { ...p }; delete n[raceId]; return n })

    const count = toInsert.length
    const warnStr = warnings.length > 0 ? ` (${warnings.length} warning${warnings.length !== 1 ? 's' : ''} — check console)` : ''
    showToast('success', `${count} runner${count !== 1 ? 's' : ''} imported successfully${warnStr}`)
    if (warnings.length) console.warn('[Bulk Import] Warnings:', warnings)
  }

  // ── Combined import (race + runners) ────────────────────────
  async function bulkImportCombined() {
    if (!currentWeek) { showToast('error', 'No race week selected'); return }
    const text = combinedImportText.trim()
    if (!text) { showToast('error', 'Paste your race data first'); return }

    // Split at first blank line to separate header from runners
    const blankLineIdx = text.search(/\n\s*\n/)
    if (blankLineIdx === -1) {
      setCombinedImportResult({ errors: ['Missing blank line — separate race info from runners with a blank line'], warnings: [], success: null })
      return
    }
    const headerSection = text.slice(0, blankLineIdx).trim()
    const runnerSection = text.slice(blankLineIdx).trim()

    // Parse header (key: value pairs)
    const headerFields = {}
    for (const line of headerSection.split('\n')) {
      const colonIdx = line.indexOf(':')
      if (colonIdx === -1) continue
      const key = line.slice(0, colonIdx).trim().toLowerCase()
      const val = line.slice(colonIdx + 1).trim()
      headerFields[key] = val
    }

    const errors = []
    const warnings = []

    // Required header fields
    if (!headerFields.venue)     errors.push('Missing field: venue')
    if (!headerFields.time)      errors.push('Missing field: time')
    if (!headerFields.race_name) errors.push('Missing field: race_name')

    if (errors.length) { setCombinedImportResult({ errors, warnings, success: null }); return }

    // Validate time format (HH:MM)
    if (!/^\d{1,2}:\d{2}$/.test(headerFields.time)) {
      warnings.push(`Time "${headerFields.time}" looks unusual — expected format like 13:50`)
    }

    // Check race slot availability
    const usedNums = new Set(races.map(r => r.race_number))
    const nextRaceNum = [1,2,3,4,5,6,7].find(n => !usedNums.has(n))
    if (!nextRaceNum) {
      setCombinedImportResult({ errors: ['All 7 race slots are already filled for this week'], warnings, success: null })
      return
    }

    // Parse runners
    const runnerLines = runnerSection.split('\n').map(l => l.trim()).filter(l => l.length > 0)
    if (!runnerLines.length) {
      setCombinedImportResult({ errors: ['No runners found — add runner lines after the blank line'], warnings, success: null })
      return
    }

    const expectedRunners = headerFields.runners ? parseInt(headerFields.runners) : null
    const toInsert = []

    for (let i = 0; i < runnerLines.length; i++) {
      const line    = runnerLines[i]
      const lineNum = i + 1
      const parts   = line.split(',').map(p => p.trim())

      if (parts.length < 6) {
        errors.push(`Line ${lineNum} skipped — incorrect format (need at least 6 fields, got ${parts.length})`)
        continue
      }

      const [numStr, name, jockey, trainer, oddsStr, primaryHex, secondaryHex, pattern] = parts

      if (!name) { errors.push(`Line ${lineNum} skipped — horse name is empty`); continue }

      // Odds
      let oddsDecimal = null
      const oddsNorm = oddsStr?.trim().toLowerCase()
      if (oddsNorm && oddsNorm !== 'tba' && oddsNorm !== '') {
        oddsDecimal = parseFractionalOdds(oddsStr)
        if (!oddsDecimal) warnings.push(`Line ${lineNum}: odds "${oddsStr}" not recognised — imported with no odds`)
      }

      // Primary silk hex
      const hexOk       = /^#[0-9a-fA-F]{6}$/.test(primaryHex)
      const silkColour  = hexOk ? primaryHex : (primaryHex && primaryHex.toLowerCase() !== 'tba' ? '#1a3a10' : null)
      if (primaryHex && !hexOk && primaryHex.toLowerCase() !== 'tba') {
        warnings.push(`Line ${lineNum}: primary colour "${primaryHex}" not a valid hex — defaulted to #1a3a10`)
      }

      // Secondary silk hex
      const sec2Ok              = secondaryHex && /^#[0-9a-fA-F]{6}$/.test(secondaryHex)
      const silkColourSecondary = sec2Ok ? secondaryHex : null

      const horseNum = parseInt(numStr)
      toInsert.push({
        horse_number:          !isNaN(horseNum) ? horseNum : null,
        horse_name:            name,
        jockey:                (jockey && jockey.toLowerCase() !== 'tba') ? jockey : 'TBA',
        trainer:               (trainer && trainer.toLowerCase() !== 'tba') ? trainer : null,
        odds_fractional:       (oddsStr && oddsStr.toLowerCase() !== 'tba') ? oddsStr : null,
        odds_decimal:          oddsDecimal,
        silk_colour:           silkColour,
        silk_colour_secondary: silkColourSecondary,
        silk_pattern:          pattern?.trim() || null,
      })
    }

    if (errors.length) { setCombinedImportResult({ errors, warnings, success: null }); return }
    if (!toInsert.length) { setCombinedImportResult({ errors: ['No valid runners to import'], warnings, success: null }); return }

    if (expectedRunners && toInsert.length !== expectedRunners) {
      warnings.push(`Expected ${expectedRunners} runners but parsed ${toInsert.length}`)
    }

    setLoading(true)

    // ── Create the race record
    const racePayload = {
      race_week_id: currentWeek.id,
      race_number:  nextRaceNum,
      venue:        headerFields.venue,
      race_name:    headerFields.race_name,
      race_time:    headerFields.time,
    }
    // Optional columns (require migration — see header comments)
    if (headerFields.class)    racePayload.class_type = headerFields.class
    if (headerFields.distance) racePayload.distance   = headerFields.distance

    const { data: newRace, error: raceErr } = await supabase.from('races').insert(racePayload).select().single()
    if (raceErr) {
      setLoading(false)
      setCombinedImportResult({ errors: [`Failed to create race: ${raceErr.message}`], warnings, success: null })
      return
    }

    // ── Insert runners
    const runnersPayload = toInsert.map(r => ({ ...r, race_id: newRace.id }))
    const { error: runnerErr } = await supabase.from('runners').insert(runnersPayload)
    if (runnerErr) {
      await supabase.from('races').delete().eq('id', newRace.id)   // rollback
      setLoading(false)
      setCombinedImportResult({ errors: [`Runners failed — race was not saved: ${runnerErr.message}`], warnings, success: null })
      return
    }

    await loadRaces(currentWeek.id)
    setLoading(false)

    const successMsg = `Race created: ${headerFields.venue} ${headerFields.time} — ${toInsert.length} runner${toInsert.length !== 1 ? 's' : ''} imported`
    setCombinedImportResult({ errors: [], warnings, success: successMsg })
    setCombinedImportText('')
  }

  // ── Festival combined import (race + runners, one block per race) ─────────
  async function bulkImportFestivalCombined(dayId) {
    if (!dayId) { showToast('error', 'No festival day selected'); return }
    const text = (festivalCombinedBulkText[dayId] || '').trim()
    if (!text) { showToast('error', 'Paste race data first'); return }

    // Split at first blank line — header above, runners below
    const blankLineIdx = text.search(/\n\s*\n/)
    if (blankLineIdx === -1) {
      setFestivalCombinedBulkResult(p => ({ ...p, [dayId]: { errors: ['Missing blank line — separate race info from runners with a blank line'], warnings: [], success: null } }))
      return
    }
    const headerSection = text.slice(0, blankLineIdx).trim()
    const runnerSection = text.slice(blankLineIdx).trim()

    // Parse header key: value pairs
    const headerFields = {}
    for (const line of headerSection.split('\n')) {
      const colonIdx = line.indexOf(':')
      if (colonIdx === -1) continue
      const key = line.slice(0, colonIdx).trim().toLowerCase()
      const val = line.slice(colonIdx + 1).trim()
      headerFields[key] = val
    }

    const errors = []; const warnings = []
    if (!headerFields.venue)     errors.push('Missing field: venue')
    if (!headerFields.time)      errors.push('Missing field: time')
    if (!headerFields.race_name) errors.push('Missing field: race_name')
    if (errors.length) { setFestivalCombinedBulkResult(p => ({ ...p, [dayId]: { errors, warnings, success: null } })); return }

    if (!/^\d{1,2}:\d{2}$/.test(headerFields.time)) {
      warnings.push(`Time "${headerFields.time}" looks unusual — expected format like 13:50`)
    }

    // Next available race number for this day
    const usedNums  = new Set(festivalRaces.map(r => r.race_number))
    const nextNums  = [1,2,3,4,5,6,7,8,9,10].filter(n => !usedNums.has(n))
    const nextRaceNum = nextNums.length ? nextNums[0] : (Math.max(0, ...festivalRaces.map(r => r.race_number)) + 1)

    // Parse runners
    const runnerLines = runnerSection.split('\n').map(l => l.trim()).filter(l => l.length > 0)
    if (!runnerLines.length) {
      setFestivalCombinedBulkResult(p => ({ ...p, [dayId]: { errors: ['No runners found — add runner lines after the blank line'], warnings, success: null } })); return
    }

    const expectedRunners = headerFields.runners ? parseInt(headerFields.runners) : null
    const toInsert = []

    for (let i = 0; i < runnerLines.length; i++) {
      const line = runnerLines[i]; const lineNum = i + 1
      const parts = line.split(',').map(p => p.trim())
      if (parts.length < 6) { errors.push(`Line ${lineNum} skipped — need at least 6 fields, got ${parts.length}`); continue }
      const [numStr, name, jockey, trainer, oddsStr, primaryHex, secondaryHex, pattern] = parts
      if (!name) { errors.push(`Line ${lineNum} skipped — horse name is empty`); continue }

      let oddsDecimal = null
      const oddsNorm = oddsStr?.trim().toLowerCase()
      if (oddsNorm && oddsNorm !== 'tba') {
        oddsDecimal = parseFractionalOdds(oddsStr)
        if (!oddsDecimal) warnings.push(`Line ${lineNum}: odds "${oddsStr}" not recognised — imported with no odds`)
      }

      const hexOk      = /^#[0-9a-fA-F]{6}$/.test(primaryHex)
      const silkColour = hexOk ? primaryHex : (primaryHex && primaryHex.toLowerCase() !== 'tba' ? '#1a3a10' : null)
      if (primaryHex && !hexOk && primaryHex.toLowerCase() !== 'tba') warnings.push(`Line ${lineNum}: colour "${primaryHex}" invalid — defaulted to #1a3a10`)

      const sec2Ok              = secondaryHex && /^#[0-9a-fA-F]{6}$/.test(secondaryHex)
      const silkColourSecondary = sec2Ok ? secondaryHex : null

      const horseNum = parseInt(numStr)
      toInsert.push({
        horse_number:          !isNaN(horseNum) ? horseNum : null,
        horse_name:            name,
        jockey:                (jockey && jockey.toLowerCase() !== 'tba') ? jockey : 'TBA',
        trainer:               (trainer && trainer.toLowerCase() !== 'tba') ? trainer : null,
        odds_fractional:       (oddsStr && oddsStr.toLowerCase() !== 'tba') ? oddsStr : null,
        odds_decimal:          oddsDecimal,
        silk_colour:           silkColour,
        silk_colour_secondary: silkColourSecondary,
        silk_pattern:          pattern?.trim() || null,
      })
    }

    if (errors.length) { setFestivalCombinedBulkResult(p => ({ ...p, [dayId]: { errors, warnings, success: null } })); return }
    if (!toInsert.length) { setFestivalCombinedBulkResult(p => ({ ...p, [dayId]: { errors: ['No valid runners to import'], warnings, success: null } })); return }
    if (expectedRunners && toInsert.length !== expectedRunners) warnings.push(`Expected ${expectedRunners} runners but parsed ${toInsert.length}`)

    setLoading(true)

    // Create the festival race record
    const racePayload = {
      festival_day_id: dayId,
      race_number:     nextRaceNum,
      venue:           headerFields.venue,
      race_name:       headerFields.race_name,
      race_time:       headerFields.time,
    }
    if (headerFields.distance) racePayload.distance   = headerFields.distance

    const { data: newRace, error: raceErr } = await supabase.from('festival_races').insert(racePayload).select().single()
    if (raceErr) {
      setLoading(false)
      setFestivalCombinedBulkResult(p => ({ ...p, [dayId]: { errors: [`Failed to create race: ${raceErr.message}`], warnings, success: null } }))
      return
    }

    // Insert runners linked to the new festival race
    const runnersPayload = toInsert.map(r => ({ ...r, festival_race_id: newRace.id }))
    const { error: runnerErr } = await supabase.from('festival_runners').insert(runnersPayload)
    if (runnerErr) {
      await supabase.from('festival_races').delete().eq('id', newRace.id)   // rollback
      setLoading(false)
      setFestivalCombinedBulkResult(p => ({ ...p, [dayId]: { errors: [`Runners failed — race was not saved: ${runnerErr.message}`], warnings, success: null } }))
      return
    }

    await loadFestivalRaces(dayId)
    setLoading(false)

    const msg = `Race ${nextRaceNum} created: ${headerFields.venue} ${headerFields.time} — ${toInsert.length} runner${toInsert.length !== 1 ? 's' : ''} imported`
    setFestivalCombinedBulkResult(p => ({ ...p, [dayId]: { errors: [], warnings, success: msg } }))
    setFestivalCombinedBulkText(p => ({ ...p, [dayId]: '' }))
  }

  // ── Results CRUD ─────────────────────────────────────────────
  function unlockResults(race) {
    const existing = raceResults[race.id]
    if (existing?.length) {
      setResultForms(p => ({
        ...p, [race.id]: {
          horse1: existing.find(r => r.position === 1)?.horse_name || '',
          horse2: existing.find(r => r.position === 2)?.horse_name || '',
          horse3: existing.find(r => r.position === 3)?.horse_name || '',
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
    runnerRows?.forEach(r => {
      nameMap[r.id] = r.horse_name
    })

    // 5. Build score rows
    const scoresToInsert = picks
      .map(pick => {
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
    setLoading(true)

    // Look up opening odds from the runner records
    const raceRunners = runners[race.id] || []
    function getRunnerOdds(horseName) {
      const runner = raceRunners.find(r => r.horse_name === horseName)
      return {
        oddsDecimal: runner?.odds_decimal   || null,
        oddsDisplay: runner?.odds_fractional || null,
      }
    }
    const o1 = getRunnerOdds(form.horse1)
    const o2 = getRunnerOdds(form.horse2)
    const o3 = getRunnerOdds(form.horse3)

    // ── Step 1: delete old results for this race ────────────────
    const { error: delResErr } = await supabase.from('results').delete().eq('race_id', race.id)
    if (delResErr) { showToast('error', `Delete results failed: ${delResErr.message}`); setLoading(false); return }

    // ── Step 2: insert the three result rows ────────────────────
    const { error: resErr } = await supabase.from('results').insert([
      { race_id: race.id, position: 1, horse_name: form.horse1, starting_price_decimal: o1.oddsDecimal, starting_price_display: o1.oddsDisplay },
      { race_id: race.id, position: 2, horse_name: form.horse2, starting_price_decimal: o2.oddsDecimal, starting_price_display: o2.oddsDisplay },
      { race_id: race.id, position: 3, horse_name: form.horse3, starting_price_decimal: o3.oddsDecimal, starting_price_display: o3.oddsDisplay },
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

  // ── Mark / reinstate a horse as withdrawn ────────────────────
  async function withdrawRunner(runner, raceId) {
    setLoading(true)
    // Find the favourite for this race (lowest odds_decimal, not already withdrawn, not this runner)
    const { data: raceRunners } = await supabase
      .from('runners')
      .select('id, horse_name, odds_decimal, odds_fractional')
      .eq('race_id', raceId)
      .eq('is_withdrawn', false)
      .neq('id', runner.id)
      .order('odds_decimal', { ascending: true })
      .limit(1)
    setLoading(false)

    const favourite = raceRunners?.[0] || null

    if (!favourite) {
      confirm(
        `Cannot withdraw ${runner.horse_name}`,
        `No valid favourite found — all other runners may also be withdrawn. Please handle this manually.`,
        () => {}
      )
      return
    }

    const oddsDisplay = favourite.odds_fractional || (favourite.odds_decimal ? `${favourite.odds_decimal}` : '?')

    confirm(
      `Mark ${runner.horse_name} as withdrawn?`,
      `Any players who picked this horse will automatically be switched to the race favourite: ${favourite.horse_name} (${oddsDisplay}).`,
      async () => {
        setLoading(true)

        // 1. Mark runner as withdrawn
        const { error: wdErr } = await supabase.from('runners').update({ is_withdrawn: true }).eq('id', runner.id)
        if (wdErr) { showToast('error', wdErr.message); setLoading(false); return }

        // 2. Find all picks for this withdrawn runner
        const { data: affectedPicks } = await supabase
          .from('picks').select('id').eq('runner_id', runner.id)

        // 3. Update each affected pick — switch to favourite and record the replacement
        if (affectedPicks?.length) {
          const { error: pickErr } = await supabase.from('picks').update({
            runner_id: favourite.id,
            original_runner_id: runner.id,
            was_replaced: true,
            replacement_reason: 'Horse withdrawn — replaced with race favourite',
          }).eq('runner_id', runner.id)
          if (pickErr) showToast('error', `Withdrawal saved but pick update failed: ${pickErr.message}`)
        }

        await loadRunners(raceId)
        setLoading(false)
        const pickCount = affectedPicks?.length || 0
        showToast('success', `${runner.horse_name} withdrawn — ${pickCount} pick${pickCount !== 1 ? 's' : ''} switched to ${favourite.horse_name}`)
      }
    )
  }

  async function reinstateRunner(runner, raceId) {
    confirm(
      `Reinstate ${runner.horse_name}?`,
      `The horse will be reinstated. Any auto-replaced picks will be reverted back to this horse.`,
      async () => {
        setLoading(true)

        // 1. Reinstate the runner
        const { error: reErr } = await supabase.from('runners').update({ is_withdrawn: false }).eq('id', runner.id)
        if (reErr) { showToast('error', reErr.message); setLoading(false); return }

        // 2. Revert any picks that were auto-replaced from this runner
        const { data: replacedPicks } = await supabase
          .from('picks').select('id').eq('original_runner_id', runner.id).eq('was_replaced', true)

        if (replacedPicks?.length) {
          const { error: revertErr } = await supabase.from('picks').update({
            runner_id: runner.id,
            original_runner_id: null,
            was_replaced: false,
            replacement_reason: null,
          }).eq('original_runner_id', runner.id).eq('was_replaced', true)
          if (revertErr) showToast('error', `Reinstated but pick revert failed: ${revertErr.message}`)
        }

        await loadRunners(raceId)
        const revertCount = replacedPicks?.length || 0
        setLoading(false)
        showToast('success', `${runner.horse_name} reinstated${revertCount > 0 ? ` — ${revertCount} pick${revertCount !== 1 ? 's' : ''} reverted` : ''}`)
      }
    )
  }


  // ── Festival loaders ──────────────────────────────────────────
  async function loadFestivals() {
    const { data } = await supabase.from('festivals').select('*').order('start_date', { ascending: false })
    setFestivals(data || [])
    const first = data?.find(f => f.is_active) || data?.[0] || null
    setSelectedFestival(first)
    if (first) await loadFestivalDays(first.id)
  }

  async function selectFestivalById(festival) {
    setSelectedFestival(festival)
    setFestivalDays([])
    setSelectedDay(null)
    setFestivalRaces([])
    setFestivalRunners({})
    setFestivalResults({})
    await loadFestivalDays(festival.id)
  }

  async function loadFestivalDays(festivalId) {
    const { data } = await supabase.from('festival_days').select('*').eq('festival_id', festivalId).order('day_number')
    setFestivalDays(data || [])
    if (data?.length) {
      setSelectedDay(data[0])
      await loadFestivalRaces(data[0].id)
    } else {
      setSelectedDay(null)
      setFestivalRaces([])
    }
  }

  async function selectFestivalDay(day) {
    if (day.id === selectedDay?.id) return
    setSelectedDay(day)
    setFestivalRaces([])
    setFestivalRunners({})
    setFestivalResults({})
    await loadFestivalRaces(day.id)
  }

  async function loadFestivalRaces(dayId) {
    const { data } = await supabase.from('festival_races').select('*').eq('festival_day_id', dayId).order('race_number')
    setFestivalRaces(data || [])
    for (const race of (data || [])) {
      await loadFestivalRunners(race.id)
      await loadFestivalResults(race.id)
    }
  }

  async function loadFestivalRunners(raceId) {
    const { data } = await supabase.from('festival_runners').select('*').eq('festival_race_id', raceId).order('horse_number')
    setFestivalRunners(prev => ({ ...prev, [raceId]: data || [] }))
  }

  async function loadFestivalResults(raceId) {
    const { data } = await supabase.from('festival_results').select('*').eq('festival_race_id', raceId).order('position')
    setFestivalResults(prev => ({ ...prev, [raceId]: data || [] }))
  }

  // ── Festival CRUD ─────────────────────────────────────────────
  async function createFestival(e) {
    e.preventDefault(); setLoading(true)
    const { data: fest, error } = await supabase.from('festivals').insert({
      name: festivalForm.name,
      display_name: festivalForm.displayName || null,
      banner_colour: festivalForm.bannerColour || '#c9a84c',
      start_date: festivalForm.startDate,
      end_date: festivalForm.endDate,
      is_active: false,
    }).select().single()
    setLoading(false)
    if (error) { showToast('error', error.message); return }
    showToast('success', 'Festival created')
    setShowFestivalForm(false)
    setFestivalForm({ name: '', displayName: '', bannerColour: '#c9a84c', startDate: '', endDate: '' })
    await loadFestivals()
    // Auto-generate days
    if (fest) await generateFestivalDays(fest)
  }

  async function saveFestivalEdit(id) {
    setLoading(true)
    const { error } = await supabase.from('festivals').update({
      name: editFestivalForm.name,
      display_name: editFestivalForm.displayName || null,
      banner_colour: editFestivalForm.bannerColour || '#c9a84c',
      start_date: editFestivalForm.startDate,
      end_date: editFestivalForm.endDate,
    }).eq('id', id)
    if (error) { setLoading(false); showToast('error', error.message); return }

    // Recalculate each day's race_date/label/deadline from the new start date
    // (does NOT delete days or touch any races/runners/results)
    const { data: existingDays } = await supabase
      .from('festival_days').select('id, day_number')
      .eq('festival_id', id).order('day_number')

    if (existingDays?.length) {
      const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
      const newStart = new Date(editFestivalForm.startDate + 'T12:00:00')
      for (const day of existingDays) {
        const d = new Date(newStart)
        d.setDate(newStart.getDate() + (day.day_number - 1))
        const dateStr  = d.toISOString().split('T')[0]
        const dayName  = DAY_NAMES[d.getDay()]
        await supabase.from('festival_days').update({
          race_date:      dateStr,
          label:          `Day ${day.day_number} — ${dayName}`,
          picks_deadline: dateStr + 'T11:30:00+00:00',
        }).eq('id', day.id)
      }
    }

    setLoading(false)
    showToast('success', 'Festival updated')
    setEditingFestival(null)
    await loadFestivals()
  }

  async function activateFestival(id) {
    setLoading(true)
    await supabase.from('festivals').update({ is_active: false }).neq('id', id)
    await supabase.from('festivals').update({ is_active: true }).eq('id', id)
    await loadFestivals()
    setLoading(false)
    showToast('success', 'Festival set as active')
  }

  async function deactivateFestival(id) {
    setLoading(true)
    await supabase.from('festivals').update({ is_active: false }).eq('id', id)
    await loadFestivals()
    setLoading(false)
    showToast('success', 'Festival deactivated')
  }

  async function deleteFestivalFn(id) {
    const f = festivals.find(x => x.id === id)
    confirm(
      'Delete festival?',
      `"${f?.name}" and all its days, races, runners and results will be permanently deleted.`,
      async () => {
        const { error } = await supabase.from('festivals').delete().eq('id', id)
        if (error) { showToast('error', error.message); return }
        showToast('success', 'Festival deleted')
        await loadFestivals()
      }
    )
  }

  async function generateFestivalDays(festival) {
    const start = new Date(festival.start_date + 'T12:00:00')
    const end   = new Date(festival.end_date   + 'T12:00:00')
    if (isNaN(start) || isNaN(end) || start > end) { showToast('error', 'Invalid date range'); return }

    // Delete existing days first
    await supabase.from('festival_days').delete().eq('festival_id', festival.id)

    const dayRows = []
    let cur = new Date(start)
    let num = 1
    const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
    while (cur <= end) {
      const dateStr  = cur.toISOString().split('T')[0]
      const dayName  = DAY_NAMES[cur.getDay()]
      const deadline = dateStr + 'T11:30:00+00:00'
      dayRows.push({
        festival_id:    festival.id,
        day_number:     num,
        race_date:      dateStr,
        label:          `Day ${num} — ${dayName}`,
        picks_deadline: deadline,
      })
      cur.setDate(cur.getDate() + 1)
      num++
    }

    setLoading(true)
    const { error } = await supabase.from('festival_days').insert(dayRows)
    setLoading(false)
    if (error) { showToast('error', `Day generation failed: ${error.message}`); return }
    showToast('success', `${dayRows.length} day${dayRows.length !== 1 ? 's' : ''} generated`)
    await loadFestivalDays(festival.id)
  }

  // ── Festival race CRUD ────────────────────────────────────────
  async function saveFestivalRace(dayId, raceNum) {
    const form = festivalRaceForms[`${dayId}_${raceNum}`] || {}
    setLoading(true)
    const { error } = await supabase.from('festival_races').upsert({
      festival_day_id: dayId,
      race_number:     raceNum,
      race_time:       form.raceTime || null,
      venue:           form.venue    || null,
      race_name:       form.raceName || null,
    }, { onConflict: 'festival_day_id,race_number' })
    setLoading(false)
    if (error) { showToast('error', error.message); return }
    showToast('success', `Race ${raceNum} saved`)
    setShowFestivalRaceForm(p => { const n = { ...p }; delete n[`${dayId}_${raceNum}`]; return n })
    setFestivalRaceForms(p => { const n = { ...p }; delete n[`${dayId}_${raceNum}`]; return n })
    await loadFestivalRaces(dayId)
  }

  async function deleteFestivalRace(raceId, dayId) {
    confirm('Delete race?', 'This will also delete all runners and results for this race.', async () => {
      const { error } = await supabase.from('festival_races').delete().eq('id', raceId)
      if (error) { showToast('error', error.message); return }
      showToast('success', 'Race deleted')
      await loadFestivalRaces(dayId)
    })
  }

  // ── Festival bulk import ──────────────────────────────────────
  async function bulkImportFestivalRunners(raceId) {
    const text = festivalBulkText[raceId] || ''
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0)
    if (!lines.length) { showToast('error', 'Paste some runners first'); return }

    const existing     = festivalRunners[raceId] || []
    const existingNames = new Set(existing.map(r => r.horse_name.toLowerCase()))
    const errors = []; const warnings = []; const toInsert = []

    lines.forEach((line, i) => {
      const lineNum = i + 1
      const parts = line.split(',').map(p => p.trim())
      if (parts.length < 6) { errors.push(`Line ${lineNum}: expected 6 fields — "${line}"`); return }
      const [numStr, name, jockey, trainer, oddsStr, colour] = parts
      if (!name) { errors.push(`Line ${lineNum}: horse name is empty`); return }
      if (existingNames.has(name.toLowerCase())) { warnings.push(`Line ${lineNum}: "${name}" already exists — skipped`); return }
      const oddsDecimal = parseFractionalOdds(oddsStr)
      if (oddsStr && !oddsDecimal) warnings.push(`Line ${lineNum}: odds "${oddsStr}" not recognised`)
      const hexValid = /^#[0-9a-fA-F]{6}$/.test(colour)
      const silkColour = hexValid ? colour : (colour ? '#1a3a10' : null)
      if (colour && !hexValid) warnings.push(`Line ${lineNum}: colour "${colour}" invalid — defaulted`)
      const horseNum = parseInt(numStr)
      toInsert.push({
        festival_race_id: raceId,
        horse_number:     !isNaN(horseNum) ? horseNum : null,
        horse_name:       name,
        odds_fractional:  oddsStr || null,
        odds_decimal:     oddsDecimal || null,
        silk_colour:      silkColour,
      })
    })

    if (toInsert.length === 0 || errors.length > 0) {
      setFestivalBulkResult(p => ({ ...p, [raceId]: { errors, warnings } })); return
    }

    setLoading(true)
    const { error } = await supabase.from('festival_runners').insert(toInsert)
    setLoading(false)
    if (error) { setFestivalBulkResult(p => ({ ...p, [raceId]: { errors: [`DB error: ${error.message}`], warnings } })); return }

    await loadFestivalRunners(raceId)
    setFestivalBulkOpen(prev => { const s = new Set(prev); s.delete(raceId); return s })
    setFestivalBulkText(p => { const n = { ...p }; delete n[raceId]; return n })
    setFestivalBulkResult(p => { const n = { ...p }; delete n[raceId]; return n })
    showToast('success', `${toInsert.length} runner${toInsert.length !== 1 ? 's' : ''} imported`)
    if (warnings.length) console.warn('[Festival Bulk] Warnings:', warnings)
  }

  // ── Festival results ──────────────────────────────────────────
  function unlockFestivalResults(race) {
    const existing = festivalResults[race.id]
    if (existing?.length) {
      setFestivalResultForms(p => ({
        ...p, [race.id]: {
          horse1: existing.find(r => r.position === 1)?.horse_name || '',
          horse2: existing.find(r => r.position === 2)?.horse_name || '',
          horse3: existing.find(r => r.position === 3)?.horse_name || '',
        }
      }))
    }
    setFestivalUnlocked(prev => new Set([...prev, race.id]))
  }

  async function submitFestivalResults(race) {
    const form = festivalResultForms[race.id] || {}
    if (!form.horse1 || !form.horse2 || !form.horse3) { showToast('error', 'Select all 3 finishers'); return }
    setLoading(true)

    const raceRunnersArr = festivalRunners[race.id] || []
    function getFestivalRunnerOdds(horseName) {
      const r = raceRunnersArr.find(x => x.horse_name === horseName)
      return { oddsDecimal: r?.odds_decimal || null, oddsDisplay: r?.odds_fractional || null }
    }
    const o1 = getFestivalRunnerOdds(form.horse1)
    const o2 = getFestivalRunnerOdds(form.horse2)
    const o3 = getFestivalRunnerOdds(form.horse3)

    // Delete old results
    await supabase.from('festival_results').delete().eq('festival_race_id', race.id)

    // Insert 3 results
    const { error: resErr } = await supabase.from('festival_results').insert([
      { festival_race_id: race.id, position: 1, horse_name: form.horse1, starting_price_display: o1.oddsDisplay },
      { festival_race_id: race.id, position: 2, horse_name: form.horse2, starting_price_display: o2.oddsDisplay },
      { festival_race_id: race.id, position: 3, horse_name: form.horse3, starting_price_display: o3.oddsDisplay },
    ])
    if (resErr) { showToast('error', `Results save failed: ${resErr.message}`); setLoading(false); return }

    // Calculate scores for all picks on this race
    const { data: picks } = await supabase
      .from('festival_picks').select('id, user_id, runner_id').eq('festival_race_id', race.id)

    if (picks?.length) {
      const runnerIds = [...new Set(picks.map(p => p.runner_id).filter(Boolean))]
      const { data: runnerRows } = await supabase.from('festival_runners').select('id, horse_name, odds_decimal').in('id', runnerIds)
      const nameMap = {}; runnerRows?.forEach(r => { nameMap[r.id] = { name: r.horse_name, sp: r.odds_decimal } })

      const placed = { [form.horse1]: { position: 1, sp: o1.oddsDecimal }, [form.horse2]: { position: 2, sp: o2.oddsDecimal }, [form.horse3]: { position: 3, sp: o3.oddsDecimal } }

      // Delete old scores first
      await supabase.from('festival_scores').delete().eq('festival_race_id', race.id)

      const scoreRows = picks.map(pick => {
        const runner = nameMap[pick.runner_id]
        const p = runner ? placed[runner.name] : null
        if (p) {
          const { base, bonus, total } = calcPoints(p.position, p.sp || 1)
          return { festival_race_id: race.id, user_id: pick.user_id, base_points: base, bonus_points: bonus, total_points: total, position_achieved: p.position }
        }
        return { festival_race_id: race.id, user_id: pick.user_id, base_points: 0, bonus_points: 0, total_points: 0, position_achieved: null }
      })

      const { error: scoreErr } = await supabase.from('festival_scores').insert(scoreRows)
      if (scoreErr) { showToast('error', `Results saved but scores failed: ${scoreErr.message}`); setLoading(false); return }
    }

    setFestivalUnlocked(prev => { const s = new Set(prev); s.delete(race.id); return s })
    await loadFestivalResults(race.id)
    setLoading(false)
    showToast('success', `Race ${race.race_number} results saved`)
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
    { id: 'festivals',   label: '05 · Festivals'   },
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
              onClick={() => { setActiveTab(tab.id); if (tab.id === 'leaderboard') loadLeaderboard(); if (tab.id === 'festivals') loadFestivals() }}>
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

      <main style={st.main} className="app-main-pad admin-main">

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
                <div style={st.formGrid} className="app-grid-2">
                  <div style={st.formField}>
                    <label style={st.label}>Season Name</label>
                    <input style={st.input} placeholder="Q2 2026" value={seasonForm.name}
                      onChange={e => setSeasonForm({ ...seasonForm, name: e.target.value })} required />
                  </div>
                  <div style={st.formField}>
                    <label style={st.label}>Display Name (optional)</label>
                    <input style={st.input} placeholder="Spring Season 2026" value={seasonForm.displayName || ''}
                      onChange={e => setSeasonForm({ ...seasonForm, displayName: e.target.value })} />
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
                        <div style={st.formGrid} className="app-grid-2">
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
              <h2 style={st.sectionTitle}>Race Weeks</h2>
              {activeSeason && (
                <button style={st.btnGold} onClick={() => setShowWeekForm(v => !v)}>
                  {showWeekForm ? 'Cancel' : '+ Create Race Week'}
                </button>
              )}
            </div>

            {!activeSeason && <div style={st.warningCard}>No active season — go to Seasons tab first.</div>}

            {/* Create form */}
            {activeSeason && showWeekForm && (
              <form onSubmit={createRaceWeek} style={st.formCard}>
                <div style={st.formTitle}>Create New Race Week</div>
                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                  <div style={st.formField}>
                    <label style={st.label}>Saturday Date</label>
                    <input style={{ ...st.input, maxWidth: '220px' }} type="date" value={weekDate}
                      onChange={e => setWeekDate(e.target.value)} required />
                  </div>
                  <div style={st.formField}>
                    <label style={st.label}>Picks Deadline (time)</label>
                    <input style={{ ...st.input, maxWidth: '160px' }} type="time" value={weekDeadlineTime}
                      onChange={e => setWeekDeadlineTime(e.target.value)} />
                  </div>
                </div>
                <p style={{ fontSize: '0.78rem', color: '#5a8a5a', margin: '0.5rem 0 1rem' }}>
                  Picks deadline defaults to 12:00pm. Creates a fresh week with 7 race slots.
                </p>
                <div style={st.formActions}>
                  <button type="submit" style={st.btnGold} disabled={loading}>{loading ? 'Creating…' : 'Create Race Week'}</button>
                  <button type="button" style={st.btnGhost} onClick={() => setShowWeekForm(false)}>Cancel</button>
                </div>
              </form>
            )}

            {/* Week selector — show all weeks as pills */}
            {activeSeason && allWeeks.length > 0 && (() => {
              const todayStr = new Date().toISOString().split('T')[0]
              const upcomingIds = allWeeks.filter(w => w.saturday_date >= todayStr)
                .sort((a, b) => a.saturday_date.localeCompare(b.saturday_date))
              const activeWeekId = upcomingIds[0]?.id || allWeeks[0]?.id
              return (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                  {allWeeks.map(week => {
                    const isActive   = week.id === activeWeekId
                    const isSelected = week.id === currentWeek?.id
                    return (
                      <button key={week.id}
                        onClick={() => switchToWeek(week)}
                        style={{
                          background: isSelected ? 'rgba(201,168,76,0.18)' : 'rgba(0,0,0,0.25)',
                          border: `1px solid ${isSelected ? '#c9a84c' : 'rgba(201,168,76,0.15)'}`,
                          borderRadius: '6px', padding: '0.4rem 0.85rem', cursor: 'pointer',
                          fontFamily: "'DM Sans', sans-serif", fontSize: '0.78rem',
                          color: isSelected ? '#e8f0e8' : '#5a8a5a', display: 'flex', alignItems: 'center', gap: '0.45rem',
                          fontWeight: isSelected ? '600' : '400',
                        }}>
                        Week {week.week_number} · {week.saturday_date}
                        {isActive && (
                          <span style={{ fontSize: '0.62rem', fontWeight: '700', letterSpacing: '0.07em', color: '#c9a84c', background: 'rgba(201,168,76,0.15)', padding: '0.1rem 0.45rem', borderRadius: '999px', border: '1px solid rgba(201,168,76,0.3)' }}>
                            ACTIVE
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              )
            })()}

            {activeSeason && allWeeks.length === 0 && !showWeekForm && (
              <div style={st.warningCard}>No race week yet — click "+ Create Race Week" above to set one up.</div>
            )}

            {currentWeek && (() => {
              const todayStr = new Date().toISOString().split('T')[0]
              const isCurrentPastWeek = currentWeek.saturday_date < todayStr
              const upcomingIds2 = allWeeks.filter(w => w.saturday_date >= todayStr)
                .sort((a, b) => a.saturday_date.localeCompare(b.saturday_date))
              const activeWeekId2 = upcomingIds2[0]?.id || allWeeks[0]?.id
              const isActiveWeek = currentWeek.id === activeWeekId2
              return (
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
                  <div style={{ ...st.infoCard, ...(isCurrentPastWeek ? { borderColor: 'rgba(201,168,76,0.35)', borderLeftColor: 'rgba(201,168,76,0.35)', background: 'rgba(22,42,26,0.6)' } : {}) }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem', flexWrap: 'wrap' }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.3rem' }}>
                          {isActiveWeek
                            ? <span style={{ fontSize: '0.65rem', fontWeight: '700', letterSpacing: '0.1em', color: '#0a1a08', background: '#c9a84c', padding: '0.15rem 0.5rem', borderRadius: '999px' }}>ACTIVE</span>
                            : <span style={{ fontSize: '0.65rem', fontWeight: '700', letterSpacing: '0.1em', color: '#5a8a5a', background: 'rgba(0,0,0,0.3)', padding: '0.15rem 0.5rem', borderRadius: '999px' }}>ARCHIVED</span>
                          }
                        </div>
                        <div style={st.infoCardTitle}>Week {currentWeek.week_number} · {currentWeek.saturday_date}</div>
                        <div style={st.infoCardSub}>Picks deadline: {currentWeek.picks_deadline?.slice(11, 16) || '12:00'} · {races.length}/7 races</div>
                      </div>
                      {!isCurrentPastWeek && (
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                          <button style={st.btnSmallGhost} onClick={startEditWeek}>Edit</button>
                          <button style={st.btnSmallDanger} onClick={deleteRaceWeek}>Delete Week</button>
                        </div>
                      )}
                      {isCurrentPastWeek && (
                        <span style={{ fontSize: '0.72rem', color: '#5a8a5a', fontStyle: 'italic' }}>Past week — read only</span>
                      )}
                    </div>
                    <div style={st.progressBar}>
                      <div style={{ ...st.progressFill, width: `${(races.length / 7) * 100}%` }} />
                    </div>
                    <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
                      {[1,2,3,4,5,6,7].map(n => {
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

                {isCurrentPastWeek && (
                  <div style={{ background: 'rgba(90,138,90,0.06)', border: '1px solid rgba(90,138,90,0.2)', borderRadius: '8px', padding: '0.75rem 1rem', fontSize: '0.82rem', color: '#5a8a5a' }}>
                    📦 This is a past week. Race setup is locked. You can still view and edit results from the Results tab.
                  </div>
                )}

                {/* ── Combined import (race + runners) ── */}
                {!isCurrentPastWeek && (
                  <div style={{ marginBottom: '0.25rem' }}>
                    {/* Toggle button */}
                    <button
                      style={{
                        background: combinedImportOpen ? 'rgba(201,168,76,0.12)' : 'rgba(201,168,76,0.07)',
                        border: `1px solid ${combinedImportOpen ? '#c9a84c' : 'rgba(201,168,76,0.3)'}`,
                        borderRadius: '8px', padding: '0.6rem 1.1rem', cursor: 'pointer',
                        fontFamily: "'DM Sans', sans-serif", fontSize: '0.85rem', fontWeight: '600',
                        color: combinedImportOpen ? '#c9a84c' : '#a08040', display: 'flex', alignItems: 'center', gap: '0.5rem',
                      }}
                      onClick={() => { setCombinedImportOpen(o => !o); setCombinedImportResult(null) }}
                    >
                      <span style={{ fontSize: '1rem' }}>⬇</span>
                      {combinedImportOpen ? 'Close Import' : 'Import Race + Runners'}
                    </button>

                    {/* Panel */}
                    {combinedImportOpen && (
                      <div style={{ background: 'rgba(201,168,76,0.04)', border: '1px solid rgba(201,168,76,0.25)', borderRadius: '10px', padding: '1.25rem', marginTop: '0.75rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
                          <div style={{ fontSize: '0.72rem', fontWeight: '700', color: '#c9a84c', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                            Import Race + Runners
                          </div>
                          <button
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#5a8a5a', fontSize: '0.8rem', fontFamily: "'DM Sans', sans-serif", padding: 0 }}
                            onClick={() => setShowFormatGuide(g => !g)}
                          >
                            {showFormatGuide ? '▲ Hide format guide' : '▼ Show format guide'}
                          </button>
                        </div>

                        {/* Format guide */}
                        {showFormatGuide && (
                          <div style={{ background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(201,168,76,0.12)', borderRadius: '7px', padding: '0.9rem 1rem', marginBottom: '0.85rem', fontSize: '0.75rem', lineHeight: 1.7, color: '#7aaa7a' }}>
                            <div style={{ color: '#c9a84c', fontWeight: '700', marginBottom: '0.4rem', fontSize: '0.7rem', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Format</div>
                            <div style={{ color: '#e8f0e8', marginBottom: '0.25rem' }}>Top section — one field per line:</div>
                            <code style={{ display: 'block', fontFamily: 'monospace', color: '#7aaa7a', marginBottom: '0.6rem', whiteSpace: 'pre' }}>{`venue: York
time: 13:50
race_name: The Acomb Stakes
class: 2
distance: 7f
runners: 6`}</code>
                            <div style={{ color: '#e8f0e8', marginBottom: '0.25rem' }}>Blank line, then runners (one per line):</div>
                            <code style={{ display: 'block', fontFamily: 'monospace', color: '#7aaa7a', marginBottom: '0.6rem', whiteSpace: 'pre' }}>{`number, name, jockey, trainer, odds, primary_hex, secondary_hex, pattern`}</code>
                            <code style={{ display: 'block', fontFamily: 'monospace', color: '#4a7a4a', fontSize: '0.7rem', whiteSpace: 'pre' }}>{`1, Secret Force, T. Queally, Charlie Appleby, 9/4, #1a3a10, #e8f0e8, chevrons
2, Majestic Dawn, F. Dettori, J. Gosden, 3/1, #3a1a00, #c9a84c, plain`}</code>
                            <div style={{ color: '#5a8a5a', marginTop: '0.5rem', fontSize: '0.7rem' }}>
                              class, distance, secondary_hex, pattern are optional. Use TBA for unknown jockey or odds.
                            </div>
                          </div>
                        )}

                        {/* Textarea */}
                        <textarea
                          style={{
                            width: '100%', boxSizing: 'border-box',
                            background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(201,168,76,0.2)',
                            borderRadius: '6px', padding: '0.85rem', color: '#e8f0e8',
                            fontFamily: 'monospace', fontSize: '0.8rem', lineHeight: 1.7,
                            resize: 'vertical', minHeight: '300px', outline: 'none',
                          }}
                          placeholder={`venue: York\ntime: 13:50\nrace_name: The Acomb Stakes\nrunners: 6\n\n1, Secret Force, T. Queally, Charlie Appleby, 9/4, #1a3a10, #e8f0e8, chevrons\n2, Majestic Dawn, F. Dettori, J. Gosden, 3/1, #3a1a00, #c9a84c, plain`}
                          value={combinedImportText}
                          onChange={e => { setCombinedImportText(e.target.value); setCombinedImportResult(null) }}
                        />

                        {/* Result messages */}
                        {combinedImportResult && (
                          <div style={{ marginTop: '0.7rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                            {combinedImportResult.success && (
                              <div style={{ fontSize: '0.82rem', color: '#4ade80', background: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.25)', borderRadius: '6px', padding: '0.5rem 0.75rem', fontWeight: '600' }}>
                                ✓ {combinedImportResult.success}
                              </div>
                            )}
                            {combinedImportResult.errors.map((msg, i) => (
                              <div key={i} style={{ fontSize: '0.78rem', color: '#f87171', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '5px', padding: '0.4rem 0.65rem' }}>
                                ✕ {msg}
                              </div>
                            ))}
                            {combinedImportResult.warnings.map((msg, i) => (
                              <div key={i} style={{ fontSize: '0.78rem', color: '#fbbf24', background: 'rgba(251,191,36,0.07)', border: '1px solid rgba(251,191,36,0.2)', borderRadius: '5px', padding: '0.4rem 0.65rem' }}>
                                ⚠ {msg}
                              </div>
                            ))}
                          </div>
                        )}

                        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.9rem', alignItems: 'center' }}>
                          <button style={st.btnGold} onClick={bulkImportCombined} disabled={loading}>
                            {loading ? 'Importing…' : 'Import Race + Runners'}
                          </button>
                          <button style={st.btnGhost} onClick={() => { setCombinedImportOpen(false); setCombinedImportResult(null); setCombinedImportText('') }}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Race cards */}
                {[1,2,3,4,5,6,7].map(raceNum => {
                  const race        = races.find(r => r.race_number === raceNum)
                  const raceRunners = race ? (runners[race.id] || []) : []
                  const isExpanded  = expandedRaces.has(raceNum) || editingRace === race?.id || !!showRaceForm[raceNum]

                  const toggleExpand = () => setExpandedRaces(prev => {
                    const s = new Set(prev)
                    if (s.has(raceNum)) s.delete(raceNum); else s.add(raceNum)
                    return s
                  })

                  return (
                    <div key={raceNum} style={st.raceCard}>

                      {/* ── Always-visible header row ── */}
                      <div
                        style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.85rem 1.25rem', cursor: 'pointer', userSelect: 'none' }}
                        onClick={toggleExpand}
                      >
                        <span style={st.raceCardNum}>Race {raceNum}</span>
                        {race ? (
                          <span style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.875rem', minWidth: 0, overflow: 'hidden' }}>
                            <strong style={{ color: '#e8f0e8', whiteSpace: 'nowrap', fontWeight: '700' }}>{race.race_time}</strong>
                            <span style={{ color: 'rgba(232,240,232,0.2)' }}>·</span>
                            <span style={{ color: '#c9a84c', whiteSpace: 'nowrap' }}>{race.venue}</span>
                            <span style={{ color: 'rgba(232,240,232,0.2)' }}>·</span>
                            <span style={{ color: '#5a8a5a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{race.race_name}</span>
                          </span>
                        ) : (
                          <span style={{ flex: 1, fontSize: '0.82rem', color: '#2a4a2a', fontStyle: 'italic' }}>empty</span>
                        )}
                        {race && (
                          <span style={{ fontSize: '0.75rem', color: '#3a5a3a', whiteSpace: 'nowrap', flexShrink: 0 }}>
                            {raceRunners.length} runner{raceRunners.length !== 1 ? 's' : ''}
                          </span>
                        )}
                        {isExpanded
                          ? <ChevronUp   size={16} color="#c9a84c" style={{ flexShrink: 0 }} />
                          : <ChevronDown size={16} color="#c9a84c" style={{ flexShrink: 0 }} />
                        }
                      </div>

                      {/* ── Collapsible body ── */}
                      <div style={{ maxHeight: isExpanded ? '4000px' : '0', overflow: 'hidden', transition: 'max-height 200ms ease' }}>

                      {/* Edit race form */}
                      {race && editingRace === race.id && (
                        <div style={st.raceCardBody}>
                          <div style={st.formGrid} className="app-grid-2">
                            <div style={st.formField}>
                              <label style={st.label}>Race Number</label>
                              <input style={st.input} type="number" min="1" max="7"
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

                      {/* Edit / Delete actions — race exists, not editing */}
                      {race && editingRace !== race.id && !isCurrentPastWeek && (
                        <div style={{ display: 'flex', gap: '0.4rem', padding: '0 1.25rem 0.6rem' }}>
                          <button style={st.btnSmallGhost} onClick={e => { e.stopPropagation(); startEditRace(race) }}>Edit</button>
                          <button style={st.btnSmallDanger} onClick={e => { e.stopPropagation(); deleteRace(race) }}>Delete</button>
                        </div>
                      )}

                      {/* New race form */}
                      {!race && showRaceForm[raceNum] && !isCurrentPastWeek && (
                        <div style={st.raceCardBody}>
                          <div style={st.formGrid} className="app-grid-2">
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
                          <div style={{ display: 'flex', gap: '0.6rem', marginTop: '0.85rem' }}>
                            <button style={st.btnGold} onClick={() => saveRace(raceNum)} disabled={loading}>Save Race</button>
                            <button style={st.btnGhost} onClick={() => setShowRaceForm(p => ({ ...p, [raceNum]: false }))}>Cancel</button>
                          </div>
                        </div>
                      )}

                      {/* Add race button — empty slot, not past week */}
                      {!race && !showRaceForm[raceNum] && !isCurrentPastWeek && (
                        <div style={{ padding: '0.1rem 1.25rem 0.9rem' }}>
                          <button style={st.btnSmall} onClick={e => { e.stopPropagation(); setShowRaceForm(p => ({ ...p, [raceNum]: true })) }}>
                            + Add Race
                          </button>
                        </div>
                      )}

                      {/* Runners */}
                      {race && editingRace !== race.id && (
                        <div style={st.runnersSection}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.1rem' }}>
                            <div style={st.runnersLabel}>Runners ({raceRunners.length})</div>
                            <button
                              type="button"
                              style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", fontSize: '0.72rem', color: bulkImportOpen.has(race.id) ? '#c9a84c' : '#4a6a4a', textDecoration: 'underline', padding: 0 }}
                              onClick={e => { e.stopPropagation(); toggleBulkImport(race.id) }}
                            >
                              {bulkImportOpen.has(race.id) ? '✕ close runner-only import' : 'runner-only import'}
                            </button>
                          </div>

                          {/* Runner cards */}
                          {raceRunners.map(runner => (
                            <div key={runner.id} style={st.runnerCard}>
                              {editingRunner === runner.id ? (
                                /* ── Inline edit form ── */
                                <div style={{ padding: '0.85rem 1rem' }}>
                                  <div style={{ fontSize: '0.7rem', fontWeight: '700', color: '#c9a84c', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '0.75rem' }}>Editing Runner</div>
                                  <div style={st.runnerFormGrid} className="admin-runner-grid">
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
                                    <div style={{ ...st.formField, gridColumn: 'span 2' }}>
                                      <label style={st.label}>Opening Odds</label>
                                      <input style={st.input} placeholder="e.g. 7/1, Evens"
                                        value={editRunnerForm.odds}
                                        onChange={e => setEditRunnerForm(f => ({ ...f, odds: e.target.value }))} />
                                    </div>
                                    <div style={{ ...st.formField, gridColumn: 'span 4' }}>
                                      <label style={st.label}>Form</label>
                                      <input style={st.input} placeholder="e.g. 322-42"
                                        value={editRunnerForm.form || ''}
                                        onChange={e => setEditRunnerForm(f => ({ ...f, form: e.target.value }))} />
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
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    <RunnerCard runner={runner} />
                                  </div>
                                  <div style={{ display: 'flex', gap: '0.4rem', flexShrink: 0 }}>
                                    {!runner.is_withdrawn && (
                                      <button style={st.btnSmallGhost} onClick={() => startEditRunner(runner)}>Edit</button>
                                    )}
                                    {runner.is_withdrawn ? (
                                      <button style={{ ...st.btnSmallGhost, color: '#4ade80', borderColor: 'rgba(74,222,128,0.35)' }} onClick={() => reinstateRunner(runner, race.id)}>Reinstate</button>
                                    ) : (
                                      <button style={{ ...st.btnSmallGhost, color: '#fbbf24', borderColor: 'rgba(251,191,36,0.35)' }} onClick={() => withdrawRunner(runner, race.id)}>Withdraw</button>
                                    )}
                                    <button style={st.btnSmallDanger} onClick={() => removeRunner(race.id, runner.id)}>Delete</button>
                                  </div>
                                </div>
                              )}
                            </div>
                          ))}

                          {/* Add runner form — hidden for past weeks */}
                          {!isCurrentPastWeek && <div style={st.addRunnerCard}>
                            <div style={{ fontSize: '0.7rem', fontWeight: '700', color: '#5a8a5a', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '0.75rem' }}>Add Runner</div>
                            <div style={st.runnerFormGrid} className="admin-runner-grid">
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
                              <div style={{ ...st.formField, gridColumn: 'span 2' }}>
                                <label style={st.label}>Opening Odds</label>
                                <input style={st.input} placeholder="e.g. 7/1, Evens"
                                  value={nrf(race.id).odds}
                                  onChange={e => setNrf(race.id, { odds: e.target.value })} />
                              </div>
                              <div style={{ ...st.formField, gridColumn: 'span 4' }}>
                                <label style={st.label}>Form</label>
                                <input style={st.input} placeholder="e.g. 322-42"
                                  value={nrf(race.id).form || ''}
                                  onChange={e => setNrf(race.id, { form: e.target.value })} />
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
                          </div>}

                          {/* ── Bulk import panel ── */}
                          {bulkImportOpen.has(race.id) && (
                            <div style={{ background: 'rgba(201,168,76,0.04)', border: '1px solid rgba(201,168,76,0.25)', borderRadius: '8px', padding: '1rem', marginTop: '0.25rem' }}>
                              <div style={{ fontSize: '0.7rem', fontWeight: '700', color: '#c9a84c', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '0.5rem' }}>
                                Bulk Import Runners
                              </div>
                              <div style={{ fontSize: '0.75rem', color: '#5a8a5a', marginBottom: '0.65rem', lineHeight: 1.5 }}>
                                One runner per line in this format:<br />
                                <span style={{ color: '#7aaa7a', fontFamily: 'monospace' }}>number, horse_name, jockey, trainer, odds, #hex_colour, form_string</span><br />
                                <span style={{ color: '#4a6a4a', fontFamily: 'monospace', fontSize: '0.7rem' }}>e.g. 7, Recency Bias, Jack Nicholls, K R Burke, 11/2, #1a3a10, 9017-9</span><br />
                                <span style={{ color: '#4a6a4a', fontSize: '0.7rem' }}>Form string is optional — omit if not available.</span>
                              </div>

                              <textarea
                                style={{
                                  width: '100%', boxSizing: 'border-box',
                                  background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(201,168,76,0.2)',
                                  borderRadius: '6px', padding: '0.75rem', color: '#e8f0e8',
                                  fontFamily: 'monospace', fontSize: '0.8rem', lineHeight: 1.6,
                                  resize: 'vertical', minHeight: '130px', outline: 'none',
                                }}
                                placeholder={`1, Horse Name, Jockey Name, Trainer Name, 7/1, #1a3a10, 322-42\n2, Another Horse, A. Jockey, G. Trainer, 11/4, #2a4a20, 1-2113\n3, Third Horse, B. Rider, H. Handler, Evens, #3a2a10`}
                                value={bulkImportText[race.id] || ''}
                                onChange={e => setBulkImportText(p => ({ ...p, [race.id]: e.target.value }))}
                              />

                              {/* Errors / warnings */}
                              {bulkImportResult[race.id] && (
                                <div style={{ marginTop: '0.6rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                                  {bulkImportResult[race.id].errors.map((msg, i) => (
                                    <div key={i} style={{ fontSize: '0.78rem', color: '#f87171', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '5px', padding: '0.4rem 0.65rem' }}>
                                      ✕ {msg}
                                    </div>
                                  ))}
                                  {bulkImportResult[race.id].warnings.map((msg, i) => (
                                    <div key={i} style={{ fontSize: '0.78rem', color: '#fbbf24', background: 'rgba(251,191,36,0.07)', border: '1px solid rgba(251,191,36,0.2)', borderRadius: '5px', padding: '0.4rem 0.65rem' }}>
                                      ⚠ {msg}
                                    </div>
                                  ))}
                                </div>
                              )}

                              <div style={{ display: 'flex', gap: '0.65rem', marginTop: '0.75rem' }}>
                                <button style={st.btnGold} onClick={() => bulkImportRunners(race.id)} disabled={loading}>
                                  {loading ? 'Importing…' : 'Import Runners'}
                                </button>
                                <button style={st.btnGhost} onClick={() => toggleBulkImport(race.id)}>Cancel</button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                      </div>{/* end collapsible body */}
                    </div>
                  )
                })}
              </>
              )
            })()}
          </div>
        )}

        {/* ══════════════ RESULTS ══════════════ */}
        {activeTab === 'results' && (() => {
          const todayStr     = new Date().toISOString().split('T')[0]
          const activeWId    = getActiveWeekId(allResultWeeks.map(w => w.week))

          function weekStatus(week, raceList) {
            if (week.id === activeWId) return 'ACTIVE'
            if (!raceList.length) return 'PENDING'
            const allDone = raceList.every(r => (raceResults[r.id] || []).length > 0)
            return allDone ? 'COMPLETED' : 'PENDING'
          }

          function toggleResultWeek(weekId) {
            setExpandedResultWeeks(prev => {
              const s = new Set(prev)
              if (s.has(weekId)) s.delete(weekId); else s.add(weekId)
              return s
            })
          }

          return (
            <div style={st.section}>
              <div style={st.sectionHeader}>
                <h2 style={st.sectionTitle}>Enter Results</h2>
                <div style={{ display: 'flex', gap: '0.65rem', alignItems: 'center', marginLeft: 'auto' }}>
                  <button
                    style={{ ...st.btnSmallGhost }}
                    onClick={() => { setResultWeeksLoaded(false) }}
                    disabled={loading}
                    title="Reload all weeks"
                  >
                    ↻ Refresh
                  </button>
                  <button
                    style={{ ...st.btnSmall, background: 'rgba(201,168,76,0.15)', border: '1px solid rgba(201,168,76,0.4)' }}
                    onClick={recalculateAllScores}
                    disabled={loading}
                    title="Re-scores all races that already have results entered — use this if scores are missing"
                  >
                    ⟳ Recalculate All Scores
                  </button>
                </div>
              </div>

              {!activeSeason && <div style={st.warningCard}>No active season.</div>}
              {activeSeason && loading && allResultWeeks.length === 0 && (
                <div style={{ color: '#5a8a5a', fontSize: '0.85rem', padding: '1rem 0' }}>Loading weeks…</div>
              )}
              {activeSeason && !loading && allResultWeeks.length === 0 && (
                <div style={st.warningCard}>No race weeks found — create one in "This Week" first.</div>
              )}

              {allResultWeeks.map(({ week, races: weekRaces }) => {
                const isExpanded = expandedResultWeeks.has(week.id)
                const status     = weekStatus(week, weekRaces)

                const statusStyle = status === 'ACTIVE'
                  ? { background: 'rgba(201,168,76,0.15)', border: '1px solid #c9a84c', color: '#c9a84c' }
                  : status === 'COMPLETED'
                  ? { background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.35)', color: '#4ade80' }
                  : { background: 'rgba(90,138,90,0.08)', border: '1px solid rgba(90,138,90,0.2)', color: '#3a5a3a' }

                return (
                  <div key={week.id} style={{ background: 'linear-gradient(180deg, #152e12 0%, #0a1a08 100%)', border: '1px solid rgba(201,168,76,0.2)', borderRadius: '10px', overflow: 'hidden', marginBottom: '0.5rem' }}>

                    {/* Week header */}
                    <div
                      onClick={() => toggleResultWeek(week.id)}
                      style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '16px 20px', cursor: 'pointer', userSelect: 'none' }}
                    >
                      <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.05rem', color: '#e8f0e8', letterSpacing: '0.06em', flex: 1 }}>
                        Week {week.week_number} · {week.saturday_date}
                      </span>
                      <span style={{ fontSize: '0.67rem', fontWeight: '700', letterSpacing: '0.08em', textTransform: 'uppercase', padding: '0.2rem 0.6rem', borderRadius: '6px', whiteSpace: 'nowrap', ...statusStyle }}>
                        {status}
                      </span>
                      {isExpanded
                        ? <ChevronUp   size={16} color="#c9a84c" style={{ flexShrink: 0 }} />
                        : <ChevronDown size={16} color="#c9a84c" style={{ flexShrink: 0 }} />
                      }
                    </div>

                    {/* Collapsible body */}
                    <div style={{ maxHeight: isExpanded ? '12000px' : '0', overflow: 'hidden', transition: 'max-height 200ms ease' }}>
                      <div style={{ padding: '0 0.75rem 0.75rem' }}>

                        {weekRaces.length === 0 && (
                          <div style={{ ...st.warningCard, margin: '0 0 0.5rem' }}>No races set up for this week.</div>
                        )}

                        {weekRaces.map(race => {
                          const raceRunners   = runners[race.id] || []
                          const existingRes   = raceResults[race.id] || []
                          const isSubmitted   = existingRes.length > 0
                          const isUnlocked    = unlockedResults.has(race.id)
                          const form          = resultForms[race.id] || {}
                          const isRaceExpanded = expandedResultRaces.has(race.id)

                          const toggleRace = () => setExpandedResultRaces(prev => {
                            const s = new Set(prev)
                            if (s.has(race.id)) s.delete(race.id); else s.add(race.id)
                            return s
                          })

                          return (
                            <div key={race.id} style={{ ...st.raceCard, ...(isSubmitted && !isUnlocked ? st.raceCardDone : {}), marginBottom: '0.5rem' }}>
                              <div style={{ ...st.raceCardHead, cursor: 'pointer', userSelect: 'none' }} onClick={toggleRace}>
                                <span style={st.raceCardNum}>Race {race.race_number}</span>
                                <span style={st.raceCardMeta}>
                                  <strong style={{ color: '#e8f0e8' }}>{race.race_time}</strong>
                                  {' · '}<span style={{ color: '#c9a84c' }}>{race.venue}</span>
                                  {' · '}<span style={{ color: '#5a8a5a' }}>{race.race_name}</span>
                                </span>
                                {isSubmitted && !isUnlocked && <span style={{ ...st.badgeDone, marginLeft: 'auto' }}>✓ Results in</span>}
                                {isUnlocked && <span style={{ ...st.badgeDone, background: 'rgba(251,191,36,0.12)', color: '#fbbf24', marginLeft: 'auto' }}>Editing…</span>}
                                {isRaceExpanded
                                  ? <ChevronUp   size={14} color="#c9a84c" style={{ flexShrink: 0 }} />
                                  : <ChevronDown size={14} color="#c9a84c" style={{ flexShrink: 0 }} />
                                }
                              </div>

                              {/* Collapsible body */}
                              <div style={{ maxHeight: isRaceExpanded ? '2000px' : '0', overflow: 'hidden', transition: 'max-height 200ms ease' }}>

                                {/* Show locked results */}
                                {isSubmitted && !isUnlocked && (
                                  <div style={st.raceCardBody}>
                                    {existingRes.map(r => (
                                      <div key={r.id} style={st.resultRow}>
                                        <span style={{ ...st.posBadge, background: r.position === 1 ? '#c9a84c' : r.position === 2 ? '#9ca3af' : '#b87333' }}>
                                          {r.position === 1 ? '1st' : r.position === 2 ? '2nd' : '3rd'}
                                        </span>
                                        <span style={{ color: '#e8f0e8', fontWeight: '500' }}>{r.horse_name}</span>
                                        {r.starting_price_display && (
                                          <span style={{ color: '#c9a84c', marginLeft: 'auto', fontSize: '0.85rem' }}>
                                            Opening: {r.starting_price_display}
                                          </span>
                                        )}
                                      </div>
                                    ))}
                                    <div style={{ marginTop: '0.65rem' }}>
                                      <button style={st.btnSmallGhost} onClick={e => { e.stopPropagation(); unlockResults(race) }}>
                                        ✎ Edit Results
                                      </button>
                                    </div>
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
                                          const hKey  = `horse${pos}`
                                          const label = pos === 1 ? '1st' : pos === 2 ? '2nd' : '3rd'
                                          const bg    = pos === 1 ? '#c9a84c' : pos === 2 ? '#9ca3af' : '#b87333'
                                          return (
                                            <div key={pos} style={st.resultInputRow}>
                                              <span style={{ ...st.posBadge, background: bg, minWidth: '44px' }}>{label}</span>
                                              <select style={{ ...st.input, flex: 1 }} value={form[hKey] || ''}
                                                onChange={e => setResultForms(p => ({ ...p, [race.id]: { ...p[race.id], [hKey]: e.target.value } }))}>
                                                <option value="">Select horse…</option>
                                                {raceRunners.map(r => (
                                                  <option key={r.id} value={r.horse_name}>
                                                    {r.horse_name}{r.odds_fractional ? ` (${r.odds_fractional})` : ''}
                                                  </option>
                                                ))}
                                              </select>
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

                              </div>{/* end collapsible body */}
                            </div>
                          )
                        })}
                      </div>
                    </div>

                  </div>
                )
              })}
            </div>
          )
        })()}

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

        {/* ══════════════ FESTIVALS ══════════════ */}
        {activeTab === 'festivals' && (
          <div style={st.section}>
            <div style={st.sectionHeader}>
              <h2 style={st.sectionTitle}>Festival Management</h2>
              <button style={st.btnGold} onClick={() => setShowFestivalForm(v => !v)}>
                {showFestivalForm ? 'Cancel' : '+ New Festival'}
              </button>
            </div>

            {/* Create festival form */}
            {showFestivalForm && (
              <form onSubmit={createFestival} style={st.formCard}>
                <div style={st.formTitle}>CREATE NEW FESTIVAL</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                  <div style={st.formField}>
                    <label style={st.label}>Internal Name *</label>
                    <input style={st.input} placeholder="cheltenham-2026" value={festivalForm.name}
                      onChange={e => setFestivalForm({ ...festivalForm, name: e.target.value })} required />
                  </div>
                  <div style={st.formField}>
                    <label style={st.label}>Display Name</label>
                    <input style={st.input} placeholder="Cheltenham Festival 2026" value={festivalForm.displayName}
                      onChange={e => setFestivalForm({ ...festivalForm, displayName: e.target.value })} />
                  </div>
                  <div style={st.formField}>
                    <label style={st.label}>Start Date *</label>
                    <input style={st.input} type="date" value={festivalForm.startDate}
                      onChange={e => setFestivalForm({ ...festivalForm, startDate: e.target.value })} required />
                  </div>
                  <div style={st.formField}>
                    <label style={st.label}>End Date *</label>
                    <input style={st.input} type="date" value={festivalForm.endDate}
                      onChange={e => setFestivalForm({ ...festivalForm, endDate: e.target.value })} required />
                  </div>
                  <div style={st.formField}>
                    <label style={st.label}>Banner Colour</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <input style={{ ...st.input, width: '80px', padding: '0.35rem' }} type="color"
                        value={festivalForm.bannerColour}
                        onChange={e => setFestivalForm({ ...festivalForm, bannerColour: e.target.value })} />
                      <span style={{ fontSize: '0.8rem', color: '#5a8a5a' }}>{festivalForm.bannerColour}</span>
                    </div>
                  </div>
                </div>
                {/* Saturday warning */}
                {(() => {
                  if (!festivalForm.startDate || !festivalForm.endDate) return null
                  const start = new Date(festivalForm.startDate + 'T12:00:00')
                  const end   = new Date(festivalForm.endDate   + 'T12:00:00')
                  const satDays = []
                  let cur = new Date(start); let num = 1
                  while (cur <= end) {
                    if (cur.getDay() === 6) satDays.push(`Day ${num} (${cur.toLocaleDateString('en-GB', { weekday:'long', day:'numeric', month:'short' })})`)
                    cur.setDate(cur.getDate() + 1); num++
                  }
                  if (!satDays.length) return null
                  return (
                    <div style={{ background: 'rgba(201,168,76,0.08)', border: '1px solid rgba(201,168,76,0.4)', borderLeft: '4px solid #c9a84c', borderRadius: '7px', padding: '0.85rem 1rem', marginTop: '0.5rem', fontSize: '0.82rem', color: '#c9a84c', lineHeight: 1.5 }}>
                      ⚠ <strong>Saturday clash:</strong> {satDays.join(', ')} fall{satDays.length === 1 ? 's' : ''} on a Saturday — this is also a regular league race day. Players will need to make separate picks for both.
                    </div>
                  )
                })()}
                <div style={st.formActions}>
                  <button style={st.btnGold} type="submit" disabled={loading}>Create Festival</button>
                </div>
              </form>
            )}

            {/* Festival selector */}
            {festivals.length === 0 && !showFestivalForm && (
              <div style={st.warningCard}>No festivals yet — create one above.</div>
            )}
            {festivals.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                {festivals.map(f => (
                  <button key={f.id}
                    style={{ ...st.tabBtn, borderBottom: '3px solid', borderBottomColor: f.id === selectedFestival?.id ? '#c9a84c' : 'transparent', color: f.id === selectedFestival?.id ? '#c9a84c' : '#5a8a5a', padding: '0.6rem 1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                    onClick={() => selectFestivalById(f)}>
                    {f.display_name || f.name}
                    {f.is_active && <span style={{ fontSize: '0.6rem', fontWeight: '700', letterSpacing: '0.08em', color: '#4ade80', background: 'rgba(74,222,128,0.1)', padding: '0.1rem 0.4rem', borderRadius: '3px' }}>ACTIVE</span>}
                  </button>
                ))}
              </div>
            )}

            {/* Selected festival panel */}
            {selectedFestival && (() => {
              const isEditing = editingFestival === selectedFestival.id
              return (
                <>
                  {/* Festival info / edit card */}
                  {isEditing ? (
                    <div style={st.formCard}>
                      <div style={st.formTitle}>EDIT FESTIVAL</div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                        <div style={st.formField}>
                          <label style={st.label}>Internal Name</label>
                          <input style={st.input} value={editFestivalForm.name || ''}
                            onChange={e => setEditFestivalForm({ ...editFestivalForm, name: e.target.value })} />
                        </div>
                        <div style={st.formField}>
                          <label style={st.label}>Display Name</label>
                          <input style={st.input} value={editFestivalForm.displayName || ''}
                            onChange={e => setEditFestivalForm({ ...editFestivalForm, displayName: e.target.value })} />
                        </div>
                        <div style={st.formField}>
                          <label style={st.label}>Start Date</label>
                          <input style={st.input} type="date" value={editFestivalForm.startDate || ''}
                            onChange={e => setEditFestivalForm({ ...editFestivalForm, startDate: e.target.value })} />
                        </div>
                        <div style={st.formField}>
                          <label style={st.label}>End Date</label>
                          <input style={st.input} type="date" value={editFestivalForm.endDate || ''}
                            onChange={e => setEditFestivalForm({ ...editFestivalForm, endDate: e.target.value })} />
                        </div>
                        <div style={st.formField}>
                          <label style={st.label}>Banner Colour</label>
                          <input style={{ ...st.input, width: '80px', padding: '0.35rem' }} type="color"
                            value={editFestivalForm.bannerColour || '#c9a84c'}
                            onChange={e => setEditFestivalForm({ ...editFestivalForm, bannerColour: e.target.value })} />
                        </div>
                      </div>
                      <div style={st.formActions}>
                        <button style={st.btnGold} onClick={() => saveFestivalEdit(selectedFestival.id)} disabled={loading}>Save</button>
                        <button style={st.btnGhost} onClick={() => setEditingFestival(null)}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div style={st.infoCard}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                            <div style={st.infoCardBadge}>Festival</div>
                            {selectedFestival.is_active && <span style={{ ...st.infoCardBadge, color: '#4ade80' }}>● ACTIVE</span>}
                          </div>
                          <div style={st.infoCardTitle}>{selectedFestival.display_name || selectedFestival.name}</div>
                          <div style={st.infoCardSub}>{selectedFestival.start_date} → {selectedFestival.end_date}</div>
                        </div>
                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                          {!selectedFestival.is_active
                            ? <button style={st.btnSmall} onClick={() => activateFestival(selectedFestival.id)}>Set Active</button>
                            : <button style={st.btnSmallGhost} onClick={() => deactivateFestival(selectedFestival.id)}>Deactivate</button>
                          }
                          <button style={st.btnSmall} onClick={() => { setEditingFestival(selectedFestival.id); setEditFestivalForm({ name: selectedFestival.name, displayName: selectedFestival.display_name || '', bannerColour: selectedFestival.banner_colour || '#c9a84c', startDate: selectedFestival.start_date, endDate: selectedFestival.end_date }) }}>Edit</button>
                          <button style={st.btnSmall} onClick={() => generateFestivalDays(selectedFestival)} disabled={loading}>↻ Regenerate Days</button>
                          <button style={st.btnSmallDanger} onClick={() => deleteFestivalFn(selectedFestival.id)}>Delete</button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Day tabs */}
                  {festivalDays.length === 0 ? (
                    <div style={st.warningCard}>No days generated yet. Click "Regenerate Days" above to auto-generate from the date range.</div>
                  ) : (
                    <>
                      <div style={{ background: '#0d1f0d', borderRadius: '8px', padding: '0.5rem 0.75rem', display: 'flex', gap: '0.35rem', flexWrap: 'wrap', border: '1px solid rgba(201,168,76,0.1)' }}>
                        {festivalDays.map(day => {
                          // Always derive date from festival start_date so it's never stale
                          const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
                          const d = new Date(selectedFestival.start_date + 'T12:00:00')
                          d.setDate(d.getDate() + (day.day_number - 1))
                          const isSat = d.getDay() === 6
                          const tabLabel = `Day ${day.day_number} — ${DAY_NAMES[d.getDay()]}`
                          return (
                            <button key={day.id}
                              style={{ ...st.tabBtn, padding: '0.45rem 0.85rem', fontSize: '0.78rem', borderBottom: '2px solid', borderBottomColor: day.id === selectedDay?.id ? '#c9a84c' : 'transparent', color: day.id === selectedDay?.id ? '#c9a84c' : '#5a8a5a' }}
                              onClick={() => selectFestivalDay(day)}>
                              {tabLabel}
                              {isSat && <span title="Saturday — regular race day also" style={{ marginLeft: '4px', color: '#c9a84c', fontSize: '0.7em' }}>⚠</span>}
                            </button>
                          )
                        })}
                      </div>

                      {/* Selected day content */}
                      {selectedDay && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
                            {(() => {
                              const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
                              const d = new Date(selectedFestival.start_date + 'T12:00:00')
                              d.setDate(d.getDate() + (selectedDay.day_number - 1))
                              const dateStr = d.toISOString().split('T')[0]
                              const dayName = DAY_NAMES[d.getDay()]
                              const deadlineStr = selectedDay.picks_deadline
                                ? new Date(selectedDay.picks_deadline).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
                                : 'N/A'
                              return (
                                <span style={{ fontSize: '0.85rem', color: '#5a8a5a' }}>
                                  {`Day ${selectedDay.day_number} — ${dayName} · ${dateStr} · Deadline: ${deadlineStr}`}
                                </span>
                              )
                            })()}
                            {/* Bulk import races button — day level */}
                            {(() => {
                              const dayBulkOpen = festivalCombinedBulkOpen.has(selectedDay.id)
                              return (
                                <button
                                  style={{ ...st.btnSmall, borderColor: dayBulkOpen ? '#c9a84c' : undefined, color: dayBulkOpen ? '#c9a84c' : undefined }}
                                  onClick={() => setFestivalCombinedBulkOpen(prev => { const s = new Set(prev); dayBulkOpen ? s.delete(selectedDay.id) : s.add(selectedDay.id); return s })}>
                                  {dayBulkOpen ? '✕ Close Import' : '⬇ Bulk Import Races'}
                                </button>
                              )
                            })()}
                          </div>

                          {/* Festival combined bulk import panel */}
                          {festivalCombinedBulkOpen.has(selectedDay.id) && (
                            <div style={{ background: '#0d1f0d', border: '1px solid rgba(201,168,76,0.15)', borderRadius: '10px', padding: '1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                              <div style={{ fontSize: '0.78rem', fontWeight: '700', color: '#c9a84c', letterSpacing: '0.07em', textTransform: 'uppercase' }}>Bulk Import Race + Runners</div>
                              <div style={{ fontSize: '0.72rem', color: '#5a8a5a', lineHeight: 1.6 }}>
                                Paste one race block — header fields then a blank line then runners:<br />
                                <code style={{ color: '#e8f0e8', fontSize: '0.7rem' }}>venue: Cheltenham</code><br />
                                <code style={{ color: '#e8f0e8', fontSize: '0.7rem' }}>time: 14:00</code><br />
                                <code style={{ color: '#e8f0e8', fontSize: '0.7rem' }}>race_name: Gold Cup</code><br />
                                <code style={{ color: '#5a8a5a', fontSize: '0.7rem' }}>(blank line)</code><br />
                                <code style={{ color: '#e8f0e8', fontSize: '0.7rem' }}>1, Horse Name, Jockey, Trainer, 7/2, #1a3a7a, #ffffff</code>
                              </div>
                              <textarea
                                style={{ ...st.input, width: '100%', minHeight: '160px', fontFamily: 'monospace', fontSize: '0.78rem', resize: 'vertical', boxSizing: 'border-box' }}
                                value={festivalCombinedBulkText[selectedDay.id] || ''}
                                onChange={e => setFestivalCombinedBulkText(p => ({ ...p, [selectedDay.id]: e.target.value }))}
                                placeholder={"venue: Cheltenham\ntime: 14:00\nrace_name: Gold Cup\nrunners: 8\n\n1, Corach Rambler, D. Skelton, H. Skelton, 7/2, #1a3a7a, #ffffff\n2, Galopin Des Champs, W. Mullins, P. Townend, 2/1, #5a1010, #ffffff"}
                              />
                              {festivalCombinedBulkResult[selectedDay.id] && (
                                <div>
                                  {festivalCombinedBulkResult[selectedDay.id].success && (
                                    <div style={{ fontSize: '0.78rem', color: '#4ade80', marginBottom: '0.3rem' }}>
                                      ✓ {festivalCombinedBulkResult[selectedDay.id].success}
                                    </div>
                                  )}
                                  {festivalCombinedBulkResult[selectedDay.id].errors.map((msg, i) => (
                                    <div key={i} style={{ fontSize: '0.75rem', color: '#f87171' }}>✗ {msg}</div>
                                  ))}
                                  {festivalCombinedBulkResult[selectedDay.id].warnings.map((msg, i) => (
                                    <div key={i} style={{ fontSize: '0.75rem', color: '#c9a84c' }}>⚠ {msg}</div>
                                  ))}
                                </div>
                              )}
                              <div style={{ display: 'flex', gap: '0.5rem' }}>
                                <button style={st.btnGold} onClick={() => bulkImportFestivalCombined(selectedDay.id)} disabled={loading}>
                                  Import Race
                                </button>
                                <button style={st.btnGhost} onClick={() => {
                                  setFestivalCombinedBulkOpen(prev => { const s = new Set(prev); s.delete(selectedDay.id); return s })
                                  setFestivalCombinedBulkResult(p => { const n = { ...p }; delete n[selectedDay.id]; return n })
                                  setFestivalCombinedBulkText(p => { const n = { ...p }; delete n[selectedDay.id]; return n })
                                }}>Clear</button>
                              </div>
                            </div>
                          )}

                          {/* Race cards */}
                          {[1,2,3,4,5,6,7].map(raceNum => {
                            const race      = festivalRaces.find(r => r.race_number === raceNum)
                            const raceKey   = `${selectedDay.id}_${raceNum}`
                            const isOpen    = showFestivalRaceForm[raceKey]
                            const rForm     = festivalRaceForms[raceKey] || {}
                            const rRunners  = race ? (festivalRunners[race.id] || []) : []
                            const rResults  = race ? (festivalResults[race.id] || []) : []
                            const hasDone   = rResults.length > 0
                            const bulkOpen  = race && festivalBulkOpen.has(race.id)
                            const isUnlocked = race && festivalUnlocked.has(race.id)
                            const resForm   = race ? (festivalResultForms[race.id] || {}) : {}

                            return (
                              <div key={raceNum} style={{ ...st.raceCard, ...(hasDone ? st.raceCardDone : {}) }}>
                                <div style={st.raceCardHead}>
                                  <span style={st.raceCardNum}>Race {raceNum}</span>
                                  {race ? (
                                    <>
                                      <span style={st.raceCardMeta}>
                                        <strong style={{ color: '#e8f0e8' }}>{race.race_time || '—'}</strong>
                                        {race.venue && <span style={{ color: '#c9a84c' }}> · {race.venue}</span>}
                                        {race.race_name && <span style={{ color: '#5a8a5a' }}> · {race.race_name}</span>}
                                      </span>
                                      <span style={{ fontSize: '0.75rem', color: rRunners.length > 0 ? '#4ade80' : '#5a8a5a' }}>{rRunners.length} runners</span>
                                      {hasDone && <span style={st.badgeDone}>✓ Results</span>}
                                      <button style={st.btnSmallGhost} onClick={() => { setShowFestivalRaceForm(p => ({...p, [raceKey]: !p[raceKey]})); if (!festivalRaceForms[raceKey]) setFestivalRaceForms(p => ({...p, [raceKey]: { raceTime: race.race_time||'', venue: race.venue||'', raceName: race.race_name||'' }})) }}>
                                        {isOpen ? '✕' : 'Edit'}
                                      </button>
                                      <button style={{ ...st.btnSmallGhost, borderColor: bulkOpen ? '#c9a84c' : undefined, color: bulkOpen ? '#c9a84c' : undefined }}
                                        onClick={() => setFestivalBulkOpen(prev => { const s = new Set(prev); bulkOpen ? s.delete(race.id) : s.add(race.id); return s })}>
                                        {bulkOpen ? '✕ Import' : '⬇ Bulk Import'}
                                      </button>
                                    </>
                                  ) : (
                                    <button style={st.btnSmall} onClick={() => { setShowFestivalRaceForm(p => ({...p, [raceKey]: true})); setFestivalRaceForms(p => ({...p, [raceKey]: { raceTime: '', venue: '', raceName: '' }})) }}>
                                      + Add Race
                                    </button>
                                  )}
                                </div>

                                {/* Race edit/create form */}
                                {isOpen && (
                                  <div style={{ padding: '0.85rem 1.25rem', borderTop: '1px solid rgba(201,168,76,0.08)', display: 'grid', gridTemplateColumns: 'auto 1fr 1fr 1fr', gap: '0.6rem', alignItems: 'end' }}>
                                    <div style={st.formField}>
                                      <label style={st.label}>Time</label>
                                      <input style={{ ...st.input, width: '80px' }} placeholder="14:00" value={rForm.raceTime || ''}
                                        onChange={e => setFestivalRaceForms(p => ({...p, [raceKey]: {...(p[raceKey]||{}), raceTime: e.target.value}}))} />
                                    </div>
                                    <div style={st.formField}>
                                      <label style={st.label}>Venue</label>
                                      <input style={st.input} placeholder="Cheltenham" value={rForm.venue || ''}
                                        onChange={e => setFestivalRaceForms(p => ({...p, [raceKey]: {...(p[raceKey]||{}), venue: e.target.value}}))} />
                                    </div>
                                    <div style={st.formField}>
                                      <label style={st.label}>Race Name</label>
                                      <input style={st.input} placeholder="Gold Cup" value={rForm.raceName || ''}
                                        onChange={e => setFestivalRaceForms(p => ({...p, [raceKey]: {...(p[raceKey]||{}), raceName: e.target.value}}))} />
                                    </div>
                                    <div style={{ display: 'flex', gap: '0.4rem' }}>
                                      <button style={st.btnGold} onClick={() => saveFestivalRace(selectedDay.id, raceNum)} disabled={loading}>Save</button>
                                      {race && <button style={st.btnSmallDanger} onClick={() => deleteFestivalRace(race.id, selectedDay.id)}>Del</button>}
                                    </div>
                                  </div>
                                )}

                                {/* Bulk import */}
                                {race && bulkOpen && (
                                  <div style={{ padding: '0.85rem 1.25rem', borderTop: '1px solid rgba(201,168,76,0.06)' }}>
                                    <div style={{ fontSize: '0.7rem', color: '#5a8a5a', marginBottom: '0.5rem' }}>Paste runners — one per line: <code style={{ color: '#c9a84c' }}>number, name, jockey, trainer, odds, #colour</code></div>
                                    <textarea style={{ ...st.input, width: '100%', minHeight: '120px', fontFamily: 'monospace', fontSize: '0.8rem', resize: 'vertical', boxSizing: 'border-box' }}
                                      value={festivalBulkText[race.id] || ''}
                                      onChange={e => setFestivalBulkText(p => ({...p, [race.id]: e.target.value}))}
                                      placeholder={"1, Corach Rambler, D. Skelton, H. Skelton, 7/2, #1a3a7a\n2, Galopin Des Champs, W. Mullins, P. Townend, 2/1, #5a1010"} />
                                    {festivalBulkResult[race.id] && (
                                      <div style={{ marginTop: '0.5rem' }}>
                                        {festivalBulkResult[race.id].errors.map((msg, i) => <div key={i} style={{ fontSize: '0.75rem', color: '#f87171' }}>✗ {msg}</div>)}
                                        {festivalBulkResult[race.id].warnings.map((msg, i) => <div key={i} style={{ fontSize: '0.75rem', color: '#c9a84c' }}>⚠ {msg}</div>)}
                                      </div>
                                    )}
                                    <button style={{ ...st.btnGold, marginTop: '0.65rem' }} onClick={() => bulkImportFestivalRunners(race.id)} disabled={loading}>Import Runners</button>
                                  </div>
                                )}

                                {/* Runners list */}
                                {race && rRunners.length > 0 && (
                                  <div style={st.runnersSection}>
                                    <div style={st.runnersLabel}>{rRunners.length} Runners</div>
                                    {rRunners.map(r => (
                                      <div key={r.id} style={st.runnerCard}>
                                        <div style={st.runnerCardRow}>
                                          <div style={st.runnerCardLeft}>
                                            {r.silk_colour && <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: r.silk_colour, border: '1px solid rgba(255,255,255,0.2)', flexShrink: 0 }} />}
                                            <span style={st.runnerNum}>{r.horse_number}</span>
                                            <span style={{ fontWeight: '600', fontSize: '0.875rem', color: '#e8f0e8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.horse_name}</span>
                                            {r.odds_fractional && <span style={{ fontSize: '0.72rem', color: '#c9a84c' }}>{r.odds_fractional}</span>}
                                          </div>
                                          <button style={st.btnSmallDanger} onClick={async () => { await supabase.from('festival_runners').delete().eq('id', r.id); loadFestivalRunners(race.id) }}>✕</button>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}

                                {/* Results */}
                                {race && (
                                  <div style={{ padding: '0.85rem 1.25rem', borderTop: '1px solid rgba(201,168,76,0.06)' }}>
                                    {!isUnlocked ? (
                                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                        {hasDone && (
                                          <div style={{ fontSize: '0.82rem', color: '#4ade80' }}>
                                            1st: {rResults.find(r=>r.position===1)?.horse_name} · 2nd: {rResults.find(r=>r.position===2)?.horse_name} · 3rd: {rResults.find(r=>r.position===3)?.horse_name}
                                          </div>
                                        )}
                                        <button style={st.btnSmall} onClick={() => unlockFestivalResults(race)}>
                                          {hasDone ? 'Edit Results' : 'Enter Results'}
                                        </button>
                                      </div>
                                    ) : (
                                      <div>
                                        <div style={{ fontSize: '0.7rem', fontWeight: '700', color: '#5a8a5a', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '0.6rem' }}>Enter Result</div>
                                        {[1,2,3].map(pos => (
                                          <div key={pos} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.5rem' }}>
                                            <div style={{ ...st.posBadge, background: pos===1?'#c9a84c':pos===2?'#9ca3af':'#b45309', width: '28px' }}>{pos===1?'1st':pos===2?'2nd':'3rd'}</div>
                                            <select style={{ ...st.input, flex: 1 }}
                                              value={resForm[`horse${pos}`] || ''}
                                              onChange={e => setFestivalResultForms(p => ({...p, [race.id]: {...(p[race.id]||{}), [`horse${pos}`]: e.target.value}}))}>
                                              <option value="">— Select horse —</option>
                                              {rRunners.map(r => <option key={r.id} value={r.horse_name}>{r.horse_number}. {r.horse_name}</option>)}
                                            </select>
                                          </div>
                                        ))}
                                        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.25rem' }}>
                                          <button style={st.btnGold} onClick={() => submitFestivalResults(race)} disabled={loading}>Save Results & Scores</button>
                                          <button style={st.btnGhost} onClick={() => setFestivalUnlocked(prev => { const s = new Set(prev); s.delete(race.id); return s })}>Cancel</button>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </>
                  )}
                </>
              )
            })()}
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
  tabBarWrap:  { background: '#0d1f0d', borderBottom: '1px solid rgba(201,168,76,0.1)', overflowX: 'auto', WebkitOverflowScrolling: 'touch' },
  tabBar:      { maxWidth: '1100px', margin: '0 auto', padding: '0 1.5rem', display: 'flex', minWidth: 'max-content' },
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
  main:        { maxWidth: '1100px', margin: '0 auto', padding: '2rem 1.5rem', boxSizing: 'border-box', width: '100%' },
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
  formGrid:    { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', width: '100%' },
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
  raceCard:    { background: 'linear-gradient(180deg, #152e12 0%, #0a1a08 100%)', border: '1px solid #c9a84c', borderLeft: '4px solid #c9a84c', borderRadius: '8px', overflow: 'hidden' },
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
  runnerFormGrid:  { display: 'grid', gridTemplateColumns: 'auto 1fr 1fr 1fr 1fr 1fr', gap: '0.6rem', alignItems: 'end', width: '100%' },
  addRunnerCard:   { background: 'rgba(201,168,76,0.03)', border: '1px dashed rgba(201,168,76,0.18)', borderRadius: '8px', padding: '0.85rem 1rem', marginTop: '0.25rem' },
  addRunnerRow:    { display: 'flex', gap: '0.5rem' },
  resultRow:   { display: 'flex', alignItems: 'center', gap: '0.85rem', padding: '0.3rem 0' },
  resultInputRow:{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' },
  posBadge:    { color: '#0a1a08', fontWeight: '700', fontSize: '0.75rem', padding: '0.25rem 0.5rem', borderRadius: '5px', textAlign: 'center', flexShrink: 0 },
}
