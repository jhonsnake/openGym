# Overlay only the frontend onto the exact stable runtime already deployed.
# Existing hashed chunks and exercise media remain for open clients.
ARG PREVIOUS_WEB=ghcr.io/duartesantos8/opengym-web:1.4.3@sha256:e77ef879d10549acc88a888e0cd4d566592c5680bee6436b05071678fcf8b512
FROM ${PREVIOUS_WEB}
ARG SOURCE_REVISION
LABEL org.opencontainers.image.title="JohnGym" \
      org.opencontainers.image.source="https://github.com/jhonsnake/openGym" \
      org.opencontainers.image.revision="${SOURCE_REVISION}"
COPY frontend/dist/ /usr/share/nginx/html/

# Keep the inherited restrictive policy while authorizing the branded boot watchdog.
ENV CONTENT_SECURITY_POLICY="default-src 'self'; script-src 'self' 'sha256-QOiIMyX3uUAAL4LoLjmHwCvDloAJOtGnR1EPIYBliVs='; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; media-src 'self' blob: https:; font-src 'self' data:; connect-src 'self' https: http:; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
