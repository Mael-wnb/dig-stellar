#!/usr/bin/env node
// stdio entry point (`npx @getdig/stellar-mcp`, bin `dig-stellar-mcp`).
// stdout carries the MCP protocol: never console.log here, diagnostics go to stderr.
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server';

const server = createServer({
  baseUrl: process.env.DIG_API_BASE_URL,
  userAgent: process.env.DIG_USER_AGENT,
});

const transport = new StdioServerTransport();
await server.connect(transport);
