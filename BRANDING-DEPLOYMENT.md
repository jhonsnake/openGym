# JohnGym stable branding deployment

## Published release

- URL: https://gym.johnprada.co/#/home
- Source: `955d73fd41ebda7943dffd1ed5929ccef4d281c9`
- Public branch: https://github.com/jhonsnake/openGym/tree/branding/johngym-stable-hotfix
- Exact stable base: `7c8290ca20cb619bf6baa6830ea864d283df305a`.
- VPS: `40.160.140.50`, release directory `/opt/opengym/releases/johngym-955d73fd4`.
- Image tag: `johngym-web:955d73fd4`.
- Image ID: `sha256:62509a098c72bcdb5b523c28fc1966927ede5c42672fa50deec983f25e772120`.
- Release archive SHA-256: `c840e05b016a48d97bc5164f1657faf340ac03003ffb1da9ee78d96406b40d01`.
- Deployment changed only the web image in `/opt/opengym/compose.yaml`, followed by `docker compose up -d --no-deps web`.

## Verified result

Public index, manifest, service worker and both new icon URLs returned HTTP 200.
Browser inspection at the public URL showed the JohnGym wordmark, background `rgb(7, 0, 60)`, accent `#ffad2f`, and `johngym-v1-180.png` favicon.
The login retained passkey/device-code/recovery controls and no anonymous guest bypass.
The final local built application passed 100 tests across 10 affected suites, build, and both desktop/mobile navigation journeys including Home and Settings.

The full inherited suite was started before review fixes and overlapped those edits; it is not represented as an all-green acceptance gate. Its old source-link assertion failed during that overlap, while the final affected suite passed. The obsolete overlapping full run was stopped after the final focused gates passed; no complete-suite success is claimed. Logs are retained in ignored `frontend/artifacts/branding/`.

API health returned `{"ok":true,"users":1,"writable":true}`. Anonymous `/api/data` remained HTTP 401. Both production containers were healthy. API container ID `13eb14ccf6e3eb5b59af7661305ff15c842879880eec097bb3ad1724c2e0586d` and start time `2026-10-30T15:04:19.479790471Z` remained unchanged. No API restart, database migration, user-data write, or role change was performed.

Nginx configuration passed `nginx -t`; existing CSP script hash and trusted-proxy configuration remained in place. Image overlay preserved old hashed chunks, old icon paths for existing clients, and the existing exercise-media directory. New shell uses a new cache namespace and preserves offline media during migration.

Production passkey authentication and authenticated synchronization were not exercised: no user credential/session was available. Installed-PWA metadata refresh timing depends on the browser/OS; do not clear user storage to force an update.

## Coordination with the MVP

The MVP workspace `/home/jhonsnake/openGym` was not modified. Its owner acknowledged the deployment hold. Integrate the visual changes deliberately into the MVP, without replacing its functional changes or restoring the old product name. The fixed web palette is scoped to `data-web-branding="true"`; native picker behavior remains covered separately. Corresponding modified source links point to the public hotfix branch.

Production Compose now refers to a locally built image. Before a later MVP release, account for this image override and preserve its frontend identity. Do not replace production with the currently incomplete MVP simply to incorporate branding.

## Rollback

The exact previous Compose file is stored root-only at:
`/opt/opengym/releases/johngym-955d73fd4/compose.before.yaml`.

To roll back only this frontend change, first verify no newer release has changed the Compose file. Restore that saved file to `/opt/opengym/compose.yaml`, then run `docker compose up -d --no-deps web` from `/opt/opengym`. API and volumes remain untouched. Check public health, anonymous-data refusal and browser load. Do not clear browser localStorage/IndexedDB or unregister the PWA as a rollback shortcut.
