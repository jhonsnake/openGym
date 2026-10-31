# Personal-test web image with exercise media

The reusable default build is commercial-safe: it uses `BUILTIN_EXERCISE_MEDIA=0`, sets
`VITE_BUILTIN_EXERCISE_MEDIA=0`, and contains no `catalogue/media` files. It is not a
commercial licence grant for Gym visual media.

For the current personal, non-commercial trial only, build the explicit opt-in stage:

```bash
docker build -f web/Dockerfile --target personal-test \
  --build-arg BUILTIN_EXERCISE_MEDIA=1 \
  -t opengym-web:personal-test .
```

The personal-test image copies all 6,554 `clip/*.mp4`, all 6,554 `still/*.webp`, and
`catalogue/media/NOTICE.md` unchanged to `/usr/share/nginx/html/exercise-media/`, while
the root and media notices are also under `/usr/share/nginx/html/legal/`. These files are
for use inside openGym only: do not hotlink, extract, package independently, or feed them
to any AI system. This trial does not change roles, subscriptions, production deployment,
or licensing terms.

The explicit commercial/default build is:

```bash
docker build -f web/Dockerfile --target commercial \
  --build-arg BUILTIN_EXERCISE_MEDIA=0 \
  -t opengym-web:commercial .
```

The Dockerfile ends at `commercial`, so omitting `--target` remains commercial-safe. Each
stage rejects an inconsistent flag; the commercial stage also asserts that the media tree
is absent. Optional real-image verification is enabled with
`OPENGYM_PERSONAL_TEST_WEB_IMAGE=...` and compares every source-relative path and SHA-256.
Both variants were built and all six policy tests ran against real images:
zero failures and zero skips. Every one of the 13,109 source files (6,554 MP4,
6,554 WebP, and the media notice) matched its relative path and SHA-256 in the
personal-test image. Nginx returned HTTP 200 with the expected MP4/WebP MIME types;
root/media notices and the application licence matched their source hashes.
The separately built commercial image contained no exercise media. These are
packaging checks on the reviewed frontend baseline plus this recipe overlay,
not acceptance of the final functional MVP or a production deployment.
Verification uses file/HTTP metadata and hashes; no restricted media pixels
were supplied to a model.
