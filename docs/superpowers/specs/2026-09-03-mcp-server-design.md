# MCP Server 集成设计文档

## 概述

为 Hono 应用集成 MCP（Model Context Protocol）Server 能力，使其能被 Claude Desktop、Cursor 等 MCP Client 调用。仅依赖官方 `@modelcontextprotocol/server` SDK，**不引入任何框架专用适配器**，MCP 核心层完全框架无关。同时支持 **Streamable HTTP** 和 **stdio** 两种传输方式。

## 技术选型

| 项目 | 选择 | 理由 |
|------|------|------|
| MCP SDK | `@modelcontextprotocol/server` v2 | 官方维护，支持 MCP 2026-07-28 spec，框架无关 |
| Schema 验证 | `zod` v4 | MCP SDK 要求 Standard Schema，Zod v4 是首选 |
| HTTP 传输 | Streamable HTTP | 适合远程部署，与 Hono 天然契合 |
| 本地传输 | stdio | 适合 Claude Desktop 等本地客户端 |

## 架构

```
┌──────────────────────────────────────────────────┐
│                 MCP Server 核心层                  │
│         (McpServer + Tools/Resources/Prompts)      │
│                   共享同一套能力定义                 │
└────────────┬─────────────────────┬────────────────┘
             │                     │
    ┌────────▼────────┐   ┌───────▼────────────────┐
    │   stdio 模式     │   │  Streamable HTTP 模式   │
    │                 │   │                        │
    │  src/stdio.ts   │   │  src/index.ts (Hono)   │
    │  StdioServer    │   │  ALL /mcp 端点          │
    │  Transport      │   │  + DNS rebinding 防护   │
    └────────┬────────┘   └───────┬────────────────┘
             │                     │
      stdin/stdout          HTTP (POST/GET/DELETE)
             │                     │
    Claude Desktop         Cursor / 远程 Client
```

## 文件结构

```
src/
  index.ts          # Hono HTTP 入口 + Streamable HTTP MCP 端点
  stdio.ts          # stdio 传输入口（供 Claude Desktop 使用）
  mcp/
    server.ts       # McpServer 实例创建 + 注册 tools/resources/prompts
```

## MCP 能力定义

### Tools

#### `get-current-time`

返回当前时间，支持指定时区。

```typescript
server.registerTool(
  'get-current-time',
  {
    description: '获取当前时间，可指定时区',
    inputSchema: z.object({
      timezone: z.string().optional().describe('IANA 时区名，如 Asia/Shanghai，默认 UTC')
    })
  },
  async ({ timezone }) => {
    const now = new Date()
    const formatted = now.toLocaleString('zh-CN', {
      timeZone: timezone || 'UTC',
      dateStyle: 'full',
      timeStyle: 'long'
    })
    return { content: [{ type: 'text', text: `当前时间：${formatted}` }] }
  }
)
```

#### `calculate`

安全的数学表达式计算（使用 `Function` 构造器，仅允许数字和基本运算符）。

```typescript
server.registerTool(
  'calculate',
  {
    description: '计算数学表达式（支持加减乘除、括号、幂运算）',
    inputSchema: z.object({
      expression: z.string().describe('数学表达式，如 "(1+2)*3"')
    })
  },
  async ({ expression }) => {
    // 安全校验：仅允许数字、运算符、括号、小数点、空格
    if (!/^[\d+\-*/().^%\s]+$/.test(expression)) {
      throw new Error('表达式包含非法字符')
    }
    const result = Function(`"use strict"; return (${expression})`)()
    return { content: [{ type: 'text', text: `${expression} = ${result}` }] }
  }
)
```

### Resources

#### `app://server-info`（静态 Resource）

```typescript
server.registerResource(
  'server-info',
  'app://server-info',
  {
    title: '服务器信息',
    description: '当前服务器运行状态信息',
    mimeType: 'application/json'
  },
  async (uri) => ({
    contents: [{
      uri: uri.href,
      mimeType: 'application/json',
      text: JSON.stringify({
        name: 'mcp-hono',
        version: '1.0.0',
        uptime: process.uptime(),
        runtime: 'Bun',
        timestamp: new Date().toISOString()
      }, null, 2)
    }]
  })
)
```

#### `app://notes/{noteId}`（Resource Template）

内存笔记系统，演示动态 Resource。

