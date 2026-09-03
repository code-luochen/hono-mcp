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
