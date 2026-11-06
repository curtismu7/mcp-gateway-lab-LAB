// Builds content-pack.json for the Learning Hub from the story data, so the pack cannot drift from the lab.
//   node scripts/build-content-pack.mjs        (writes content-pack.json)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CAST } from '../server/src/cast.js';
import { buildStory } from '../server/src/story.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

export function buildPack() {
  const story = buildStory(DEFAULT_CAST);
  const sid = (n) => `S${String(n).padStart(2, '0')}`;
  const terms = { 'texas-permit': ['gateway-scope'], 'texas-deny': ['gateway-scope'], 'live-reconfigure': ['gateway-scope', 'live-policy'], 'coords-outside': ['gateway-scope'], 'qualified-city': ['exact-match'], 'capability-off': ['gateway-scope'] };
  return {
    schema: 'demo-content-pack/1',
    id: 'mcp-gateway-lab',
    title: 'MCP Gateway Lab',
    version,
    demo: { id: 'mcp-gateway-lab', name: 'MCP Gateway Lab', catalog: 'D999', baseUrl: 'http://localhost:7670', doctor: '/api/health', tags: ['mcp', 'gateway', 'third-party', 'policy', 'weather', 'mock-only'] },
    glossary: [
      { id: 'gateway-scope', term: 'Gateway scope policy', definition: 'The agent gateway enforces a business boundary (one configurable US state by default, or "any", or everywhere except an admin-blocked city) on a third-party MCP tool — entirely at the edge. A denied call never reaches the backend; the backend stays unmodified and policy-blind.', aliases: ['state scope', 'edge policy'] },
      { id: 'live-policy', term: 'Live policy reconfigure', definition: 'The allowed state is admin-editable and read on every request: switching it flips the outcome of the very next call, with no gateway restart. A policy that needs a redeploy is not externalized governance.', aliases: ['live reconfigure', 'admin-editable policy'] },
      { id: 'exact-match', term: 'Exact city matching', definition: 'City names are matched exactly, split on the first comma — no substring containment: "Plano, IL" and "Miami, OH" are real, different cities and stay allowed. Coordinates are checked as well as names, because the agent geocodes first.', aliases: ['no substring matching'] },
    ],
    sources: [
      { id: 'mcp-tools', title: 'Model Context Protocol: tools/call', url: 'https://modelcontextprotocol.io/docs/concepts/tools', kind: 'standard', use: 'The JSON-RPC tool-call shape the gateway scopes.', status: 'not-read', checked: '2026-11-06' },
    ],
    cards: [
      ...story.scenarios.map((sc, i) => ({ id: `try-${sc.id}`, label: `Scenario ${i + 1}: ${sc.title}`, description: sc.lesson, group: 'try-it', action: { type: 'route', href: `/#scenario-${sc.id}` }, terms: terms[sc.id], story: sid(i + 1) })),
      { id: 'concept-editor', label: 'Reconfigure the policy live', description: 'Switch the allowed state, add a blocked city, or turn the capability off; the SAME call flips on the next run.', group: 'concept', action: { type: 'route', href: '/#policy' } },
      { id: 'ref-doctor', label: 'Doctor and health', description: 'Preflight checks and the demo-health/1 endpoint.', group: 'setup', action: { type: 'route', href: '/api/health' } },
    ],
    stories: story.scenarios.map((sc, i) => ({ id: sid(i + 1), title: sc.title, say: sc.lesson })),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  fs.writeFileSync(path.join(ROOT, 'content-pack.json'), `${JSON.stringify(buildPack(), null, 2)}\n`);
}
