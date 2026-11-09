// Where a Saturday League week's races, picks and scores live.
//
// A normal week has its own rows in races / picks / scores / runners / results. A week that is
// linked to a festival day (race_weeks.festival_day_id) has none of its own: its races, picks and
// points are the festival day's (festival_races / festival_picks / festival_scores, and the
// runners and results that hang off them). Players make one set of picks, and the points count
// for the festival and for that week of the Saturday League.
//
// Everything here is a read, and the rows come back in the Saturday shape (race_id, not
// festival_race_id), so the code that ranks, totals and lays out the tables does not need to know
// which kind of week it has. Points are read as stored; nothing here works out a score.
//
// Race ids are UUIDs from two different tables, so they never clash. Rows from weekRaces() carry
// `festival: true` for a linked week's races, which lets the other functions here ask only the
// table that can hold them. A plain id list works too: both tables are asked, and the one that
// does not hold those ids returns nothing.
import { supabase } from './supabase'

const PAGE = 1000

// PostgREST returns at most 1000 rows a call, so page through a big read (ordered by id so the
// pages do not overlap). Throws on an error; callers that used to ignore errors catch it.
async function paged(build) {
  const rows = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().order('id').range(from, from + PAGE - 1)
    if (error) throw error
    rows.push(...(data || []))
    if (!data || data.length < PAGE) return rows
  }
}

export const isLinkedWeek = week => !!week?.festival_day_id

// The races of these weeks: [{ id, race_week_id, festival, ...cols }]. `weeks` are race_weeks
// rows that include festival_day_id. `cols` are extra race columns (race_number, race_time, venue,
// race_name, runner_count_at_lock); festival_races has the same names.
export async function weekRaces(weeks, cols = []) {
  const list = weeks || []
  const plainIds = list.filter(w => !w.festival_day_id).map(w => w.id)
  const linked = list.filter(w => w.festival_day_id)
  const weekOfDay = Object.fromEntries(linked.map(w => [w.festival_day_id, w.id]))
  const base = ['id', ...cols.filter(c => c !== 'id' && c !== 'race_week_id' && c !== 'festival_day_id')]

  const [plain, fest] = await Promise.all([
    plainIds.length
      ? paged(() => supabase.from('races').select([...base, 'race_week_id'].join(',')).in('race_week_id', plainIds))
      : [],
    linked.length
      ? paged(() => supabase.from('festival_races').select([...base, 'festival_day_id'].join(',')).in('festival_day_id', Object.keys(weekOfDay)))
      : [],
  ])
  return [
    ...plain.map(r => ({ ...r, festival: false })),
    ...fest.map(({ festival_day_id, ...r }) => ({ ...r, race_week_id: weekOfDay[festival_day_id], festival: true })),
  ]
}

// Race rows (or plain ids) -> the ids to ask each table for.
function split(input) {
  const plain = new Set(), fest = new Set()
  for (const x of input || []) {
    if (typeof x === 'string') { plain.add(x); fest.add(x) }
    else if (x.festival) fest.add(x.id)
    else plain.add(x.id)
  }
  return { plain: [...plain], fest: [...fest] }
}

// Rows from `table` (plain races) and `festTable` (festival races) for these races, in the Saturday
// shape. `cols` use the plain names (race_id); festival_race_id is read and renamed back.
async function byRace(input, { table, festTable, cols, userId, userIds }) {
  const { plain, fest } = split(input)
  const filters = q => {
    if (userId) q = q.eq('user_id', userId)
    if (userIds) q = q.in('user_id', userIds)
    return q
  }
  const festCols = cols.map(c => (c === 'race_id' ? 'festival_race_id' : c))
  const [a, b] = await Promise.all([
    plain.length ? paged(() => filters(supabase.from(table).select(cols.join(',')).in('race_id', plain))) : [],
    fest.length ? paged(() => filters(supabase.from(festTable).select(festCols.join(',')).in('festival_race_id', fest))) : [],
  ])
  return [...a, ...b.map(({ festival_race_id, ...r }) => ({ ...r, race_id: festival_race_id }))]
}

// Score rows: [{ user_id, race_id, total_points, position_achieved }] by default.
// { userId } for one player, { userIds } for a set; `cols` for others (bet_type, place_token_points, id).
export function weekScores(input, { cols = ['user_id', 'race_id', 'total_points', 'position_achieved'], userId, userIds } = {}) {
  return byRace(input, { table: 'scores', festTable: 'festival_scores', cols, userId, userIds })
}

// Pick rows: [{ user_id, race_id }] by default; add runner_id, bet_type, was_replaced, id as needed.
export function weekPicks(input, { cols = ['user_id', 'race_id'], userId, userIds } = {}) {
  return byRace(input, { table: 'picks', festTable: 'festival_picks', cols, userId, userIds })
}

// Runner rows for these races (race_id is the race they run in).
export function weekRunners(input, { cols = ['id', 'race_id', 'horse_name'] } = {}) {
  return byRace(input, { table: 'runners', festTable: 'festival_runners', cols })
}

// Result rows (the finishing order) for these races.
export function weekResults(input, { cols = ['race_id', 'position', 'horse_name', 'starting_price_display'] } = {}) {
  return byRace(input, { table: 'results', festTable: 'festival_results', cols })
}
