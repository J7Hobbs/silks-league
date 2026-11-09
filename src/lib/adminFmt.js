// Small text helpers shared by the Admin screens.
import { weekdayShort, monthAbbr } from './format.js'

export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
// "Sat 14 Nov"
export const dateText = d => `${weekdayShort(d)} ${Number(d.slice(8, 10))} ${monthAbbr(d)}`
export const sentText = iso => new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' })
export const PILL = { ok: 'ok', gold: 'gold', warn: 'warn', off: 'off' }
