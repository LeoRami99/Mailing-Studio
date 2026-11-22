FROM node:22-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    MAILING_STORAGE_DIR=/data \
    MISIVA_SERVER_PROJECTS=1

RUN addgroup --system --gid 1001 misiva && adduser --system --uid 1001 --ingroup misiva misiva && mkdir -p /data && chown misiva:misiva /data
COPY --from=builder --chown=misiva:misiva /app/.next/standalone ./
COPY --from=builder --chown=misiva:misiva /app/.next/static ./.next/static
COPY --from=builder --chown=misiva:misiva /app/public ./public
USER misiva
EXPOSE 3000
VOLUME ["/data"]
CMD ["node", "server.js"]
