# MCP Server 集成实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Hono 应用集成 MCP Server，支持 Streamable HTTP + stdio 双传输，暴露 tools/resources/prompts 示例能力。

**Architecture:** MCP 核心层（`src/mcp/server.ts`）框架无关，仅依赖 `@modelcontextprotocol/server`。Hono 入口（`src/index.ts`）通过 `transport.handleRequest(c.req.raw)` 对接标准 Web Request。stdio 入口（`src/stdio.ts`）独立运行供 Claude Desktop 使用。

**Tech Stack:** Bun, Hono 4.x, @modelcontextprotocol/server 2.x, Zod 4.x

**Spec:** docs/superpowers/specs/2026-09-03-mcp-server-design.md

## Global Constraints

- MCP SDK 版本：`@modelcontextprotocol/server` ^2.0.0
- Schema 库：`zod` ^4.x（使用 `zod/v4` import 路径）
- 传输协议：Streamable HTTP（无状态模式）+ stdio
- 运行时：Bun
- MCP 核心层不引入任何 Web 框架依赖

---

## File Structure

```
src/
  index.ts          # 修改：添加 Streamable HTTP MCP 端点 + DNS rebinding 防护
  stdio.ts          # 新建：stdio 传输入口
  mcp/
    server.ts       # 新建：McpServer 实例 + tools/resources/prompts 注册
```

---

### Task 1: 安装依赖

**Files:**
- Modify: `package.json`

**Interfaces:**
- Produces: `@modelcontextprotocol/server` 和 `zod` 可供 import

- [ ] **Step 1: 安装 MCP SDK 和 Zod**

```bash
bun add @modelcontextprotocol/server zod
```

- [ ] **Step 2: 验证安装成功**

```bash
bun pm ls
```

Expected: 输出包含 `@modelcontextprotocol/server` 和 `zod`

---

### Task 2: 创建 MCP Server 核心模块

**Files:**
- Create: `src/mcp/server.ts`

**Interfaces:**
- Consumes: `McpServer`, `ResourceTemplate` from `@modelcontextprotocol/server`; `z` from `zod/v4`
- Produces: `createMcpServer(): McpServer` — 返回已注册所有能力的 McpServer 实例

- [ ] **Step 1: 创建 `src/mcp/server.ts`**

```typescript
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/server'
import { z } from 'zod/v4'

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'mcp-hono',
    version: '1.0.0',
  })

  // ── Tools ──

  server.registerTool(
    'get-current-time',
    {
      description: '获取当前时间，可指定时区',
      inputSchema: z.object({
        timezone: z.string().optional().describe('IANA 时区名，如 Asia/Shanghai，默认 UTC'),
      }),
    },
    async ({ timezone }) => {
      const now = new Date()
      const formatted = now.toLocaleString('zh-CN', {
        timeZone: timezone || 'UTC',
        dateStyle: 'full',
        timeStyle: 'long',
      })
      return { content: [{ type: 'text', text: `当前时间：${formatted}` }] }
    },
  )

  server.registerTool(
    'calculate',
    {
      description: '计算数学表达式（支持加减乘除、括号、幂运算）',
      inputSchema: z.object({
        expression: z.string().describe('数学表达式，如 "(1+2)*3"'),
      }),
    },
    async ({ expression }) => {
      if (!/^[\d+\-*/().^%\s]+$/.test(expression)) {
        throw new Error('表达式包含非法字符')
      }
      const result = Function(`"use strict"; return (${expression})`)()
      return { content: [{ type: 'text', text: `${expression} = ${result}` }] }
    },
  )

  // ── Resources ──

  server.registerResource(
    'server-info',
    'app://server-info',
    {
      title: '服务器信息',
      description: '当前服务器运行状态信息',
      mimeType: 'application/json',
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(
            {
              name: 'mcp-hono',
              version: '1.0.0',
              uptime: process.uptime(),
              runtime: 'Bun',
              timestamp: new Date().toISOString(),
            },
            null,
            2,
          ),
        },
      ],
    }),
  )

  const notes = new Map<string, { title: string; content: string }>()
  notes.set('welcome', { title: '欢迎', content: '这是 MCP 笔记系统的示例笔记。' })

  server.registerResource(
    'note',
    new ResourceTemplate('app://notes/{noteId}', {
      list: async () => ({
        resources: [...notes.entries()].map(([id, note]) => ({
          uri: `app://notes/${id}`,
          name: note.title,
          mimeType: 'text/plain' as const,
        })),
      }),
    }),
    {
      title: '笔记',
      description: '内存笔记系统，通过 noteId 读取',
    },
    async (uri, { noteId }) => {
      const note = notes.get(noteId)
      if (!note) throw new Error(`笔记 ${noteId} 不存在`)
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'text/plain',
            text: `# ${note.title}\n\n${note.content}`,
          },
        ],
      }
    },
  )

  // ── Prompts ──

  server.registerPrompt(
    'summarize',
    {
      title: '文本摘要',
      description: '生成指定文本的摘要',
      argsSchema: z.object({
        text: z.string().describe('需要摘要的文本'),
        language: z.string().optional().describe('输出语言，默认中文'),
      }),
    },
    ({ text, language }) => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `请用${language || '中文'}对以下文本生成简明摘要：\n\n${text}`,
          },
        },
      ],
    }),
  )

  return server
}
```

- [ ] **Step 2: 验证模块可正常 import**

```bash
bun build src/mcp/server.ts --no-bundle 2>&1 | head -5
```

Expected: 无报错，输出编译信息

---

### Task 3: 创建 stdio 传输入口

**Files:**
- Create: `src/stdio.ts`

**Interfaces:**
- Consumes: `createMcpServer()` from `./mcp/server`; `StdioServerTransport` from `@modelcontextprotocol/server/stdio`

- [ ] **Step 1: 创建 `src/stdio.ts`**

```typescript
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio'
import { createMcpServer } from './mcp/server'

