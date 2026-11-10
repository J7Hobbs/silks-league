// ════════════════════════════════════════════════════════════════════════
//  ALL push-notification wording for Silks League lives in this one file.
//  Change a message here and every place that sends it changes with it.
//
//  It is plain JavaScript with no imports, so it can be used from the app (through
//  src/lib/notifyCopy.js) and from the Edge Functions (import '../_shared/notifyCopy.js').
//  That is why it sits in supabase/functions/_shared: an Edge Function can only
//  bundle files from inside supabase/functions.
//
//  Every message is a function returning { title, body }. The pieces in ${...} are
//  filled in by the code that sends it. Messages that rotate (result teasers and
//  the end-of-day message) are lists: add or remove a line and the rotation follows.
// ════════════════════════════════════════════════════════════════════════

export const APP_ORIGIN = 'https://silks-league.vercel.app'

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

// ── Names and times ──────────────────────────────────────────────────────

// How a race day is named in a message. A festival day is "Cheltenham Day 1"; the Saturday League is
// "Saturday's ITV races". `plural` says whether the name takes "are" ("races are live") or "is".
//   kind 'week' | 'festival'      festivalName  the festival's short name      dayNumber  Day 1, Day 2 ...
export function describeDay({ kind, festivalName, dayNumber }) {
  if (kind === 'festival') return { name: `${festivalName || 'Festival'} Day ${dayNumber}`, plural: false }
  return { name: "Saturday's ITV races", plural: true }
}

// "13:05" for today's UK date, "Sat 14 Nov, 13:05" for any other day. `iso` is a timestamp.
export function lockLabel(iso, nowMs = Date.now()) {
  if (!iso || Number.isNaN(new Date(iso).getTime())) return ''
  const parts = at => Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(at)).map(p => [p.type, p.value]))
  const t = parts(iso), n = parts(nowMs)
  const clock = `${t.hour}:${t.minute}`
  return t.day === n.day && t.month === n.month ? clock : `${t.weekday} ${t.day} ${t.month}, ${clock}`
}

// "13:35" from a race time that may be "13:35:00".
export const clockOf = time => (/^\d{1,2}:\d{2}/.test(String(time || '')) ? String(time).slice(0, 5).padStart(5, '0') : '')

// ── 1. Picks open (everyone) ─────────────────────────────────────────────
export function picksOpen({ dayName, plural: isPlural }) {
  return { title: 'Picks are open', body: `${dayName} ${isPlural ? 'are' : 'is'} live. Who are you backing?` }
}

// ── 2. Picks closing soon (about 2 hours before the lock) ────────────────
//   lockTime  from lockLabel()    remaining  races still to pick    noBanker  true when no banker is set
export function picksClosing({ lockTime, remaining, noBanker }) {
  return {
    title: 'Picks closing soon',
    body: `Picks close at ${lockTime}. You've still got ${plural(remaining, 'race', 'races')} to fill${noBanker ? ', and no banker set' : ''}`,
  }
}

// ── 3. Last call (30 minutes before the lock, players with no picks) ─────
export function lastCall({ dayName }) {
  return { title: 'Last call', body: `Picks lock in 30 minutes for ${dayName}` }
}

// ── 4. Non-runner (players who picked the horse) ─────────────────────────
//   beforeLock  true before picks lock      lockText  from lockLabel()
export function nonRunner({ beforeLock, raceNumber, lockText }) {
  return {
    title: `Non-runner in Race ${raceNumber}`,
    body: beforeLock
      ? `Your Race ${raceNumber} horse is a non-runner. Pick again before ${lockText || 'picks lock'}, or you'll stay on the favourite.`
      : `Your Race ${raceNumber} horse is a non-runner. You've been moved to the favourite.`,
  }
}

// ── 5. Race result teaser (only players who picked in that race) ─────────
// Never says points or position. One of these goes to each player, rotating so nobody gets the same line twice in a
// row on a race day. A line that needs a detail the race does not have (a time, a venue) is skipped for that race.
//   raceNumber, time ("13:35"), venue, horse (the player's own pick)
export const RESULT_TEASER_TITLE = "Result's in"
export const RESULT_TEASERS = [
  { needs: [], text: ({ raceNumber, horse }) => `Race ${raceNumber} is in. How did ${horse} get on?` },
  { needs: ['time'], text: ({ time, horse }) => `They've crossed the line in the ${time}. Did ${horse} deliver?` },
  { needs: ['venue'], text: ({ venue, horse }) => `Result's in from ${venue}. See where ${horse} finished` },
  { needs: [], text: ({ raceNumber }) => `Race ${raceNumber} is official. Check how your pick did` },
]

// ── 6. End of day (once per race day, everyone who picked) ───────────────
// The first line names the venue, so it is only used when the day ran at one venue.
export const END_OF_DAY_TITLE = 'Final results'
export const END_OF_DAY = [
  { needs: ['venue'], text: ({ venue }) => `That's a wrap at ${venue}. Who's got the bragging rights?` },
  { needs: [], text: () => "Racing's done for the day. See who's top of the pile" },
  { needs: [], text: () => 'The last race is in. Did you beat your mates?' },
  { needs: [], text: () => 'Final results are in. Time to check the table' },
]

// ── 7. Group joins (everyone already in the group) ───────────────────────
export function groupJoined({ username, groupName }) {
  return { title: 'New group member', body: `${username} just joined ${groupName}` }
}

// ── Abandoned race (unchanged wording) ───────────────────────────────────
export function raceAbandoned({ raceLabel }) {
  return { title: 'Race abandoned', body: `${raceLabel} has been abandoned, so it scores 0 for everyone` }
}
export function pickNewBanker({ raceNumber, lockText }) {
  return { title: 'Pick a new banker', body: `Your banker was on Race ${raceNumber}, which has been abandoned. Pick a new banker before ${lockText}.` }
}

// ════════════════════════════════════════════════════════════════════════
//  Rotation (no wording below this line)
// ════════════════════════════════════════════════════════════════════════

// A small deterministic random number from text (FNV-1a, then a mix), so the same player on the same race day always
// gets the same sequence. Nothing has to be stored to remember what was sent before.
function hashOf(text) {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619) }
  h ^= h >>> 15; h = Math.imul(h, 2246822507); h ^= h >>> 13; h = Math.imul(h, 3266489909); h ^= h >>> 16
  return h >>> 0
}

const usable = (list, details) => list.map((v, i) => ({ v, i })).filter(({ v }) => v.needs.every(k => details[k])).map(({ i }) => i)

// The result teaser to send one player. `step` is how many teasers that player has already had on this race day (0 for
// the first), `seed` is `${userId}|${raceDayKey}`. Random, but step n never repeats step n-1. Returns the line's text.
export function resultTeaserFor({ seed, step = 0, details }) {
  const allowed = usable(RESULT_TEASERS, details)
  let last = -1
  for (let s = 0; s <= step; s++) {
    const pool = allowed.filter(i => i !== last)
    last = pool[hashOf(`${seed}|${s}`) % pool.length]
  }
  return RESULT_TEASERS[last].text(details)
}

// The end-of-day line for a race day: one line for everyone, chosen at random from the race day's id.
export function endOfDayFor({ seed, details }) {
  const allowed = usable(END_OF_DAY, details)
  return END_OF_DAY[allowed[hashOf(seed) % allowed.length]].text(details)
}
