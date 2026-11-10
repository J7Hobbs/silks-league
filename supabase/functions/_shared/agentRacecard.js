// A racecard the agent has collected, from draft to live race day, and swapping one race for another.
//   racecardFlags / resolveSilks   pure: what needs a human look on the review screen
//   approveRacecard                creates the week if it does not exist, imports the races and runners (prices as approved,
//                                  owners, silks), then sends picks-open: the same createWeek / importRaces / sendPicksOpen
//                                  Admin already uses
//   rejectDraft / approveDraft     the other two review buttons
//   replaceRace                    before the lock, swap a race for a new one and tell the players who had picked in it
import { supabase } from './db.js'
import { DAY } from './dayBonuses.js'
import { KINDS, lockTimeText } from './raceDay.js'
import { isLocked, sendPicksOpen } from './adminToday.js'
import { createWeek, importRaces, loadDay } from './adminRaceDays.js'
import { syncWeekStatus } from './weekStatus.js'
import { APP_ORIGIN, raceReplaced, lockLabel } from './notifyCopy.js'
import { loadDayRaces, resolveDay, getOwnerSilks, saveOwnerSilks, updateDraft, logAgent } from './agentData.js'
import { approveOutcomes } from './agentApply.js'
import { isOddPrice, readPrice, MAX_WEEK_RACES } from './agentValidate.js'

const fail = error => ({ ok: false, error: error?.message || String(error) })
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

// ═══ Review (pure) ═══════════════════════════════════════════════════════

// The silks a runner will get: the ones the agent sent, else the owner's in the library, else none.
export function resolveSilks(runner, library = {}) {
  const own = runner.silks
  if (own && (own.colour || own.colour2 || own.pattern)) return { silk_colour: own.colour || null, silk_colour_secondary: own.colour2 || null, silk_pattern: own.pattern && own.pattern !== 'plain' ? own.pattern : null }
  const lib = runner.owner_id ? library[runner.owner_id] : null
  if (lib && (lib.silk_colour || lib.silk_colour_secondary || lib.silk_pattern)) return { silk_colour: lib.silk_colour || null, silk_colour_secondary: lib.silk_colour_secondary || null, silk_pattern: lib.silk_pattern || null }
  return { silk_colour: null, silk_colour_secondary: null, silk_pattern: null }
}

// What needs a look before approving, worked out from the draft as it stands now (so an edit, or silks just saved for an owner,
// clears its flag at once). severity: 'block' stops the approval, 'action' needs doing, 'warn' is worth a check.
//   payload  the racecard draft's payload        library  { owner_id: owner_silks row }
//   existingRaces  races the race day already has (approving would double them up)
export function racecardFlags(payload, { library = {}, existingRaces = 0 } = {}) {
  const flags = []
  const races = payload?.races || []
  if (existingRaces > 0) flags.push({ type: 'day_has_races', severity: 'block', message: `This race day already has ${plural(existingRaces, 'race')} loaded, so this racecard cannot be imported onto it. Reject it, or use Replace race on the race day to swap in one of these races.` })

  const owners = new Map()
  races.forEach((race, ri) => {
    if (race.runners_declared != null && race.runners_declared !== race.runners.length) {
      flags.push({ type: 'count_mismatch', severity: 'warn', race: ri + 1, message: `Race ${ri + 1} (${race.venue} ${race.race_time}): the racecard says ${race.runners_declared} runners, ${race.runners.length} listed` })
    }
    for (const u of race.runners) {
      const tag = `Race ${ri + 1} no. ${u.number} ${u.horse}`
      if (u.price_decimal == null) flags.push({ type: 'missing_price', severity: 'warn', race: ri + 1, number: u.number, message: `${tag} has no price, so it would score 0 until one is added` })
      else if (isOddPrice(u.price_decimal)) flags.push({ type: 'odd_price', severity: 'warn', race: ri + 1, number: u.number, message: `${tag} is priced ${u.price}, which looks unusual` })
      const hasOwn = u.silks && (u.silks.colour || u.silks.colour2)
      if (u.owner_id) {
        const entry = owners.get(u.owner_id) || { owner_id: u.owner_id, owner_name: u.owner_name, runners: [], known: false }
        if (hasOwn || library[u.owner_id]) entry.known = true
        if (!entry.owner_name && u.owner_name) entry.owner_name = u.owner_name
        entry.runners.push(tag)
        owners.set(u.owner_id, entry)
      } else if (!hasOwn) {
        flags.push({ type: 'no_silks', severity: 'warn', race: ri + 1, number: u.number, message: `${tag} has no owner and no silks` })
      }
    }
  })
  for (const o of owners.values()) {
    if (!o.known) flags.push({ type: 'new_owner', severity: 'action', owner_id: o.owner_id, owner_name: o.owner_name, runners: o.runners, message: `${o.owner_name || `Owner ${o.owner_id}`} is new: choose their silks (${plural(o.runners.length, 'runner')})` })
  }
  const order = { block: 0, action: 1, warn: 2 }
  return flags.sort((a, b) => order[a.severity] - order[b.severity])
}

