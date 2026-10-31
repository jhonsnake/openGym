# Personal-trial layered web image

`Dockerfile.layered-personal` is the exact layering recipe used for the deployed
JohnGym web image. It is not the commercial/media-free target.

Required local base:

- Tag: `johngym-web:7b96751ea`
- Image ID: `sha256:8618d956efa737a4807edc8842dd02a6f99b852d4130984535de745f40a9939f`

Verify that identity before building. A local image ID is not a downloadable
registry manifest digest. Keep the base image or its original verified export;
do not silently substitute an upstream image and lose old hashed chunks.

Build the frontend from source revision
`bf07b6ae69563d688364eb475fe66b2e2ab53672`, using its lockfile and:

```sh
VITE_BUILTIN_EXERCISE_MEDIA=1 VITE_MANAGED_SUBSCRIPTIONS_HINT=1 APP_BUILD=bf07b6ae6 npm run build
```

Run that command in `frontend`. Prepare a separate build context containing:

```text
dist/                         frontend/dist, all compiled public files
legal/NOTICE.md               repository NOTICE.md
legal/LICENSE                 repository LICENSE
legal/catalogue-media-NOTICE.md catalogue/media/NOTICE.md
media-notice/NOTICE.md         catalogue/media/NOTICE.md
```

Preserve readable file modes for nginx UID101; directories must be traversable.
Then run:

```sh
docker build --network none --pull=false -f web/Dockerfile.layered-personal -t johngym-web:mvp6705-stablebase /path/to/context
```

Do not delete the base image's assets before the overlay. The deployed acceptance
checked156 compiled files,259 retained old assets, all13,109 original media entries,
three legal notices, both inline CSP hashes, gzip and MP4 range206. Recheck those
contracts against a new build rather than assuming its image ID will match a
previous build. Both CSP hashes must match the built inline scripts; never relax
the policy to accommodate a different index.

The image retains the original exercise media under the personal/non-commercial
trial decision and existing notices. This recipe does not grant commercial media
rights or authorize standalone redistribution of the collection.
