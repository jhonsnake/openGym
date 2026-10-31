# JohnGym visible product text

## Scope

Visible UI product-name prose uses JohnGym after locale lookup and plural selection, before interpolation. Historical translation keys remain stable. An explicit reviewed source-key allowlist prevents arbitrary/user-originated strings from being rebranded. Literal URLs and filesystem paths within approved messages remain unchanged. Spanish and English browser journeys are covered.

Boot error text, nontranslated onboarding, printed document masthead and workout card footer also use JohnGym. Web About no longer shows upstream donation solicitations under the JohnGym name; legal attribution and corresponding source links remain available. Native donation controls are retained outside this web delivery.

Intentional exceptions: required license/media attribution, upstream URLs (including opengym.ch), technical filenames/paths, protocol identifiers, backups/storage keys and user-authored values. Backend RP_NAME and API responses are outside this frontend change. No API or database sources changed.

## Verification

- 163 focused tests in 11 suites passed: i18n core/plural, backup paths, CSP/boot, print/card, branding and SW.
- 40 additional Settings/search/reset tests in two suites passed after the About refinement.
- Final production build passed.
- Four desktop/mobile English/Spanish browser journeys passed after the final change.
- Donation identity browser regression first failed with the misleading Support JohnGym panel present, then passed after hiding upstream solicitations on web.
- Guest-mode local browser tests ran without an API and therefore logged refused API proxy connections; no production authentication claim follows from these tests.

Evidence is ignored under `frontend/artifacts/branding/`: `parent-text-tests.log`, `text-settings-tests.log`, `donation-identity-red.log`, `text-final-build.log`, `text-final-browser.log`.

## Deployment contract

Overlay the built frontend on the previous production JohnGym image through `PREVIOUS_WEB`, retaining prior hashed assets and media. Replace only web; preserve API, PASSWORD_LOGIN=1, invitation-only enrollment and disabled guest access.

The boot watchdog changed, so its sole script hash in the restrictive CSP is now `sha256-QOiIMyX3uUAAL4LoLjmHwCvDloAJOtGnR1EPIYBliVs=`. The Dockerfile updates the policy; do not deploy the changed inline script behind the old hash. No script unsafe-inline permission is added.

Verify public index/JS/manifest/icons and the served CSP, actual recovery text in the browser, unchanged API ID/start time, health and authentication configuration. Keep the previous Compose file for a selective web rollback.
