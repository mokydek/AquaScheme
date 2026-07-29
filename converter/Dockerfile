# AquaScheme DXF -> DWG converter (ODA File Converter, headless).
# The ODA File Converter is a free GUI tool from the Open Design Alliance; it
# runs headless under a virtual X server (xvfb).
FROM node:20-bookworm-slim

# Runtime libraries the ODA File Converter needs, plus a virtual display.
RUN apt-get update && apt-get install -y --no-install-recommends \
    xvfb xauth libxcb1 libxcb-util1 libxcb-cursor0 libxcb-icccm4 \
    libxcb-image0 libxcb-keysyms1 libxcb-render-util0 libxcb-xinerama0 \
    libxcb-shape0 libxcb-randr0 libxcb-sync1 libxcb-xfixes0 libxcb-shm0 \
    libxcb-render0 libxcb-glx0 libx11-xcb1 \
    libxkbcommon0 libxkbcommon-x11-0 libx11-6 libxext6 libxrender1 \
    libsm6 libice6 libgl1 libegl1 libfontconfig1 libdbus-1-3 \
    ca-certificates wget \
  && ln -sf /usr/lib/x86_64-linux-gnu/libxcb-util.so.1 \
      /usr/lib/x86_64-linux-gnu/libxcb-util.so.0 \
  && rm -rf /var/lib/apt/lists/*

# Install the ODA File Converter .deb. Provide the URL at build time:
#   docker build --build-arg ODA_DEB_URL="https://.../ODAFileConverter_...deb" .
# The download requires accepting the ODA license; get the current link from
# https://www.opendesign.com/guestfiles/oda_file_converter
ARG ODA_DEB_URL=""
ARG ODA_DEB_SHA256=""
# Verified 2026-07-29 for ODAFileConverter_QT6_lnxX64_8.3dll_27.1.deb.
# A caller can override it with ODA_DEB_SHA256 when selecting another package;
# if the URL changes without a matching override, sha256sum stops the build.
RUN set -eu; \
    if [ -z "$ODA_DEB_URL" ]; then \
      echo "ODA_DEB_URL is required; refusing to publish a non-working converter image" >&2; \
      exit 1; \
    fi; \
    expected_sha="${ODA_DEB_SHA256:-c71363cd54758177af47a365154f180dc50a1e2b52a131994fda541c13a36766}"; \
    if ! printf '%s' "$expected_sha" | grep -Eq '^[0-9a-fA-F]{64}$'; then \
      echo "ODA_DEB_SHA256 must contain exactly 64 hexadecimal characters" >&2; \
      exit 1; \
    fi; \
    wget -q "$ODA_DEB_URL" -O /tmp/oda.deb && \
    echo "$expected_sha  /tmp/oda.deb" | sha256sum -c - && \
    (dpkg -i /tmp/oda.deb || apt-get install -y -f) && rm /tmp/oda.deb

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --chown=node:node src ./src

ENV ODA_CONVERTER_PATH="xvfb-run -a ODAFileConverter"
ENV NODE_ENV=production
ENV ALLOWED_ORIGINS="https://aqua-scheme-theta.vercel.app"
ENV ALLOWED_VERCEL_PREVIEWS="aqua-scheme:mokydeks-projects"
ENV ALLOW_LOCALHOST=false
ENV PORT=8080
EXPOSE 8080
USER node
CMD ["npm", "start"]
