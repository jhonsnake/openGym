# JohnGym branding hotfix

## Scope and baseline

Implemented only in `/home/jhonsnake/openGym-branding-hotfix`, starting at
`7c8290ca20cb619bf6baa6830ea864d283df305a` (openGym 1.4.3). No access to the sibling
worktree, deployment, SSH, push, backend/data changes, or trainer/MVP features.
The current request supersedes the older branding brief's neutral-name and no-commit scope.

## Files and resources

- `frontend/src/branding.css`, `src/main.jsx`: shared dark/light/high-contrast palette,
  readable accent inks, focus outlines and typographic wordmark. Semantic status colors remain.
- `src/views/Login.jsx`, `Home.jsx`: JohnGym text identity; removed login dumbbell mark.
- `src/App.jsx`, `views/Settings.jsx`, `views/settings-pages.js`: fixed web brand accent,
  hidden web accent/seasonal-color pickers and search, retained theme and all other settings/navigation.
  Saved custom/seasonal accent fields remain intact for compatible clients.
- `src/lib/demo.js`, `views/Settings.jsx`: modified-app source offer points to
  `https://github.com/jhonsnake/openGym/tree/branding/johngym-stable-hotfix`; upstream license
  and exercise-media notices remain.
- `frontend/index.html`: title, install metadata, favicon and text-only boot screen.
  Inline script is byte-identical to baseline, retaining the existing CSP hash.
- `frontend/public/manifest.json`: JohnGym install identity and new icon URLs.
- Removed `public/icon-180.png` and `public/icon-512.png`; replaced with original
  `public/johngym-v1-180.png` and `public/johngym-v1-512.png`.
  `scripts/branding-icons.mjs` reproduces the JG block-letter artwork through the existing
  dependency-free PNG renderer. The 512px mark fits the maskable safe area.
- `public/sw.js`, `src/store/useUI.js`: new notification icons and shell namespace.
  Build hash stamping remains. Activation migrates cached exercise media before deleting
  recognized obsolete `opengym-rt-*` / `johngym-shell-*` shell caches, and only after the
  replacement shell is complete. A failed media copy retains its old cache. Unrelated caches, persistent media, push device identity,
  localStorage, IndexedDB and drafts are not deleted. No claim to erase downloaded bytes.
- Regression coverage: `src/branding.test.js`, `src/views/Settings.{accent,themes,reset}.test.jsx`,
  `src/lib/{boot-watchdog,sw,sw-media,sw-lazy}.test.js`.
- Browser setup: `package.json`, `package-lock.json`, `vite.config.js`,
  `playwright.config.js`, `e2e/branding.spec.js`, `artifacts/.gitignore`.
  Exact `@playwright/test@1.64.1`; Chromium desktop/mobile; real built app with no request mocks;
  screenshots and retained traces on failure. Vitest excludes browser specs.

## Palette evidence and design

Evidence: supplied read-only `branding-brief.txt` records the public page
`https://eponasalud.com/entrena/login.php` and its verified inline palette. No independent
live-page reinspection was needed. Only color values were used; no EPONA code, name,
logo, imagery, fonts or layout was copied.

| Evidence value | JohnGym use |
| --- | --- |
| `#07003c` | Dark page, button ink and PWA chrome |
| `#14007d` | Elevated background; light-mode accent |
| `#210d67` | Nested dark surface; light secondary ink |
| `#1d0b6b` | Dark cards |
| `#ffad2f` | Dark actions, wordmark and icon letters |
| `#ffffff` | Dark primary text; light background/button ink |
| `#c3bce8` | Dark secondary text; light separators |
| `#3d2c8f` | Dark borders/control surfaces; light secondary ink |

Light mode uses white and brand violet for legible action text; system mode follows the OS.
Success/error colors retain their semantic distinction. Native launcher artwork is outside
this web hotfix and remains unchanged. Existing upstream product references in explanatory,
authentication, compatibility and support text remain; this is not a global string rename.
The CSP-authorized watchdog retains upstream openGym error wording to preserve its hash.

