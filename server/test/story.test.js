import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CAST, VERTICALS, fill, unfilled } from '../src/cast.js';
import { rawStory, buildStory } from '../src/story.js';
import { evaluateWeatherScope, normalizePolicy, STATES, geocodeCity } from '../src/gateway.js';
import { scanHosts } from '../src/safety.js';
import { rawDiagram } from '../src/diagramData.js';

const all = () => JSON.stringify([rawStory(), rawDiagram()]);

test('every {{token}} in the story and diagram data is defined by every vertical (fails on an undefined token)', () => {
  for (const [name, cast] of Object.entries(VERTICALS)) assert.deepEqual(unfilled(all(), cast), [], name);
  assert.equal(Object.keys(VERTICALS).length, 3);
});

test('the check itself catches an undefined token and leaves it visible', () => {
  assert.deepEqual(unfilled('a {{castBrand}} {{nope}}', DEFAULT_CAST), ['nope']);
  assert.equal(fill('{{nope}}', DEFAULT_CAST), '{{nope}}');
  assert.equal(fill('{{__proto__}}', DEFAULT_CAST), '{{__proto__}}');
});

test('each scenario gives its expected decision in every vertical', () => {
  for (const cast of Object.values(VERTICALS)) {
    const s = buildStory(cast);
    for (const sc of s.scenarios) {
      const decision = evaluateWeatherScope({
        policy: normalizePolicy(sc.policy),
        args: sc.call.tool === 'check_service_status' ? {} : sc.call.arguments,
      }).decision;
      assert.equal(decision, sc.expected, sc.id);
    }
  }
});

test('the reconfigure scenario really carries allowedState any, and the permit/deny pair share Texas', () => {
  const s = buildStory(DEFAULT_CAST).scenarios;
  assert.equal(s.find((x) => x.id === 'live-reconfigure').policy.allowedState, 'any');
  assert.equal(s.find((x) => x.id === 'texas-permit').policy.allowedState, 'texas');
  assert.equal(s.find((x) => x.id === 'texas-deny').policy.allowedState, 'texas');
});

test('only .example hosts, no key-looking values', () => {
  assert.deepEqual(scanHosts(JSON.stringify([buildStory(DEFAULT_CAST)])), []);
  assert.deepEqual(scanHosts(all()), []);
});

test('the fail-narrow claim is labelled measured, and every fact carries a status', () => {
  const facts = rawStory().facts;
  assert.equal(facts.find((f) => f.id === 'fail-narrow').status, 'measured');
  assert.equal(facts.find((f) => f.id === 'scope-at-edge').status, 'measured');
  for (const f of facts) assert.ok(['measured', 'inferred', 'UNVERIFIED'].includes(f.status), f.id);
  assert.ok(!/\bdoors?\b/i.test(all()));
});

test('docs/talk-track.md is exactly what the talk-track data renders (no drift; run `npm run talk-track`)', async () => {
  const { readFileSync } = await import('node:fs');
  const path = await import('node:path');
  const md = readFileSync(path.resolve(import.meta.dirname, '../../docs/talk-track.md'), 'utf8');
  const { renderTalkTrackMarkdown } = await import('../src/story.js');
  assert.equal(md, renderTalkTrackMarkdown(DEFAULT_CAST));
});

test('the diagram is diagram-studio/1 data and every step walks a real edge', () => {
  const d = rawDiagram();
  assert.equal(d.schema, 'diagram-studio/1');
  assert.equal(d.steps.length, 5);
  for (const s of d.steps) for (const i of s.edges) assert.ok(d.edges[i], `${s.title} edge ${i}`);
});

test('the third-party weather server is policy-blind: it answers any city', async () => {
  const { callWeatherTool } = await import('../src/weatherServer.js');
  const miami = callWeatherTool({ name: 'get_current_conditions', arguments: { city_name: 'Miami' } });
  assert.equal(miami.ok, true, 'with no gateway, Miami works — the policy lives at the gateway, not the tool');
  const austin = callWeatherTool({ name: 'get_current_conditions', arguments: { city_name: 'Austin' } });
  assert.match(austin.content[0].text, /sunny/);
  assert.equal(callWeatherTool({ name: 'nope' }).ok, false);
  assert.equal(callWeatherTool({ name: 'get_current_conditions', arguments: {} }).ok, false);
});
