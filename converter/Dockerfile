# AquaScheme DXF -> DWG converter (ODA File Converter, headless).
# The ODA File Converter is a free GUI tool from the Open Design Alliance; it
# runs headless under a virtual X server (xvfb).
FROM node:20-bookworm-slim

# Runtime libraries the ODA File Converter needs, plus a virtual display.
RUN apt-get update && apt-get install -y --no-install-recommends \
    xvfb xauth libxcb1 libxcb-util1 libxcb-cursor0 libxcb-icccm4 \
    libxcb-image0 libxcb-keysyms1 libxcb-render-util0 libxcb-xinerama0 \
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
RUN if [ -n "$ODA_DEB_URL" ]; then \
      wget -q "$ODA_DEB_URL" -O /tmp/oda.deb && \
      (dpkg -i /tmp/oda.deb || apt-get install -y -f) && rm /tmp/oda.deb ; \
    else echo "ODA_DEB_URL not set: build the image with the converter URL"; fi

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY src ./src

ENV ODA_CONVERTER_PATH="xvfb-run -a ODAFileConverter"
ENV QT_DEBUG_PLUGINS=1
ENV PORT=8080
EXPOSE 8080
CMD ["npm", "start"]