export function racecardSummary(payload, flags) {
  const races = payload?.races || []
  return {
    races: races.length,
    runners: races.reduce((n, r) => n + r.runners.length, 0),
    new_owners: flags.filter(f => f.type === 'new_owner').length,
    missing_prices: flags.filter(f => f.type === 'missing_price').length,
    odd_prices: flags.filter(f => f.type === 'odd_price').length,
  }
}

// ═══ Editing a draft on the review screen (pure) ═════════════════════════
// Each returns { ok: true, payload } with the change made (the original is not touched), or { ok: false, error }.

const clone = v => JSON.parse(JSON.stringify(v))

// Change one runner. patch: any of { number, horse, jockey, trainer, price, owner_name, form }.
export function editDraftRunner(payload, ri, ui, patch) {
  const next = clone(payload)
  const race = next.races[ri], runner = race?.runners[ui]
  if (!runner) return { ok: false, error: 'That runner is not on the draft any more.' }
  if ('horse' in patch) {
    if (!String(patch.horse).trim()) return { ok: false, error: 'The horse needs a name.' }
    runner.horse = String(patch.horse).trim()
  }
  if ('number' in patch) {
    const n = Number(String(patch.number).trim())
    if (!Number.isInteger(n) || n < 1) return { ok: false, error: 'The number should be a whole number of 1 or more.' }
    if (race.runners.some((u, j) => j !== ui && u.number === n)) return { ok: false, error: `Number ${n} is already used in this race.` }
    runner.number = n
  }
  if ('price' in patch) {
    const p = readPrice(patch.price)
    if (p.error) return { ok: false, error: p.error }
    runner.price = p.fractional; runner.price_decimal = p.decimal
  }
  for (const k of ['jockey', 'trainer', 'owner_name', 'form']) if (k in patch) runner[k] = String(patch[k] ?? '').trim() || null
  race.runners.sort((a, b) => a.number - b.number)
  return { ok: true, payload: next }
}

export function removeDraftRunner(payload, ri, ui) {
  const next = clone(payload)
  const race = next.races[ri]
  if (!race?.runners[ui]) return { ok: false, error: 'That runner is not on the draft any more.' }
  if (race.runners.length <= 2) return { ok: false, error: 'A race needs at least 2 runners. Reject the draft if the card is wrong.' }
  race.runners.splice(ui, 1)
  return { ok: true, payload: next }
}

// Change a race's details. patch: any of { venue, race_name, race_time, distance }. Races stay in time order, which is the
// order they are numbered in.
export function editDraftRace(payload, ri, patch) {
  const next = clone(payload)
  const race = next.races[ri]
  if (!race) return { ok: false, error: 'That race is not on the draft any more.' }
  for (const k of ['venue', 'race_name']) if (k in patch) {
    if (!String(patch[k]).trim()) return { ok: false, error: `The race needs a ${k === 'venue' ? 'venue' : 'name'}.` }
    race[k] = String(patch[k]).trim()
  }
  if ('race_time' in patch) {
    const t = String(patch.race_time).trim()
    if (!/^\d{1,2}:\d{2}$/.test(t) || Number(t.split(':')[0]) > 23 || Number(t.split(':')[1]) > 59) return { ok: false, error: 'The time should look like 13:50.' }
    race.race_time = t.padStart(5, '0')
  }
  if ('distance' in patch) race.distance = String(patch.distance ?? '').trim() || null
  next.races.sort((a, b) => a.race_time.localeCompare(b.race_time))
  return { ok: true, payload: next }
}