## Validation and artifacts

- Initial focused red run: new identity and unrelated-cache preservation checks failed as
  expected; existing baseline checks passed. Separate red/green tests reproduced and fixed
  failed offline-media migration and the unavailable seasonal-color control.
- Initial focused verification: 10 files / 59 tests passed (`focused.log`).
- Final expanded targeted run: 100 passed, one 5-second timeout in
  `settings-pages.test.jsx > searchSettings > finds the translated choices of a row, and words
  of its own language`. An isolated rerun passed without code/test changes (3.65s test time),
  consistent with resource contention. The unchanged full-file rerun passed all 34 tests
  (`settings-pages-recheck.log`).
- Modified source offer / reset, demo seed and CSP checks: 3 files / 22 tests passed
  (`source-offer.log`). Final migration checks: 2 files / 23 tests passed (`migration-green.log`).
- Final `npm run build`: exit 0, 26.87s (`build.log`). Existing ineffective-dynamic-import and
  plugin-timing advisories remain. Built SW namespace: `johngym-shell-d7b68f30c2`.
- Final Chromium desktop/mobile: 2 tests passed, no page errors; `browser.log`.
  Actual Vite proxy requests to `/api/config` and `/api/me` returned connection refusals with
  no backend running. Guest operation passed; real authenticated operation was not exercised.
- `playwright test --list`: 2 real tests across the desktop/mobile projects (`browser-list.log`).
  `playwright install chromium` reused the available Chromium revision 1248.
- Verified identical CSP inline-script bytes, deterministic PNG regeneration, built manifest
  icon existence, removed old icon files, and complete SW placeholder stamping. `git diff --check`
  passed. Baseline and post-install npm audits both reported 4 existing dependency findings
  (3 moderate, 1 high); dependency upgrades were outside this branding hotfix. A lockfile comparison confirmed
  every existing package version unchanged; only the three pinned Playwright packages were added.

All logs/evidence below are local, ignored working artifacts under
`frontend/artifacts/branding/` (not committed binaries):

- `red.log`, `migration-red.log`, `migration-green.log`, `seasonal-red.log`, `focused.log`,
  `final-focused.log`, `source-offer.log`, `settings-search-recheck.log`,
  `settings-pages-recheck.log`, `full-tests.log`, `build.log`, `browser.log` and browser setup logs.
- Screenshots: `browser/branding-JohnGym-login-gue-e9542-preferences-and-light-theme-chromium-desktop/`
  and the corresponding `chromium-mobile/` directory, each containing `login.png`,
  `home-dark.png`, `settings-light.png`. Login/mobile and settings/desktop images were visually
  inspected; no clipping or illegible wordmark observed.
- Deployable tree: `frontend/dist/`. Static-only archive:
  `frontend/artifacts/branding/johngym-frontend.tar.gz` (5.0 MiB), SHA-256
  `de9aab0372ded09aa310961ed4630898ee3a824589226ec6f2bf2ad7d42b485c`;
  matching `.sha256` file beside it. Exercise media are deliberately not included.
- Full frontend suite: pending completion of `npm test -- --maxWorkers=2`.

Remaining verification: independent parent review and real deployment/authentication/PWA update
checks. Browser metadata refresh timing and the preserved upstream watchdog wording are described
above; no training/backend functionality has been added.

## Bounded review correction evidence (2026-10-30)

- `branding.css` now uses static Safari 15.5-compatible `rgba()` alpha values (no `color-mix()`)
  and every JohnGym token, wordmark, focus outline and contrast override is scoped under the
  `data-web-branding="true"` document root. `main.jsx` sets that marker only when `MOBILE` is
  false, before React mounts; the native bundle therefore retains its existing palette.
