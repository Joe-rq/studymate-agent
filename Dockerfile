# ── 构建后端 ─────────────────────────────────────────────────────
FROM node:20-alpine AS backend
WORKDIR /app
COPY package.json ./
COPY tsconfig.json ./
COPY src ./src
RUN npm install --no-audit --no-fund && npm run build

# ── 构建前端 ─────────────────────────────────────────────────────
FROM node:20-alpine AS web
WORKDIR /app/web
COPY web/package.json ./
COPY web/ ./
RUN npm install --no-audit --no-fund && npm run build

# ── 运行时 ───────────────────────────────────────────────────────
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# 后端编译产物与依赖
COPY --from=backend /app/dist ./dist
COPY --from=backend /app/node_modules ./node_modules
COPY --from=backend /app/package.json ./

# 运行时读取的角色与提示词源文件
COPY --from=backend /app/src/characters ./src/characters
COPY --from=backend /app/src/prompts ./src/prompts

# 前端静态构建
COPY --from=web /app/web/dist ./web/dist

EXPOSE 3456
CMD ["node", "dist/server/index.js"]
