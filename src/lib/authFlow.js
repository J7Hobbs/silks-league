// Small pure helpers for the auth pages (log in, sign up, check email, reset password).

export const USERNAME_REGEX = /^[a-zA-Z0-9]{3,20}$/
export const RESEND_COOLDOWN_S = 60

// Turns a Supabase auth error into one clear sentence for the player.
export function friendlyAuthError(err) {
  const msg = err?.message || ''
  const m = msg.toLowerCase()
  const code = err?.code || ''
  if (msg === 'Failed to fetch') return 'Cannot connect to the server. Check your connection and try again.'
  if (isAlreadyRegisteredError(err)) return 'An account with this email already exists.'
  if (m.includes('invalid login credentials') || m.includes('invalid email or password')) return 'Incorrect email or password. Please try again.'
  if (code === 'same_password' || m.includes('different from the old password')) return "Choose a password you haven't used before."
  if (code === 'weak_password' || m.includes('password should be')) return 'That password is too weak. Try a longer one.'
  if (code === 'over_email_send_rate_limit' || m.includes('security purposes') || m.includes('email rate limit')) return 'Please wait a minute before asking for another email.'
  if (m.includes('rate limit') || m.includes('too many')) return 'Too many attempts. Please wait a few minutes and try again.'
  if (m.includes('database error')) return 'There was a problem creating your account. Please try again or contact support.'
  if (m.includes('unable to validate email') || m.includes('invalid format')) return 'That email address doesn’t look right. Check it and try again.'
  return msg || 'Something went wrong. Please try again.'
}

export function isUnconfirmed(err) {
  return err?.code === 'email_not_confirmed' || /email not confirmed/i.test(err?.message || '')
}

function isAlreadyRegisteredError(err) {
  const m = (err?.message || '').toLowerCase()
  return err?.code === 'user_already_exists' || m.includes('user already registered') ||
    m.includes('already been registered') || m.includes('email address is already')
}

// With email confirmation on, Supabase doesn't return an error when someone signs up with an
// address that already has an account. It returns a user with no identities instead.
export function signUpFoundExisting(data, error) {
  if (error) return isAlreadyRegisteredError(error)
  const ids = data?.user?.identities
  return Array.isArray(ids) && ids.length === 0
}
