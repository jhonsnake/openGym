# Overlay only the frontend onto the exact stable runtime already deployed.
# Existing hashed chunks and exercise media remain for open clients.
FROM ghcr.io/duartesantos8/opengym-web:1.4.3@sha256:e77ef879d10549acc88a888e0cd4d566592c5680bee6436b05071678fcf8b512
ARG SOURCE_REVISION
LABEL org.opencontainers.image.title="JohnGym" \
      org.opencontainers.image.source="https://github.com/jhonsnake/openGym" \
      org.opencontainers.image.revision="${SOURCE_REVISION}"
COPY frontend/dist/ /usr/share/nginx/html/