const server = createMcpServer()
const transport = new StdioServerTransport()
await server.connect(transport)
```

- [ ] **Step 2: 验证 stdio 入口可启动**

```bash
echo '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}},"id":1}' | timeout 3 bun run src/stdio.ts 2>/dev/null || true
```

Expected: 输出包含 `"result"` 和 `"serverInfo"` 的 JSON-RPC 响应

---

### Task 4: 更新 Hono HTTP 入口，添加 Streamable MCP 端点

**Files:**
- Modify: `src/index.ts`

**Interfaces:**
- Consumes: `createMcpServer()` from `./mcp/server`; `WebStandardStreamableHTTPServerTransport`, `hostHeaderValidationResponse`, `localhostAllowedHostnames` from `@modelcontextprotocol/server`
- Produces: `GET /` 保留原有路由；`ALL /mcp` MCP Streamable HTTP 端点

- [ ] **Step 1: 重写 `src/index.ts`**

```typescript
import { Hono } from 'hono'
import {
  WebStandardStreamableHTTPServerTransport,
  hostHeaderValidationResponse,
  localhostAllowedHostnames,
} from '@modelcontextprotocol/server'
import { createMcpServer } from './mcp/server'

const app = new Hono()

// DNS rebinding 防护中间件
app.use('/mcp', async (c, next) => {
  const errorResponse = hostHeaderValidationResponse(c.req.raw, localhostAllowedHostnames())
  if (errorResponse) return errorResponse
  await next()
})

// 创建 MCP Server 并连接 transport
const server = createMcpServer()
const transport = new WebStandardStreamableHTTPServerTransport({
  sessionIdGenerator: undefined, // 无状态模式
})
await server.connect(transport)

// 原有路由
app.get('/', (c) => c.text('Hello Hono!'))

// MCP Streamable HTTP 端点
// POST: 接收 JSON-RPC 消息
// GET: SSE 事件流
// DELETE: 结束 session
app.all('/mcp', async (c) => {
  return transport.handleRequest(c.req.raw)
})

export default app
```

- [ ] **Step 2: 启动开发服务器**

```bash
bun run dev &
sleep 2
```

Expected: 服务器启动在 `http://localhost:3000`，无报错

- [ ] **Step 3: 验证原有路由不受影响**

```bash
curl -s http://localhost:3000/
```

Expected: `Hello Hono!`

- [ ] **Step 4: 验证 MCP 初始化握手**

```bash
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}},"id":1}'
```

Expected: 返回包含 `serverInfo` 和 `capabilities`（含 `tools`、`resources`、`prompts`）的 JSON-RPC 响应

- [ ] **Step 5: 验证 tools/list**

```bash
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","method":"tools/list","params":{},"id":2}'
```

Expected: 返回包含 `get-current-time` 和 `calculate` 两个 tool 的列表

- [ ] **Step 6: 验证 tool 调用**

```bash
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"get-current-time","arguments":{"timezone":"Asia/Shanghai"}},"id":3}'
```

Expected: 返回包含当前北京时间的文本内容

- [ ] **Step 7: 验证 resources/list**

```bash
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","method":"resources/list","params":{},"id":4}'
```

Expected: 返回包含 `server-info` 和 `welcome` 笔记的 resource 列表

- [ ] **Step 8: 验证 prompts/list**

```bash
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","method":"prompts/list","params":{},"id":5}'
```

Expected: 返回包含 `summarize` prompt 的列表

- [ ] **Step 9: 验证 DNS rebinding 防护**

```bash
curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Host: evil.example.com" \
  -d '{"jsonrpc":"2.0","method":"initialize","params":{},"id":1}'
```

Expected: HTTP 403

- [ ] **Step 10: 停止开发服务器**

```bash
kill %1 2>/dev/null; pkill -f "bun run.*src/index.ts" 2>/dev/null; true
```

---

### Task 5: 添加便捷 npm scripts

**Files:**
- Modify: `package.json`

**Interfaces:**
- Produces: `bun run dev:stdio` 命令用于启动 stdio 模式

- [ ] **Step 1: 在 `package.json` 中添加 stdio 脚本**

在 `scripts` 中新增：

```json
{
  "scripts": {
    "dev": "bun run --hot src/index.ts",
    "dev:stdio": "bun run src/stdio.ts"
  }
}
```

- [ ] **Step 2: 验证 stdio 脚本可用**

```bash
echo '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}},"id":1}' | timeout 3 bun run dev:stdio 2>/dev/null || true
```

Expected: 输出包含 `serverInfo` 的 JSON-RPC 响应
