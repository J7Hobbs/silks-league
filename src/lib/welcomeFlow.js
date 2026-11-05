// Which steps of the welcome flow does this player see? Pure, so it is easy to test.
import { homeScreenVariant, iosNotInstalled } from './device.js'

// device: from detectDevice. push: { supported, permission, optedIn } or null when unknown
// (OneSignal didn't start). Returns the step ids in order:
//   'home'    add to home screen (not installed, not a desktop)
//   'pick'    pick a horse in every race
//   'win'     win or each-way
//   'group'   your group / play with your mates
//   'remind'  turn on reminders (push possible, not subscribed, and not iOS-without-install)
export function buildSteps(device, push) {
  const steps = []
  if (homeScreenVariant(device)) steps.push('home')
  steps.push('pick', 'win', 'group')
  const canAsk = !!push && push.supported && !push.optedIn && push.permission !== 'denied'
  if (canAsk && !iosNotInstalled(device)) steps.push('remind')
  return steps
}

// Skip on the how-it-works steps jumps to the group step.
export function skipTarget(steps) {
  return steps.indexOf('group')
}

// "HOW IT WORKS · 1 OF 3" style labels, and the fixed labels of the first and last steps.
export const STEP_LABEL = {
  home: 'FIRST THINGS FIRST',
  pick: 'HOW IT WORKS · 1 OF 3',
  win: 'HOW IT WORKS · 2 OF 3',
  group: 'HOW IT WORKS · 3 OF 3',
  remind: 'ONE LAST THING',
}
