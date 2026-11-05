// @getdig/stellar-mcp — MCP server over the Dig Stellar public read API.
// `createServer` builds the server with its six read-only tools; `src/cli.ts` wires it to
// stdio. Nothing here signs, writes or holds a key.
export { createServer, SERVER_INSTRUCTIONS, TOOL_NAMES, type CreateServerOptions } from './server';
export { MCP_VERSION } from './version';
