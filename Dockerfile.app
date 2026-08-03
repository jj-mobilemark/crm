# Next.js app — Bun runtime (Railpack does not auto-detect Bun).
# API_URL / APP_URL must be set as Railway variables so they are available
# at build time (inlined into the browser bundle).
FROM oven/bun:1.3

WORKDIR /app

COPY package.json bun.lock turbo.json ./
COPY apps ./apps
COPY packages ./packages

# prisma generate (postinstall) reads DATABASE_URL from prisma.config.ts —
# only needed at build time for client generation, not a real connection.
ENV DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/crm?schema=public"

RUN bun install --frozen-lockfile \
	&& bunx turbo run build --filter=app

ENV NODE_ENV=production
EXPOSE 3000

CMD ["bun", "run", "--filter", "app", "start"]
