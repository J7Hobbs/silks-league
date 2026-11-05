// "Open Mail" on the check-your-email screens. We can't tell which mail app someone uses, so a
// button is offered only for email providers where the link is dependable. Anything else
// returns null and the screen leaves the button out.
//   Gmail, Outlook/Hotmail/Live, Yahoo: their web inbox (phones open the app when it's installed)
//   iCloud: Apple Mail on an iPhone or iPad, iCloud Mail on the web elsewhere

const GOOGLE = ['gmail.com', 'googlemail.com']
const MICROSOFT = ['outlook.com', 'outlook.co.uk', 'hotmail.com', 'hotmail.co.uk', 'live.com', 'live.co.uk', 'msn.com']
const YAHOO = ['yahoo.com', 'yahoo.co.uk', 'ymail.com', 'rocketmail.com']
const APPLE = ['icloud.com', 'me.com', 'mac.com']

// -> { href, newTab } or null
export function mailLinkFor(email, os) {
  const domain = String(email || '').split('@')[1]?.trim().toLowerCase()
  if (!domain) return null
  if (GOOGLE.includes(domain)) return { href: 'https://mail.google.com/mail/u/0/#inbox', newTab: true }
  if (MICROSOFT.includes(domain)) return { href: 'https://outlook.live.com/mail/0/inbox', newTab: true }
  if (YAHOO.includes(domain)) return { href: 'https://mail.yahoo.com/', newTab: true }
  if (APPLE.includes(domain)) return os === 'ios' ? { href: 'message://', newTab: false } : { href: 'https://www.icloud.com/mail', newTab: true }
  return null
}
