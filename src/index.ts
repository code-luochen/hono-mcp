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
