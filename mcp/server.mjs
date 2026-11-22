#!/usr/bin/env node
// MCP Gateway LAB companion MCP server (stdio).
//
// Exposes the simulated gateway's policy surface as MCP tools: policy
// get/set, tool calls through the gateway (in-scope forwards, out-of-scope
// denies), the decision-run history and the scenario catalog. The lab stays
// the single source of state; this server is a thin proxy.
//
// Configuration:
//   MGLAB_LAB_BASE  base URL of a running MCP Gateway LAB (default http://localhost:7670)
//
// Run: node mcp/server.mjs

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const BASE = (process.env.MGLAB_LAB_BASE || 'http://localhost:7670').replace(/\/+$/, '');
const ORIGIN = process.env.MGLAB_LAB_ORIGIN || 'http://localhost:7670';

async function call(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      origin: ORIGIN,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, body: json };
}

const text = (r) => ({ content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] });

const server = new McpServer({
  name: 'mcp-gateway-lab',
  version: '0.1.0',
  title: 'MCP Gateway LAB tools',
  description: 'Drive MCP Gateway LAB: the simulated gateway\'s policy (get/set/reset), tool calls through the gateway (in-scope forwards to the mock third-party weather server, out-of-scope denies that never reach the backend), the decision-run history and the scenario catalog. Everything is a labelled simulation; the lab has no live mode.',
});

server.registerTool('mglab_health', {
  title: 'Lab health',
  description: 'Check the lab is running and report its runtime state.',
  inputSchema: {},
}, async () => text(await call('/api/health')));

server.registerTool('mglab_info', {
  title: 'Mode info',
  description: 'Mode (always simulated: the lab is itself the mock gateway).',
  inputSchema: {},
}, async () => text(await call('/api/info')));

server.registerTool('mglab_scenarios', {
  title: 'Scenario catalog',
  description: 'The permit/deny scenario story, its cast and facts.',
  inputSchema: {},
}, async () => text(await call('/api/scenarios')));

server.registerTool('mglab_policy_get', {
  title: 'Current gateway policy',
  description: 'The active policy: allowedState, showcase flag, blocked cities and the block radius.',
  inputSchema: {},
}, async () => text(await call('/api/policy')));

server.registerTool('mglab_policy_set', {
  title: 'Set the gateway policy',
  description: 'Set allowedState (an unknown state falls back to the narrowest, never wider) and optionally block cities (geocoded once; unknown cities are refused).',
  inputSchema: {
    allowedState: z.string().describe('US state the gateway allows, e.g. "texas"'),
    blockedCities: z.array(z.string()).optional().describe('Cities to block'),
  },
}, async ({ allowedState, blockedCities }) => text(await call('/api/policy', {
  method: 'POST',
  body: blockedCities ? { allowedState, blockedCities } : { allowedState },
})));

server.registerTool('mglab_tool_call', {
  title: 'Tool call through the gateway',
  description: 'One tool call at the simulated gateway. In-scope calls forward to the mock third-party weather server (200 with weather); out-of-scope calls are denied (403) and the backend never sees them. Tools: get_current_conditions (arguments: city_name), check_service_status (no location).',
  inputSchema: {
    tool: z.string().describe('Tool name, e.g. "get_current_conditions"'),
    city: z.string().optional().describe('City for get_current_conditions'),
  },
}, async ({ tool, city }) => {
  const args = city !== undefined ? { city_name: city } : {};
  const r = await call('/api/weather/tool', { method: 'POST', body: { tool, arguments: args } });
  return text(r);
});

server.registerTool('mglab_runs', {
  title: 'Decision runs',
  description: 'This workspace\'s decision history (tool, decision, reason, allowedState).',
  inputSchema: {},
}, async () => text(await call('/api/runs')));

server.registerTool('mglab_reset', {
  title: 'Reset policy and runs',
  description: 'Back to the default policy; clears this workspace\'s runs.',
  inputSchema: {},
}, async () => text(await call('/api/reset', { method: 'POST', body: {} })));

const transport = new StdioServerTransport();
await server.connect(transport);
