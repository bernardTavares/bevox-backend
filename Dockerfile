# syntax=docker/dockerfile:1.7

# ============================================================================
# Stage 1 — deps: instala todas as dependências (prod + dev) usando pnpm.
# ============================================================================
FROM node:22-alpine AS deps
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15.1 --activate

COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# ============================================================================
# Stage 2 — builder: compila TypeScript -> dist/.
# Inclui db/ no contexto porque os imports `@db/*` precisam estar visíveis
# para o type-checker (não basta src/).
# ============================================================================
FROM node:22-alpine AS builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15.1 --activate

COPY --from=deps /app/node_modules ./node_modules
COPY package.json pnpm-lock.yaml tsconfig.json tsconfig.build.json tsconfig.db.json ./
COPY src ./src
COPY db ./db
COPY scripts ./scripts

RUN pnpm build

# ============================================================================
# Stage 3 — prod-deps: dependências apenas de produção.
# ============================================================================
FROM node:22-alpine AS prod-deps
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15.1 --activate

COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --prod

# ============================================================================
# Stage 4 — migrator: imagem one-shot para rodar `pnpm migrate:up` em Job k8s.
# Inclui scripts/, db/migrations e dev deps (tsx, drizzle-orm). Não é a imagem
# de runtime — usar tag dedicada (ex.: ghcr.io/bevox/bevox-backend:migrator-<sha>).
# ============================================================================
FROM node:22-alpine AS migrator
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15.1 --activate \
    && addgroup -g 1001 -S nodejs \
    && adduser -S -u 1001 -G nodejs bevox

ENV NODE_ENV=production

COPY --from=deps  --chown=bevox:nodejs /app/node_modules ./node_modules
COPY --chown=bevox:nodejs package.json pnpm-lock.yaml tsconfig.json ./
COPY --chown=bevox:nodejs scripts ./scripts
COPY --chown=bevox:nodejs db ./db
# src/ é necessário para resolver os path-aliases (`@/db/*`, `@/plugins/*`,
# `@/shared/*`) usados por `seed.ts`, `seed-pilot.ts`, `check-env.ts` e
# `bootstrap-meta-api-tenants.ts` quando rodados via tsx. tsx resolve
# aliases corretamente quando o diretório-alvo existe; sem src/ no
# migrator, `tsx scripts/seed-pilot.ts` falha em prod com
# `ERR_MODULE_NOT_FOUND`. Ver auditoria 2026-06-02 CRÍT #2.
COPY --chown=bevox:nodejs src ./src

USER bevox

CMD ["pnpm", "migrate:up"]

# ============================================================================
# Stage 5 — runtime: imagem final.
#
# O build TS gera dist/ + tsc-alias resolve os path-alias (`@/*`, `@db/*`)
# para caminhos relativos, então o runtime roda direto em `node dist/`
# (sem tsx). Usa prod-deps (sem dev deps).
# ============================================================================
FROM node:22-alpine AS runtime
WORKDIR /app

# wget para HEALTHCHECK; node:22-alpine não inclui curl.
RUN apk add --no-cache wget tini \
    && addgroup -g 1001 -S nodejs \
    && adduser -S -u 1001 -G nodejs bevox

ENV NODE_ENV=production \
    PORT=3000

COPY --from=prod-deps --chown=bevox:nodejs /app/node_modules ./node_modules
COPY --from=builder   --chown=bevox:nodejs /app/dist ./dist
COPY --chown=bevox:nodejs package.json pnpm-lock.yaml ./
# OpenAPI spec é carregado por @fastify/swagger em mode static no boot.
# Path resolved via fileURLToPath em src/bootstrap/openapi-docs.ts → openapi/bevox-backend-v1.yaml.
COPY --chown=bevox:nodejs openapi/bevox-backend-v1.yaml ./openapi/bevox-backend-v1.yaml

USER bevox

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD wget --quiet --spider http://localhost:3000/healthz || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
