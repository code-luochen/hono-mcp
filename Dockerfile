# ---- 构建阶段 ----
FROM oven/bun:1 AS builder

WORKDIR /app

# 先复制依赖描述文件，利用 Docker 缓存层
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# 复制源代码
COPY src ./src
COPY tsconfig.json ./

# ---- 运行阶段 ----
FROM oven/bun:1-slim

WORKDIR /app

# 从构建阶段复制已安装的依赖和源代码
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/src ./src
COPY --from=builder /app/tsconfig.json ./tsconfig.json

# Hono 默认端口
EXPOSE 3000

# 启动应用
CMD ["bun", "run", "src/index.ts"]
