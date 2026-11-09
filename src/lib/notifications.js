// Push-notification opt-in for the Home card. This repeats the sequence the Account
// page uses (login, ask permission, opt in); Account has its own copy for now.
// Nothing here runs until a player taps the button, except reading the status.
import { OneSignal, oneSignalReady } from './oneSignal'
import { currentDevice, iosNotInstalled } from './device.js'
import { supabase } from './supabase'

// iOS only allows push from a site added to the home screen.
export function needsHomeScreen() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) && window.navigator.standalone !== true
}

// { supported, permission: 'default' | 'granted' | 'denied', optedIn }
export async function pushStatus() {
  await oneSignalReady()
  if (!OneSignal.Notifications.isPushSupported()) return { supported: false, permission: 'default', optedIn: false }
  return {
    supported: true,
    permission: OneSignal.Notifications.permissionNative,
    optedIn: !!OneSignal.User.PushSubscription.optedIn,
  }
}

// Calls `onChange` whenever permission or the subscription changes. Returns a stop function.
export function watchPush(onChange) {
  let stopped = false
  let detach = () => {}
  oneSignalReady().then(() => {
    if (stopped) return
    OneSignal.Notifications.addEventListener('permissionChange', onChange)
    OneSignal.User.PushSubscription.addEventListener('change', onChange)
    detach = () => {
      OneSignal.Notifications.removeEventListener?.('permissionChange', onChange)
      OneSignal.User.PushSubscription.removeEventListener?.('change', onChange)
    }
  }).catch(() => {})
  return () => { stopped = true; detach() }
}

// Same steps, same order, as the switch on the Account page. Resolves to whether
// permission was granted.
export async function enablePush(userId) {
  await oneSignalReady()
  await OneSignal.login(userId)
  const granted = await OneSignal.Notifications.requestPermission()
  if (granted) await OneSignal.User.PushSubscription.optIn()
  return granted
}

// What the Home strip (and the "turn on notifications" line on Picks) should offer this device:
//   null      nothing: notifications are already on, or this browser can't do them / isn't ready yet
//   'home'    iPhone or iPad not opened from the home screen icon: add it to the home screen first
//   'denied'  the browser blocked them earlier and can't ask again: switch them on in Settings
//   'enable'  not on yet: "Turn on" runs the opt-in
// `status` is pushStatus() (null until it is known); `device` is currentDevice().
export function notifOffer(status, device = currentDevice()) {
  if (iosNotInstalled(device)) return 'home'
  if (!status || !status.supported || status.optedIn) return null
  return status.permission === 'denied' ? 'denied' : 'enable'
}

// Tells Admin whether this player has notifications on: profiles.notifications_enabled, plus when it last changed.
// "On" means this device can do push, the browser allows it and the player is opted in. It is written only when the
// answer differs from the last one written from this browser, so opening the app does not write every time.
// A player with several devices has whichever device opened the app (or changed the setting) last. Never throws:
// Admin's bell is an extra, so a failure here must not get in anyone's way.
export async function syncNotifStatus(userId) {
  if (!userId) return
  try {
    const s = await pushStatus()
    const enabled = !!(s.supported && s.permission === 'granted' && s.optedIn)
    const key = `silks-notif-synced:${userId}`
    let last = null
    try { last = localStorage.getItem(key) } catch { /* storage blocked: just write */ }
    if (last === String(enabled)) return
    const { error } = await supabase.from('profiles')
      .update({ notifications_enabled: enabled, notifications_updated_at: new Date().toISOString() }).eq('id', userId)
    if (error) return
    try { localStorage.setItem(key, String(enabled)) } catch { /* fine */ }
  } catch { /* leave it for the next open */ }
}
