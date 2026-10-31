import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { MOBILE } from './lib/mobile.js'
import { useStore } from './store/useStore.js'
import { startMediaSync } from './lib/media-sync.js'
import { startNativeKeyboard } from './lib/native-keyboard.js'
import { managedModeHint } from './lib/managed-bridge.js'
// The Coach's and the admin dashboard's styles stay in the main stylesheet, in the place they
// always had (before index.css), although their screens are now loaded on demand (App.jsx).
import './admin.css'
import './coach.css'
import './index.css'
import './branding.css'
import { hideBoot, handOverFromLaunchScreen } from './lib/boot.js'

// The web shell receives the commercial palette before React renders. Native clients keep
// their existing theme, accent and seasonal controls because they never receive this marker.
if (!MOBILE) document.documentElement.dataset.webBranding = 'true'

// App.jsx restores per-route scroll itself; the browser's own attempt races it.
// A script that dies before the app draws would otherwise leave the boot logo lifting forever.
window.addEventListener('error', hideBoot, { once: true })
handOverFromLaunchScreen()

if ('scrollRestoration' in history) history.scrollRestoration = 'manual'

createRoot(document.getElementById('root')).render(
  <StrictMode><App /></StrictMode>
)

// The photos and videos of custom exercises stay upstream in M0/native. A web build explicitly
// marked M1 waits for a verified public mode before it even starts this background producer: its
// eventual requests still go through the central access guard installed for the signed-in account.
if (MOBILE || !managedModeHint()) startMediaSync(useStore)
else {
  const stop = useStore.subscribe(state => {
    if (!state.config) return
    stop()
    startMediaSync(useStore)
  })
}

// Android 15 does not resize the page for the soft keyboard; the app says how much it covers and
// this keeps the focused field above it. Idle everywhere else.
startNativeKeyboard()

// Not in the mobile build: the native shell already serves everything from disk.
if (!MOBILE && 'serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {})
  // The plan's exercise media, kept by the worker for a workout opened without a network (#281).
  // It only fetches ahead while the page runs as the installed app; a tab keeps what it has shown.
  import('./lib/media-prefetch.js').then(m => m.startMediaPrefetch(useStore)).catch(() => {})
}
