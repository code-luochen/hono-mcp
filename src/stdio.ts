import { StdioServerTransport } from '@modelcontextprotocol/server/stdio'
import { createMcpServer } from './mcp/server'

const server = createMcpServer()
const transport = new StdioServerTransport()
await server.connect(transport)
