FROM node:20-slim

# Install ffmpeg for voice + cloudflared for tunnel + Playwright system deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg curl ca-certificates \
    # Playwright Chromium dependencies
    libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
    libdbus-1-3 libxkbcommon0 libatspi2.0-0 libxcomposite1 libxdamage1 \
    libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2 \
    fonts-liberation fonts-noto-color-emoji && \
    ARCH=$(dpkg --print-architecture) && \
    curl -L "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${ARCH}.deb" -o /tmp/cloudflared.deb && \
    dpkg -i /tmp/cloudflared.deb && \
    rm /tmp/cloudflared.deb && \
    apt-get remove -y curl && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

# Install Playwright Chromium browser (skip other browsers)
RUN npx playwright install chromium

COPY *.js .
COPY dashboard.html .

ENV NODE_ENV=production
CMD ["node", "index.js"]
