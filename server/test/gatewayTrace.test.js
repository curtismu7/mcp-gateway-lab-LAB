// "What Privilege did" for the mock weather gateway: the trace in the POST /api/weather/tool reply. Mock only (Real is reserved, no data
// path), so the trace is always source 'mock' and every decision is 'checked' (evaluateWeatherScope computed it). It passes the shared
// contract (assertTrace) and holds nothing secret.
import test from 'node:test';
import assert from 'node:assert/strict';
import { withServer } from './helpers.js';
import { assertTrace, mockTrace, realTrace } from '../src/gatewayTrace.js';

const tool = (url, body, headers = {}) => fetch(`${url}/api/weather/tool`, { method: 'POST', headers: { 'content-type': 'application/json', origin: url, 'x-workspace': 'gt', ...headers }, body: JSON.stringify(body) });
const AUSTIN = { tool: 'get_current_conditions', arguments: { city_name: 'Austin' } };
const MIAMI = { tool: 'get_current_conditions', arguments: { city_name: 'Miami' } };
const setPolicy = (url, policy) => fetch(`${url}/api/policy`, { method: 'POST', headers: { 'content-type': 'application/json', origin: url, 'x-workspace': 'gt' }, body: JSON.stringify({ policy }) });

test('a permit carries a mock trace that satisfies the contract: the exact JSON-RPC request, the 200 reply, three checked decisions that pass', async () => {
  await withServer(async (url) => {
    const r = await tool(url, AUSTIN);
    const j = await r.json();
    assert.equal(r.status, 200);
    assert.deepEqual(assertTrace(j.trace), []);
    assert.equal(j.trace.source, 'mock');
    assert.deepEqual(j.trace.request.body, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_current_conditions', arguments: { city_name: 'Austin' } } });
    assert.equal(j.trace.request.headers.authorization, 'Bearer <MOCK token>');
    assert.equal(j.trace.request.headers.traceparent, j.hops[0].traceparent);
    assert.ok(!('accept' in j.trace.request.headers), 'the lab sends no accept header, so the trace shows none');
    assert.match(new URL(j.trace.request.url).hostname, /^gateway\..+\.example$/);
    assert.equal(j.trace.response.status, 200, 'the trace shows the real HTTP status (hop 1 text says 202)');
    assert.equal(j.trace.response.headers.traceparent, r.headers.get('traceparent'));
    assert.equal(j.trace.response.body.decision, 'forward');
    assert.equal(j.trace.response.body.weather, j.weather, 'the reply body is this reply, not a copy that can drift');
    assert.ok(!('hops' in j.trace.response.body) && !('trace' in j.trace.response.body));
    assert.deepEqual(j.trace.decisions.map((d) => [d.id, d.outcome, d.basis]), [['capability', 'pass', 'checked'], ['scope', 'pass', 'checked'], ['forward', 'pass', 'checked']]);
  });
});

test('a deny is a 403 whose failing decision is the scope check with the reason the engine computed, and the backend is never reached', async () => {
  await withServer(async (url) => {
    const r = await tool(url, MIAMI);
    const j = await r.json();
    assert.equal(r.status, 403);
    assert.deepEqual(assertTrace(j.trace), []);
    assert.equal(j.trace.response.status, 403);
    assert.deepEqual(j.trace.decisions.map((d) => [d.id, d.outcome]), [['capability', 'pass'], ['scope', 'fail'], ['forward', 'skipped']]);
    assert.equal(j.trace.decisions[1].evidence, j.reason);
    assert.match(j.trace.decisions[1].label, /texas/);
  });
});

test('with the capability off, the scope check is not reached and the capability decision carries the reason', async () => {
  await withServer(async (url) => {
    await setPolicy(url, { showcase: false, allowedState: 'texas', blockedCities: [] });
    const j = await (await tool(url, AUSTIN)).json();
    assert.deepEqual(assertTrace(j.trace), []);
    assert.deepEqual(j.trace.decisions.map((d) => [d.id, d.outcome]), [['capability', 'fail'], ['scope', 'skipped'], ['forward', 'skipped']]);
    assert.equal(j.trace.decisions[0].evidence, j.reason);
  });
});

test('every policy mode and call shape yields a valid trace whose outcomes agree with the decision', async () => {
  await withServer(async (url) => {
    let ran = 0;
    for (const allowedState of ['texas', 'michigan', 'any', 'any-except-blocked', 'bogus']) {
      await setPolicy(url, { showcase: true, allowedState, blockedCities: [{ label: 'Miami' }] });
      for (const body of [AUSTIN, MIAMI, { tool: 'check_service_status' }, { tool: 'get_current_conditions', arguments: { latitude: '25.76', longitude: '-80.19' } }, { tool: 'get_current_conditions', arguments: { latitude: 'x', longitude: 'y' } }]) {
        const r = await tool(url, body);
        if (r.status !== 200 && r.status !== 403) continue;
        const j = await r.json();
        ran++;
        assert.deepEqual(assertTrace(j.trace), [], `${allowedState} ${JSON.stringify(body)}`);
        assert.ok(j.trace.decisions.every((d) => d.basis === 'checked'));
        assert.equal(j.trace.decisions.find((d) => d.id === 'forward').outcome === 'pass', j.decision === 'forward');
        assert.equal(j.trace.response.status, r.status);
      }
    }
    assert.ok(ran >= 20, 'the sweep ran');
  });
});

test('Real is reserved: even with the Real env present the trace is mock, and no configured credential value is in it', async () => {
  const fake = { MGLAB_REAL_URL: 'https://real.invalid/x', MGLAB_REAL_CLIENT_ID: `id-${Math.random().toString(36).slice(2)}`, MGLAB_REAL_CLIENT_SECRET: `sec-${Math.random().toString(36).slice(2)}` };
  Object.assign(process.env, fake);
  try {
    await withServer(async (url) => {
      const r = await tool(url, AUSTIN);
      const text = await r.text();
      const j = JSON.parse(text);
      assert.equal(j.trace.source, 'mock');
      assert.deepEqual(assertTrace(j.trace), []);
      for (const v of Object.values(fake)) assert.ok(!text.includes(v), 'a configured Real value leaked into the reply');
    });
  } finally { for (const k of Object.keys(fake)) delete process.env[k]; }
});

test('an unknown tool is refused by the third-party server with a 400 tool_error: no gateway reply, so no trace', async () => {
  await withServer(async (url) => {
    const r = await tool(url, { tool: 'brand_new_tool', arguments: { city_name: 'Austin' } });
    assert.equal(r.status, 400);
    assert.ok(!('trace' in (await r.json())));
  });
});

test('the shared contract has teeth here: a "checked" decision in a real trace, and a full bearer token, are both reported', () => {
  const real = realTrace({ url: 'https://gw.invalid/x', authorization: 'Bearer x', rpc: { jsonrpc: '2.0', id: 1, method: 'tools/list' }, status: 200, headers: {}, body: { result: { tools: [] } } });
  assert.deepEqual(assertTrace(real), []);
  assert.ok(assertTrace({ ...real, decisions: [{ ...real.decisions[0], basis: 'checked' }] }).length > 0);
  const mock = mockTrace({ url: 'https://gw.invalid/x', authorization: 'Bearer x', rpc: null, status: 200, body: null, decisions: [{ id: 'a', label: 'A', outcome: 'pass', evidence: 'e' }] });
  assert.deepEqual(assertTrace(mock), []);
});