// ═══ Approve / reject ════════════════════════════════════════════════════

// A draft's race as the rows importRaces() takes.
function toParsed(day, race, library) {
  return {
    header: { venue: race.venue, race_name: race.race_name, time: race.race_time, distance: race.distance, class: race.class_type },
    runners: race.runners.map(u => ({
      horse_number: u.number, horse_name: u.horse, jockey: u.jockey || 'TBA', trainer: u.trainer || null,
      odds_fractional: u.price || null, odds_decimal: u.price_decimal ?? null,
      ...(day.kind === 'week' ? { form_string: u.form || null } : {}),
      ...resolveSilks(u, library), owner_id: u.owner_id || null, owner_name: u.owner_name || null,
    })),
  }
}

// "Approve & notify players". Returns { ok, text, warn? } or { ok: false, error }.
export async function approveRacecard(draftId, { userId = null } = {}) {
  const claimed = await updateDraft(draftId, { status: 'approved', reviewed_at: new Date().toISOString(), reviewed_by: userId }, { onlyStatus: 'pending' })
  if (!claimed) return fail('This draft is not waiting for review any more.')
  const release = async note => { await updateDraft(draftId, { status: 'pending', note, reviewed_at: null, reviewed_by: null }).catch(() => {}); return fail(note) }
  try {
    if (claimed.kind !== 'racecard') return await release('That draft is not a racecard.')
    const payload = claimed.payload

    // The race day: the one that exists, or the Saturday week the draft asks for.
    let res = await resolveDay(payload.date, payload.day)
    if (res.error) return await release(res.error)
    let created = false
    if (!res.day) {
      if (!payload.week) return await release(`There is no race day on ${payload.date} and the draft does not ask for a week to be created.`)
      const made = await createWeek(payload.week.saturday_date)
      if (!made.ok) return await release(made.error)
      created = true
      res = { day: (await loadDay(made.key)).day }
    }
    const day = res.day
    const { races: existing } = await loadDayRaces(day)
    if (existing.length) return await release(`${day.title} already has ${plural(existing.length, 'race')} loaded. Reject this draft, or use Replace race.`)
    if (day.kind === 'week' && payload.races.length > MAX_WEEK_RACES) return await release(`A Saturday week holds ${MAX_WEEK_RACES} races at most; this card has ${payload.races.length}.`)

    const library = await getOwnerSilks([...new Set(payload.races.flatMap(r => r.runners.map(u => u.owner_id)).filter(Boolean))])
    const flags = racecardFlags(payload, { library, existingRaces: 0 })
    const imp = await importRaces(day, payload.races.map(r => toParsed(day, r, library)), [])
    if (!imp.ok) return await release(`${imp.error}${imp.made?.length ? ` (${plural(imp.made.length, 'race')} were already added to ${day.title}; delete them in Race days before approving again)` : ''}`)

    // Owners the agent sent silks for join the library, without overwriting any an admin chose.
    const fromAgent = payload.races.flatMap(r => r.runners).filter(u => u.owner_id && u.silks && (u.silks.colour || u.silks.colour2))
    const seen = new Set()
    await saveOwnerSilks(fromAgent.filter(u => !seen.has(u.owner_id) && seen.add(u.owner_id)).map(u => ({
      owner_id: u.owner_id, owner_name: u.owner_name, silk_colour: u.silks.colour, silk_colour_secondary: u.silks.colour2, silk_pattern: u.silks.pattern,
    })), { keepExisting: true })

    const runners = imp.made.reduce((n, m) => n + m.runners, 0)
    let warn = ''
    const open = await sendPicksOpen(day)
    if (!open.ok) warn = `The races are loaded but the picks-open notification failed (${open.error}). Use Send picks open on Today.`
    const text = `Racecard approved for ${day.title}: ${plural(imp.made.length, 'race')}, ${plural(runners, 'runner')}${created ? ', week created' : ''}${open.ok ? ', players notified' : ''}`
    await updateDraft(draftId, {
      status: 'applied', applied_at: new Date().toISOString(), note: warn || null,
      race_week_id: day.kind === 'week' ? day.id : day.linkedWeek?.id || claimed.race_week_id || null,
      festival_day_id: day.kind === 'festival' ? day.id : null, race_day_kind: day.kind,
    })
    await logAgent({ actor: 'admin', action: 'draft_applied', summary: text, ok: !warn, detail: { summary: racecardSummary(payload, flags), warn: warn || null }, day, draftId })
    return { ok: true, text, warn, key: day.key }
  } catch (err) {
    return await release(err.message || String(err))
  }
}

