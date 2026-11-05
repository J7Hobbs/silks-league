// What kind of device and browser is this? Pure functions, so every variant is easy to test.
// Used by the welcome flow to decide how to ask for "add to home screen".

// In-app browsers we can recognise from the user agent. (WhatsApp's browser on iPhone and
// Android looks just like Safari / Chrome, so it can't be told apart; the iOS steps carry a
// hint for that case.)
const IN_APP = [
  [/Instagram/i, 'Instagram'],
  [/Messenger|Orca-Android|FBAN\/Orca/i, 'Messenger'],
  [/FBAN|FBAV|FB_IAB|FBIOS/i, 'Facebook'],
  [/Snapchat/i, 'Snapchat'],
  [/TikTok|musical_ly|BytedanceWebview|trill/i, 'TikTok'],
  [/\bLine\//i, 'LINE'],
  [/MicroMessenger/i, 'WeChat'],
  [/LinkedInApp/i, 'LinkedIn'],
  [/Twitter/i, 'X'],
  [/WhatsApp/i, 'WhatsApp'],
]

// env: { ua, platform, maxTouchPoints, standalone (navigator.standalone), displayStandalone, hasInstallEvent }
export function detectDevice(env = {}) {
  const ua = env.ua || ''
  const iPadOnMac = /Macintosh/i.test(ua) && (env.maxTouchPoints || 0) > 1
  const ios = /iphone|ipad|ipod/i.test(ua) || iPadOnMac
  const android = /android/i.test(ua)
  const os = ios ? 'ios' : android ? 'android' : 'desktop'
  const installed = env.displayStandalone === true || env.standalone === true

  let inApp = null
  if (!installed) {
    const hit = IN_APP.find(([re]) => re.test(ua))
    if (hit) inApp = hit[1]
    // An iPhone web view with no "Safari" token is another app's browser.
    else if (ios && !/Safari\//i.test(ua) && !/CriOS|FxiOS|EdgiOS/i.test(ua)) inApp = 'another app'
    // Android web views carry "; wv)".
    else if (android && /;\s*wv\)/i.test(ua)) inApp = 'another app'
  }
  return { os, installed, inApp, canInstall: env.hasInstallEvent === true }
}

// Reads the real browser.
export function currentDevice(hasInstallEvent = false) {
  if (typeof window === 'undefined') return detectDevice({})
  return detectDevice({
    ua: navigator.userAgent,
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints,
    standalone: window.navigator.standalone === true,
    displayStandalone: window.matchMedia?.('(display-mode: standalone)').matches === true,
    hasInstallEvent,
  })
}

// Which version of the "add to home screen" step to show. null = skip the step
// (already installed, or on a desktop).
export function homeScreenVariant(d) {
  if (d.installed || d.os === 'desktop') return null
  if (d.inApp) return { kind: 'inapp', os: d.os, app: d.inApp }
  if (d.os === 'ios') return { kind: 'ios' }
  return d.canInstall ? { kind: 'android-prompt' } : { kind: 'android-manual' }
}

// iOS only allows web push from the home-screen app.
export function iosNotInstalled(d) {
  return d.os === 'ios' && !d.installed
}
