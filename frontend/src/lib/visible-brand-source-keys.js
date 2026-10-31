// Reviewed from literal t() calls in frontend/src (excluding tests and locale packs).
// Locale packs retain these historical English keys; this deliberately does not import a
// dictionary at runtime. Keep this list in sync with the source-call audit in i18n-core.test.
export const VISIBLE_BRAND_SOURCE_KEYS = new Set([
  'A small file a friend can import into their own openGym. Routines only, none of your workouts or weigh-ins.',
  'Android blocks unencrypted http:// connections from apps, so this phone can only reach an https:// endpoint. Put HTTPS in front of it (Tailscale or a reverse proxy), or choose “Use my self-hosted openGym”: your server can reach an http:// model on its own network.',
  'Android can take up to half an hour to notice you walked in. Set openGym’s battery use to Unrestricted and the phone takes a short GPS look when you get near a gym, so the nudge comes at the door.',
  'Confirm it’s you to delete your openGym account',
  'Connect the openGym app on your phone to this account.',
  'FitNotes, Strong, Hevy, GymMane, openGym CSV, or body weight from Apple Health',
  'How do you want to use openGym?',
  'In this app: enter the code on your openGym site in a browser, then pair the app again from Settings → Account there.',
  'Local keeps everything on this phone. Connecting syncs to your own openGym server instead. You can switch later in Settings.',
  'Location isn’t allowed for openGym. You can change that in the phone’s settings.',
  'Made with openGym', 'Not an openGym answer (HTTP {0})', 'Notifications are off for openGym, so the reminder has nowhere to show up.',
  'On the openGym app, choose “Connect to my server”, then enter this address and the code below. It expires in 5 minutes.',
  'One row per set, for Excel, Sheets, your coach or another app. openGym reads it back too.',
  'Open Settings → Account → “Pair the mobile app” on the openGym site you’re already signed into, then enter its address and the code shown there.',
  'Open Settings → Account → “Pair the mobile app” on your openGym site in a browser and enter the new code shown there. What this phone kept is merged into your account.',
  'Open openGym for the next set', 'Precise location is off for openGym. Turn it on in the phone’s settings, or your gym can’t be spotted.',
  'Rate openGym on the App Store', 'Reload openGym', 'Rest-timer alerts, even if openGym is closed.', 'Runs on your openGym server',
  'Saves a dated copy to Documents/openGym after finishing a workout or editing a routine, and keeps the newest {0}. Point a sync app at that folder, or copy it out by hand.',
  'Scan this with the other device, or open openGym there and enter the code on the sign-in screen. It works once, for {0} minutes.',
  'Self-host openGym', 'Start a workout on the phone and openGym pops up on your wrist.', 'Support openGym',
  'Sync this device to your own self-hosted openGym instead.',
  'That address answers, but a login page or proxy rule replied instead of openGym. Let /api/ through to openGym unchanged. See “Phone app and CORS” in docs/SELF_HOSTING.md.',
  'That address answers, but it isn’t an openGym server. Check the URL.', 'That file isn’t an openGym backup.',
  'The phone itself watches the gyms you added and only wakes openGym when you arrive. No tracking in between, and your locations never leave this phone.',
  'The server answered with something other than openGym data.', 'The watch hasn’t checked in yet. Open openGym on it once.',
  "This browser doesn't do passkeys, but you can still use openGym locally on this device.",
  'This demo runs entirely in your browser on example data. Nothing is sent anywhere. Passkey sign-in and sync across your devices come with the openGym server, which you get by self-hosting it.',
  'This server only takes changes made at {0}. If you opened openGym at another address, whoever runs the server can set ORIGIN and RP_ID to match it (the self-hosting guide shows how).',
  'To answer, the Coach sends this through your openGym server to {0}, an AI service outside openGym that your server’s admin picked:',
  'To answer, this device sends this straight to {0}, an AI service outside openGym, with your API key:',
  'To notice that you walked into your gym while openGym is closed, the phone needs to let it see your location in the background.',
  'Update to openGym v{0}', 'Use my self-hosted openGym',
  'Walk into one of your gyms and openGym nudges you to hit Start. Once a day at most, and never when you already trained. Your gyms stay on this phone.',
  'Want a copy first? Export a backup. You can import it into openGym anytime.',
  'What openGym already wrote can stay in Apple Health as your data, or be removed from it.',
  'What openGym already wrote can stay in Health Connect as your data, or be removed from it.',
  'Whoever runs your openGym server can make you a recovery code in the admin dashboard. Enter it with “I have a code”, and this device gets a new passkey.',
  'Without background location the phone can’t spot your gym while openGym is closed.',
  'Your coach gives up control of this week: openGym owns the queue from here on and repeats these sessions by itself once they are all done. A new week from the coach’s app would replace this rotation.',
  'Your server was reached, but it refused the app’s request (CORS). If a reverse proxy such as Traefik adds CORS headers, let requests from {0} through to openGym unchanged. See “Phone app and CORS” in docs/SELF_HOSTING.md.',
  'Your server’s address answered with something other than openGym (HTTP {0}). Your changes are kept here.',
  'iPhone doesn’t let openGym vibrate. A sound or a flash does the job.',
  'openGym can no longer write to the chosen folder, so copies go to Documents/openGym again. Choose the folder again to switch back.',
  'openGym can no longer write to “{0}”, so copies go to Documents/openGym again. Choose the folder again to switch back.',
  'openGym can save every workout and weigh-in to Apple Health, and your Apple Watch can show your heart rate while you lift.',
  'openGym can tap you on the shoulder when a rest is over, even with the phone locked in your pocket.',
  'openGym is free: no ads, no subscriptions, no tracking. A coffee keeps it that way.', 'openGym is not on your Apple Watch yet. Install it in the Watch app.',
  'openGym is on your Apple Watch',
  'openGym reads only while it is open: heart rate for workouts of the last day, weigh-ins of the last 30 days. Older workouts stay as they are.',
  'openGym reads only while it is open: heart rate for workouts of the last day, weigh-ins of the last year. Older workouts stay as they are.',
  'this isn’t an openGym plan file', 'to install openGym as a full-screen app.'
])

// A slash-delimited value is a URL or a literal filesystem path. Those identifiers are not
// product prose, even when an allowed sentence contains both (Documents/openGym).
const technicalLiteral = /https?:\/\/[^\s<>"')\]]+|(?:[A-Za-z]:)?[\\/][^\s<>"')\]]+|[A-Za-z][\w.-]*[\\/][^\s<>"')\]]+|openGym/g

export function brandVisibleProductText(source, value) {
  if (!VISIBLE_BRAND_SOURCE_KEYS.has(source) || typeof value !== 'string') return value
  return value.replace(technicalLiteral, match => match === 'openGym' ? 'JohnGym' : match)
}
