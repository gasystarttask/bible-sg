FROM node:22.22.2-alpine3.23 AS deps
WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

RUN apk upgrade --no-cache

COPY package.json package-lock.json ./
RUN npm ci


FROM node:22.22.2-alpine3.23 AS builder
WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1
ARG NEXT_BUILD_AI_VALUE=dummy
ARG NEXT_BUILD_DB_URI=mongodb://127.0.0.1:27017/bible_sg

RUN apk upgrade --no-cache

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN OPENAI_API_KEY=$NEXT_BUILD_AI_VALUE DATABASE_URL=$NEXT_BUILD_DB_URI npm run build \
	&& npm prune --omit=dev


FROM node:22.22.2-alpine3.23 AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN apk upgrade --no-cache

RUN addgroup -S nodejs && adduser -S nextjs -G nodejs

COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules

USER nextjs

EXPOSE 3000

CMD ["npm", "run", "start"]
