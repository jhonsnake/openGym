const BOOTSTRAP_KEY = '__opengymInvitation'
const TOKEN = /^[A-Za-z0-9_-]{43}$/
let invitation = null
const listeners = new Set()

const notify = () => listeners.forEach(listener => listener())

// The HTML receiver puts this value in volatile JS memory before any module, storage access, or
// request can observe the URL. Taking it is deliberately destructive: retry/switch state is held
// by the invitation UI, never by a hidden global or persistence layer.
export function takeInvitation(source = globalThis) {
  try {
    const value = source?.[BOOTSTRAP_KEY]
    try { delete source[BOOTSTRAP_KEY] } catch { source[BOOTSTRAP_KEY] = undefined }
    return typeof value?.token === 'string' && TOKEN.test(value.token) ? value.token : null
  } catch {
    return null
  }
}

// This is deliberately module memory, not a store.  Login is allowed to unmount while a person
// signs in or creates a passkey; losing that component must not lose the secret or turn it into a
// URL/storage/analytics value.  It is erased only by an explicit cancel or a terminal decision.
export function currentInvitation() {
  if (!invitation) {
    const token = takeInvitation()
    if (token) invitation = { token, preview: null, selected: [], consent: false }
  }
  return invitation
}

export function updateInvitation(patch) {
  if (!invitation) return null
  invitation = { ...invitation, ...patch }
  notify()
  return invitation
}

export function clearInvitation() {
  invitation = null
  notify()
}

export function subscribeInvitation(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