export async function rejectDraft(draftId, { userId = null, note = null } = {}) {
  const row = await updateDraft(draftId, { status: 'rejected', reviewed_at: new Date().toISOString(), reviewed_by: userId, note }, { onlyStatus: 'pending' })
  if (!row) return fail('This draft is not waiting for review any more.')
  await logAgent({ actor: 'admin', action: 'draft_rejected', summary: `${{ racecard: 'Racecard', morning_check: 'Morning check', results: 'Results' }[row.kind] || 'Draft'} for ${row.race_date} rejected${note ? `: ${note}` : ''}`, date: row.race_date, draftId })
  return { ok: true }
}

// One tap on a pending morning check or results draft: apply what was waiting for review, using the same code the server
// uses on its own. Items that still cannot be applied stay in the draft (status stays pending).
export async function approveDraft(draftId, { userId = null } = {}) {
  const claimed = await updateDraft(draftId, { status: 'approved', reviewed_at: new Date().toISOString(), reviewed_by: userId }, { onlyStatus: 'pending' })
  if (!claimed) return fail('This draft is not waiting for review any more.')
  try {
    if (claimed.kind === 'racecard') { await updateDraft(draftId, { status: 'pending' }); return fail('Use Approve & notify players on the racecard.') }
    const res = await resolveDay(claimed.payload.date, claimed.payload.day)
    if (res.error || !res.day) throw new Error(res.error || `There is no race day on ${claimed.payload.date} any more.`)
    const before = claimed.payload.outcomes || []
    const outcomes = await approveOutcomes(res.day, claimed.kind, claimed.payload)
    const stillWaiting = outcomes.filter(o => o.state === 'needs_review')
    const done = outcomes.filter((o, i) => before[i]?.state === 'needs_review' && o.state === 'applied')
    await updateDraft(draftId, {
      payload: { ...claimed.payload, outcomes },
      status: stillWaiting.length ? 'pending' : 'applied', applied_at: stillWaiting.length ? null : new Date().toISOString(),
      note: stillWaiting.length ? `${plural(stillWaiting.length, 'item')} could not be applied` : null,
    })
    for (const o of done) await logAgent({ actor: 'admin', action: o.type === 'result' ? 'result_entered' : o.type, summary: o.text, ok: !o.warn, detail: { ref: o.ref, approved_by_admin: true }, day: res.day, draftId })
    const text = done.length ? `${plural(done.length, 'change')} applied: ${done.map(o => o.text).join('; ')}` : 'Nothing needed changing.'
    return stillWaiting.length
      ? { ok: false, error: `${text}. Still waiting: ${stillWaiting.map(o => `${o.text} (${o.reasons.join(', ')})`).join('; ')}` }
      : { ok: true, text }
  } catch (err) {
    await updateDraft(draftId, { status: 'pending', note: err.message || String(err) }).catch(() => {})
    return fail(err)
  }
}

// ═══ Replace race ════════════════════════════════════════════════════════