```typescript
import { ResourceTemplate } from '@modelcontextprotocol/server'

const notes = new Map<string, { title: string; content: string }>()

server.registerResource(
  'note',
  new ResourceTemplate('app://notes/{noteId}', {
    list: async () => ({
      resources: [...notes.entries()].map(([id, note]) => ({
        uri: `app://notes/${id}`,
        name: note.title,
        mimeType: 'text/plain' as const
      }))
    })
  }),
  {
    title: '笔记',
    description: '内存笔记系统，通过 noteId 读取'
  },
  async (uri, { noteId }) => {
    const note = notes.get(noteId)
    if (!note) throw new Error(`笔记 ${noteId} 不存在`)
    return {
      contents: [{
        uri: uri.href,
        mimeType: 'text/plain',
        text: `# ${note.title}\n\n${note.content}`
      }]
    }
  }
)
```

### Prompts

#### `summarize`

```typescript
server.registerPrompt(
  'summarize',
  {
    title: '文本摘要',
    description: '生成指定文本的摘要',
    argsSchema: z.object({
      text: z.string().describe('需要摘要的文本'),
      language: z.string().optional().describe('输出语言，默认中文')
    })
  },
  ({ text, language }) => ({
    messages: [{
      role: 'user' as const,
      content: {
        type: 'text' as const,
        text: `请用${language || '中文'}对以下文本生成简明摘要：\n\n${text}`
      }
    }]
  })
)
```

## 传输层实现

### Streamable HTTP（src/index.ts）

不依赖 `@modelcontextprotocol/hono`，直接使用 `@modelcontextprotocol/server` 的 transport 对接 Hono。`transport.handleRequest()` 接收标准 Web `Request` 对象，Hono 的 `c.req.raw` 即为标准 `Request`，天然兼容。

```typescript
import { Hono } from 'hono'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/server'
import { createMcpServer } from './mcp/server'

const app = new Hono()

// 自建 DNS rebinding 防护中间件（替代 @modelcontextprotocol/hono 的 localhostHostValidation）
const ALLOWED_HOSTS = ['localhost', '127.0.0.1', '::1']
app.use('/mcp', async (c, next) => {
  const host = c.req.header('host')?.split(':')[0]
  if (host && !ALLOWED_HOSTS.includes(host)) {
    return c.text('Forbidden', 403)
  }
  await next()
})

const server = createMcpServer()
const transport = new WebStandardStreamableHTTPServerTransport({
  sessionIdGenerator: undefined  // 无状态模式，适合简单场景
})
await server.connect(transport)

// 保留原有路由
app.get('/', (c) => c.text('Hello Hono!'))

// MCP 端点：POST (消息) / GET (SSE 流) / DELETE (session 结束)
// transport.handleRequest 接收标准 Request，框架无关
app.all('/mcp', (c) => {
  return transport.handleRequest(c.req.raw)
})

export default app
```

### stdio（src/stdio.ts）

```typescript
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio'
import { createMcpServer } from './mcp/server'

const server = createMcpServer()
const transport = new StdioServerTransport()
await server.connect(transport)
```

## 安全设计

| 威胁 | 防护 |
|------|------|
| DNS rebinding | 自建 Hono 中间件校验 Host 头（白名单：localhost / 127.0.0.1 / ::1） |
| 恶意输入 | Zod schema 自动验证所有 tool/prompt 输入 |
| 表达式注入 | calculate tool 白名单正则校验 |
| handler 异常 | MCP SDK 自动捕获并返回 `isError: true` 标准错误 |

## 依赖

```json
{
  "dependencies": {
    "hono": "^4.x",
    "@modelcontextprotocol/server": "^2.x",
    "zod": "^4.x"
  }
}
```

## 验证方式

1. **MCP Inspector**：`npx @modelcontextprotocol/inspector` 连接 `http://localhost:3000/mcp`，交互式测试 tools/resources/prompts
2. **Claude Desktop**：在配置中添加 stdio server 指向 `bun run src/stdio.ts`
3. **curl 手动测试**：
   ```bash
   # 初始化
   curl -X POST http://localhost:3000/mcp \
     -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2026-07-28","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}},"id":1}'

   # 列出 tools
   curl -X POST http://localhost:3000/mcp \
     -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","method":"tools/list","params":{},"id":2}'
   ```

## 非目标

- 不涉及认证/授权机制（MCP spec 的 OAuth 流程）
- 不涉及 MCP Client 实现
- 不涉及数据库持久化（笔记系统仅在内存中）
- 不涉及 WebSocket 传输
