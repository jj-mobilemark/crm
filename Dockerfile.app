# Next.js app — Bun runtime (Railpack does not auto-detect Bun).
# API_URL / APP_URL must be set as Railway variables so they are available
# at build time (inlined into the browser bundle).
FROM oven/bun:1.3

WORKDIR /app

COPY package.json bun.lock turbo.json ./
COPY apps ./apps
COPY packages ./packages

RUN bun install --frozen-lockfile \
	&& bunx turbo run build --filter=app

ENV NODE_ENV=production
EXPOSE 3000

CMD ["bun", "run", "--filter", "app", "start"]