// Swap a race for a new one (same race number, same row), before picks lock. The picks on the old race are cleared, nothing
// else on the day changes, and the players who had picked in it are told to pick again. After the lock it is refused: use
// Abandon race instead.
//   day   a loadDay() day   race  the race row being replaced   spec  { venue, race_name, race_time, distance?, class_type?, runners: [rows for the runners table] }
export async function replaceRace(day, race, spec, { nowMs = Date.now() } = {}) {
  const kind = day.kind, c = DAY[kind], k = KINDS[kind]
  try {
    if (isLocked(day, nowMs)) return fail('Picks have locked, so a race cannot be replaced. Use Abandon race instead.')
    if (!spec?.venue?.trim() || !spec?.race_name?.trim() || !/^\d{1,2}:\d{2}$/.test(String(spec?.race_time || '').trim())) return fail('The new race needs a venue, a name and a time like 13:50')
    if (!Array.isArray(spec.runners) || spec.runners.length < 2) return fail('The new race needs at least 2 runners')

    const hasResult = ((await supabase.from(k.results).select('position').eq(k.raceCol, race.id).limit(1)).data || []).length > 0
    if (hasResult) return fail('This race already has a result, so it cannot be replaced.')

    const oldRunners = (await supabase.from(k.runners).select('*').eq(k.raceCol, race.id)).data || []
    const picks = (await supabase.from(c.picks).select('*').eq(c.raceCol, race.id)).data || []
    const userIds = [...new Set(picks.map(p => p.user_id))]

    // 1. Clear the picks on the old race (the first change: if it is refused, nothing else has happened).
    if (picks.length) {
      const del = await supabase.from(c.picks).delete().eq(c.raceCol, race.id).select('id')
      if (del.error) return fail(`Could not clear the picks on the old race: ${del.error.message}`)
      if ((del.data || []).length !== picks.length) return fail(`Only ${(del.data || []).length} of ${picks.length} picks could be cleared. Check you are signed in as an admin.`)
    }

    // 2. The old runners, the race's details, then the new runners. A failure puts the old ones back.
    const restore = async () => {
      await supabase.from(k.runners).delete().eq(k.raceCol, race.id)
      if (oldRunners.length) await supabase.from(k.runners).insert(oldRunners)
      if (picks.length) await supabase.from(c.picks).insert(picks)
    }
    const delRunners = await supabase.from(k.runners).delete().eq(k.raceCol, race.id)
    if (delRunners.error) { await restore(); return fail(`Could not remove the old runners: ${delRunners.error.message}`) }
    const patch = { venue: spec.venue.trim(), race_name: spec.race_name.trim(), race_time: spec.race_time.trim(), runner_count_at_lock: null, is_abandoned: false, abandoned_at: null }
    if (spec.distance?.trim()) patch.distance = spec.distance.trim()
    if (kind === 'week' && spec.class_type?.trim()) patch.class_type = spec.class_type.trim()
    const upd = await supabase.from(c.races).update(patch).eq('id', race.id).select('id')
    if (upd.error || (upd.data || []).length !== 1) { await restore(); return fail(`Could not update the race: ${upd.error ? upd.error.message : '0 rows changed'}`) }
    const ins = await supabase.from(k.runners).insert(spec.runners.map(r => ({ ...r, [k.raceCol]: race.id })))
    if (ins.error) {
      await supabase.from(c.races).update({ venue: race.venue, race_name: race.race_name, race_time: race.race_time }).eq('id', race.id)
      await restore()
      return fail(`The new runners could not be saved, so the old race was put back (${ins.error.message})`)
    }
    await syncWeekStatus(kind, day.id)

    // 3. Tell the players who had picked in it. The lock time is read again: the database moves it with the first race.
    const fresh = (await supabase.from(c.days).select('picks_deadline').eq('id', day.id).maybeSingle()).data
    const lockIso = fresh?.picks_deadline || day.deadline
    let told = 0, warn = ''
    if (userIds.length) {
      const { error } = await supabase.functions.invoke('send-notification', {
        body: { userIds, ...raceReplaced({ raceNumber: race.race_number, lockText: lockLabel(lockIso, nowMs) || lockTimeText(lockIso) }), url: `${APP_ORIGIN}/picks` },
      })
      if (error) warn = 'The race was replaced, but the notification to players could not be sent.'
      else told = userIds.length
    }
    const text = `Race ${race.race_number} replaced by ${spec.venue.trim()} ${spec.race_time.trim()} · ${plural(picks.length, 'pick')} cleared${told ? ` · ${plural(told, 'player')} told to pick again` : ''}`
    await logAgent({ actor: 'admin', action: 'race_replaced', summary: text, ok: !warn, detail: { old: { venue: race.venue, race_name: race.race_name, race_time: race.race_time }, picks_cleared: picks.length }, day })
    return { ok: !warn, text, warn }
  } catch (err) { return fail(err) }
}

// A new race from a racecard draft's race, as the spec replaceRace takes. `library` resolves silks like an import does.
export function specFromDraftRace(kind, race, library = {}) {
  return { venue: race.venue, race_name: race.race_name, race_time: race.race_time, distance: race.distance, class_type: race.class_type, runners: toParsed({ kind }, race, library).runners }
}
