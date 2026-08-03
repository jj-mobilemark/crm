# Next.js app — Bun runtime (Railpack does not auto-detect Bun).
# API_URL / APP_URL must be set as Railway variables. Dockerfile builds only
# receive them when declared as ARG (then ENV) — otherwise Next inlines the
# localhost fallback into the browser bundle and Microsoft sign-in CORS-fails.
FROM oven/bun:1.3

WORKDIR /app

COPY package.json bun.lock turbo.json ./
COPY apps ./apps
COPY packages ./packages

# prisma generate (postinstall) reads DATABASE_URL from prisma.config.ts —
# only needed at build time for client generation, not a real connection.
ENV DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/crm?schema=public"

# Railway passes matching service variables as --build-arg.
ARG API_URL
ARG APP_URL
ARG NEXT_PUBLIC_API_URL
ENV API_URL=$API_URL
ENV APP_URL=$APP_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL:-$API_URL}

RUN bun install --frozen-lockfile \
	&& bunx turbo run build --filter=app

ENV NODE_ENV=production
EXPOSE 3000

CMD ["bun", "run", "--cwd", "apps/app", "start"]
