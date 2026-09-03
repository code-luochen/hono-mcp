# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 常用命令

```bash
# 安装依赖
bun install

# 启动开发服务器（热重载）
bun run dev
```

开发服务器默认运行在 http://localhost:3000

## 技术栈

- **Runtime**: Bun（同时作为包管理器和运行时）
- **Web Framework**: Hono 4.x（轻量级 Web 框架）
- **语言**: TypeScript（strict 模式）
- **JSX**: 使用 `hono/jsx` 作为 JSX Import Source（配置在 tsconfig.json）

## 项目结构

```
src/
  index.ts    # 应用入口，Hono app 实例定义和路由
```

这是一个精简的 starter 项目，所有路由和逻辑目前集中在 `src/index.ts`。随着项目增长，可考虑拆分路由、中间件和业务逻辑到独立模块。
