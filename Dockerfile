FROM node:20-alpine AS base

WORKDIR /app

COPY package.json package-lock.json* ./

FROM base AS development
ENV NODE_ENV=development
RUN npm ci
COPY . .
EXPOSE 4000
CMD ["npm", "run", "dev"]

FROM base AS dependencies
ENV NODE_ENV=production
RUN npm ci --omit=dev

FROM node:20-alpine AS production
ENV NODE_ENV=production
ENV PRODUCTION=true
WORKDIR /app

COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json package-lock.json* ./
COPY . .

RUN npm run check

EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT:-4000}/health || exit 1

CMD ["npm", "start"]