- Restored the original substantive Accent picker coverage in
  `src/views/Settings.accent.native.test.jsx` with `MOBILE: true`: input/change flow, debounce,
  close-time commit, presets, contrast notes, validation and native accent injection. The separate
  web no-picker checks remain in `Settings.accent.test.jsx`.
- The Settings footer and `demo.js` `REPO` constant now use the exact branch source offer above;
  the source-code browser assertion was updated too. AGPL wording and upstream notices remain.
- Fresh focused Vitest: `src/branding.test.js`, `Settings.reset.test.jsx` and web
  `Settings.accent.test.jsx` — 14 passed; native Accent suite — 10 passed (each run with one
  worker). Fresh `npm run build` exited 0. The desktop branding browser case passed; a fresh
  one-worker Chromium mobile run passed 1/1, including the exact source-link assertion. Expected
  guest-mode `/api/config` and `/api/me` proxy connection refusals occurred because no API was
  running. The parent-owned full Vitest run was not stopped or claimed complete.

## Final focused acceptance

The final corrected working tree passed 100 tests in 10 affected suites, its production build,
and both Chromium desktop/mobile journeys. Evidence: `parent-final-focused.log`,
`parent-final-build.log`, `parent-final-browser.log` under the ignored artifacts directory.
The full inherited suite is not a green acceptance claim: it was launched before the bounded
review fixes and overlaps their file changes. Its source-link assertion was subsequently
rerun successfully in the final focused suite. No API/backend sources changed.

`branding-web.Dockerfile` overlays only the final frontend on the exact production image,
retaining existing hashed chunks and exercise media. The inline script retains the existing
CSP hash. Deployment must recreate only the `web` service with `--no-deps`, retain a copy
of the previous Compose file, and verify the API container ID/start time are unchanged.

## Publish instructions (for operator; not performed)

1. Independently review this commit, then push the matching modified sources to the source-offer
   repository before publishing binaries (AGPL). Do not publish from the dirty sibling worktree.
2. In this worktree: `cd frontend && npm ci && npm test -- --maxWorkers=2 && npm run build`.
   `npm run test:e2e` checks the built output. `dist/` is the deployable static frontend.
   Save the existing frontend artifact and its commit/image digest before any replacement.
3. Stage the complete new `dist/` with the deployment's existing exercise-media files/mount.
   Replace only `/usr/share/nginx/html` frontend files in the existing web runtime, using its
   existing build/release mechanism or a derived image pinned to the currently deployed web
   image digest. Retain old hashed chunks during the transition for open clients. Keep API,
   volumes, environment, nginx template, entrypoint, proxy settings, TLS, security headers and
   CSP unchanged. Do not recreate the API or run a blanket compose build/up. The repository's
   general web Dockerfile upgrades runtime packages, so it is not required for this static-only
   replacement. Never delete `exercise-media/` while replacing the frontend tree.
4. Serve the new `index.html`, manifest and `sw.js` with the existing revalidation policy;
   retain immutable caching for hashed assets. Verify `/api/health`, real sign-in and sync,
   exercise media, root/subpath navigation, and guest data on the actual target. Check an
   installed PWA online, after update and offline. Login/guest browser evidence here does not
   validate production authentication or the target's security/proxy configuration.
5. Browser/OS favicon and installed-PWA metadata refresh timing is platform-controlled; some
   installations may need a relaunch or reinstall. Do not clear site storage to force branding.

## Rollback instructions

Restore the saved frontend artifact on the same web runtime, retaining exercise media,
nginx/proxy/security configuration, API and all data volumes. The old service worker will
be served again; return online and reload to let its normal lifecycle take over. Do not
unregister workers or clear browser data/caches as a rollback procedure. The baseline worker
has broader cache cleanup than this hotfix, so prefer a rebuilt baseline frontend retaining
the hotfix's scoped cleanup if unrelated application caches share this origin. Recheck real
sign-in, sync and offline opening after rollback. No database migration or data restore is needed.
