import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { rawHttp, withServer } from './helpers.js';

test('GET /api/health answers demo-health/1, ready and offline', async () => {
  await withServer(async (url) => {
    const r = await fetch(`${url}/api/health`);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    const j = await r.json();
    assert.equal(j.schema, 'demo-health/1');
    assert.equal(j.state, 'ready');
    assert.equal(j.runtime, 'offline');
    assert.equal(j.demo.id, 'mcp-gateway-lab');
    assert.deepEqual(Object.keys(j).sort(), ['at', 'demo', 'runtime', 'schema', 'state']);
  });
});

test('health is GET only', async () => {
  await withServer(async (url) => {
    const r = await fetch(`${url}/api/health`, { method: 'POST', headers: { origin: url } });
    assert.equal(r.status, 405);
  });
});

test('POST /api/reset confirms and refuses a cross-origin caller', async () => {
  await withServer(async (url) => {
    const ok = await fetch(`${url}/api/reset`, { method: 'POST', headers: { 'content-type': 'application/json', origin: url }, body: '{}' });
    assert.equal((await ok.json()).reset, 'ok');
    const bad = await fetch(`${url}/api/reset`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, body: '{}' });
    assert.equal(bad.status, 403);
  });
});

test('a non-loopback Host header is refused (DNS rebinding)', async () => {
  await withServer(async (url) => {
    const r = await rawHttp(`${url}/api/health`, { headers: { host: 'evil.example.invalid' } });
    assert.equal(r.status, 403);
  });
});

test('unknown API paths are 404 JSON', async () => {
  await withServer(async (url) => {
    const r = await fetch(`${url}/api/nope`);
    assert.equal(r.status, 404);
    assert.equal((await r.json()).error, 'not_found');
  });
});

test('GET /api/info says what this build is: mock, simulated, and hosted only when asked', async () => {
  await withServer(async (url) => {
    assert.deepEqual(await (await fetch(`${url}/api/info`)).json(), { mode: 'mock', source: 'mock', simulated: true, hosted: false, realAvailable: false });
    const j = await (await fetch(`${url}/api/scenarios`)).json();
    assert.equal(j.hosted, false);
    assert.match(j.banner, /^SIMULATED/);
  });
  await withServer(async (url) => {
    assert.deepEqual(await (await fetch(`${url}/api/info`)).json(), { mode: 'mock', source: 'mock', simulated: true, hosted: true, realAvailable: false });
    assert.match((await (await fetch(`${url}/api/scenarios`)).json()).banner, /^HOSTED SIMULATION/);
  }, { hosted: true });
});

test('an oversized or malformed body gets a short JSON error, never a stack trace or a file path', async () => {
  await withServer(async (url) => {
    const post = (body) => fetch(`${url}/api/policy`, { method: 'POST', headers: { 'content-type': 'application/json', origin: url }, body });
    const big = await post(JSON.stringify({ pad: 'x'.repeat(9000) }));
    assert.equal(big.status, 413);
    assert.deepEqual(await big.json(), { error: 'payload_too_large' });
    const bad = await post('{not json');
    assert.equal(bad.status, 400);
    const text = JSON.stringify(await bad.json());
    assert.equal(text, JSON.stringify({ error: 'bad_request' }));
    assert.ok(!/\/Users\/|node_modules|at \w+ \(/.test(text), 'no stack or path');
    assert.equal((await fetch(`${url}/api/health`)).status, 200, 'the server stays up');
  });
});

test('GET /api/scenarios returns the filled story; customer.config.json is read on each request; verticals switch the cast', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mgl-')), 'customer.config.json');
  await withServer(async (url) => {
    let j = await (await fetch(`${url}/api/scenarios`)).json();
    assert.equal(j.scenarios.length, 6);
    assert.ok(!/\{\{/.test(JSON.stringify(j)), 'no unfilled token');
    assert.match(j.tokenLabel, /MOCK/);
    assert.ok(j.facts.some((f) => f.id === 'fail-narrow' && f.status === 'measured'));
    assert.ok(j.tools.length >= 2, 'the tool list ships with the story');
    j = await (await fetch(`${url}/api/scenarios?vertical=finance`)).json();
    assert.match(j.rule.appliesTo, /fabrikam/);
    j = await (await fetch(`${url}/api/scenarios?vertical=__proto__`)).json();
    assert.match(j.rule.appliesTo, /northwind/, 'unknown vertical keeps the default');
    fs.writeFileSync(file, JSON.stringify({ cast: { host: 'customhost' } }));
    j = await (await fetch(`${url}/api/scenarios`)).json();
    assert.match(j.rule.appliesTo, /customhost/);
  }, { configFile: file });
});

test('GET /api/policy returns the default Texas policy; POST /api/policy reconfigures it live (UC32)', async () => {
  await withServer(async (url) => {
    const post = (p, body, ws) => fetch(`${url}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: url, 'x-workspace': ws }, body: JSON.stringify(body) });
    let j = await (await fetch(`${url}/api/policy`, { headers: { 'x-workspace': 'w1' } })).json();
    assert.equal(j.policy.allowedState, 'texas');
    assert.equal(j.policy.showcase, true);
    // switch to michigan
    j = await (await post('/api/policy', { policy: { allowedState: 'michigan' } }, 'w1')).json();
    assert.equal(j.policy.allowedState, 'michigan');
    // invalid values fall back to the NARROWEST state, never wider
    j = await (await post('/api/policy', { policy: { allowedState: 'everywhere', showcase: 'yes' } }, 'w1')).json();
    assert.equal(j.policy.allowedState, 'texas', 'an unrecognized state falls back to the narrowest');
    assert.equal(j.policy.showcase, true);
    // invalid policy object is refused
    assert.equal((await post('/api/policy', { policy: 'junk' }, 'w1')).status, 400);
    // blocked-city adds are geocoded once at add time; unknown cities are refused
    j = await (await post('/api/policy', { policy: { allowedState: 'any-except-blocked', blockedCities: ['Miami'] } }, 'w1')).json();
    assert.equal(j.policy.allowedState, 'any-except-blocked');
    assert.equal(j.policy.blockedCities.length, 1);
    assert.equal(typeof j.policy.blockedCities[0].lat, 'number');
    assert.equal((await post('/api/policy', { policy: { allowedState: 'any-except-blocked', blockedCities: ['Atlantis'] } }, 'w1')).status, 400);
  });
});

test('POST /api/weather/tool: Austin permits, Miami denies, the backend never sees a deny (UC30/UC31)', async () => {
  await withServer(async (url) => {
    const post = (body, ws) => fetch(`${url}/api/weather/tool`, { method: 'POST', headers: { 'content-type': 'application/json', origin: url, 'x-workspace': ws }, body: JSON.stringify(body) });
    // UC30: Austin in Texas permits; the third-party server answers
    let j = await (await post({ tool: 'get_current_conditions', arguments: { city_name: 'Austin' } }, 'w1')).json();
    assert.equal(j.decision, 'forward');
    assert.match(j.weather, /third-party weather/);
    assert.match(j.weather, /austin/i);
    assert.ok(j.hops.some((h) => h.label.includes('forwarded untouched')));
    // UC31: Miami under Texas denies BEFORE the backend
    const res = await post({ tool: 'get_current_conditions', arguments: { city_name: 'Miami' } }, 'w1');
    assert.equal(res.status, 403);
    j = await res.json();
    assert.equal(j.decision, 'denied');
    assert.match(j.reason, /restricted to Texas/);
    assert.ok(!j.weather, 'no weather answer exists: the backend never ran');
    assert.ok(j.hops.some((h) => h.label.startsWith('DENIED')));
    // unknown tool: the third-party server refuses (400), not the gateway
    const badTool = await post({ tool: 'brand_new_tool', arguments: { city_name: 'Austin' } }, 'w1');
    assert.equal(badTool.status, 400);
    // check_service_status has no location argument: always forwards
    j = await (await post({ tool: 'check_service_status' }, 'w1')).json();
    assert.equal(j.decision, 'forward');
    assert.equal((await post({}, 'w1')).status, 400);
  });
});

test('the coordinate branch: geocoded Miami (lat/lon) denies under Texas; in-box coordinates permit', async () => {
  await withServer(async (url) => {
    const post = (body, ws) => fetch(`${url}/api/weather/tool`, { method: 'POST', headers: { 'content-type': 'application/json', origin: url, 'x-workspace': ws }, body: JSON.stringify(body) });
    // Miami's resolved coordinates, outside the Texas box
    let j = await (await post({ tool: 'get_current_conditions', arguments: { latitude: 25.7617, longitude: -80.1918 } }, 'w1')).json();
    assert.equal(j.decision, 'denied');
    assert.match(j.reason, /coordinates outside Texas/);
    // Austin's coordinates, inside the box
    j = await (await post({ tool: 'get_current_conditions', arguments: { latitude: 30.2672, longitude: -97.7431 } }, 'w1')).json();
    assert.equal(j.decision, 'forward');
    // unparseable coordinates under a named state are denied: the gateway cannot verify them
    j = await (await post({ tool: 'get_current_conditions', arguments: { latitude: 'north', longitude: 'up' } }, 'w1')).json();
    assert.equal(j.decision, 'denied');
    assert.match(j.reason, /invalid or incomplete coordinates/);
  });
});

test('UC32: switching the policy flips the SAME call, no restart; Reset restores Texas', async () => {
  await withServer(async (url) => {
    const post = (p, body, ws) => fetch(`${url}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: url, 'x-workspace': ws }, body: JSON.stringify(body) });
    const miami = () => post('/api/weather/tool', { tool: 'get_current_conditions', arguments: { city_name: 'Miami' } }, 'w2');
    assert.equal((await miami()).status, 403, 'denied under Texas');
    await post('/api/policy', { policy: { allowedState: 'any' } }, 'w2');
    let j = await (await miami()).json();
    assert.equal(j.decision, 'forward', 'the same call flips after the live reconfigure');
    await post('/api/policy', { policy: { allowedState: 'michigan' } }, 'w2');
    assert.equal((await miami()).status, 403);
    // any-except-blocked: Miami blocked by name, but Miami, OH is a different city
    await post('/api/policy', { policy: { allowedState: 'any-except-blocked', blockedCities: ['Miami, FL'] } }, 'w2');
    assert.equal((await miami()).status, 403);
    j = await (await post('/api/weather/tool', { tool: 'get_current_conditions', arguments: { city_name: 'Miami, OH' } }, 'w2')).json();
    assert.equal(j.decision, 'forward', 'a differently qualified name does not match the blocked label');
    // blocked by coordinates too
    j = await (await post('/api/weather/tool', { tool: 'get_current_conditions', arguments: { latitude: 25.7617, longitude: -80.1918 } }, 'w2')).json();
    assert.equal(j.decision, 'denied', 'the coordinate branch carries the block');
    // Reset restores the documented default
    await post('/api/reset', {}, 'w2');
    j = await (await fetch(`${url}/api/policy`, { headers: { 'x-workspace': 'w2' } })).json();
    assert.equal(j.policy.allowedState, 'texas');
  });
});

test('policy and runs are per workspace and Reset clears only that workspace', async () => {
  await withServer(async (url) => {
    const post = (p, ws, body = {}) => fetch(`${url}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: url, 'x-workspace': ws }, body: JSON.stringify(body) });
    const get = (p, ws) => fetch(`${url}${p}`, { headers: { 'x-workspace': ws } });
    await post('/api/policy', 'alice', { policy: { allowedState: 'any' } });
    await post('/api/weather/tool', 'alice', { tool: 'get_current_conditions', arguments: { city_name: 'Miami' } });
    // bob is unaffected
    let j = await (await get('/api/policy', 'bob')).json();
    assert.equal(j.policy.allowedState, 'texas', 'defaults until touched');
    j = await (await post('/api/weather/tool', 'bob', { tool: 'get_current_conditions', arguments: { city_name: 'Miami' } })).json();
    assert.equal(j.decision, 'denied');
    const runs = async (ws) => (await (await get('/api/runs', ws)).json()).runs;
    assert.equal((await runs('alice')).length >= 1, true);
    await post('/api/reset', 'alice');
    j = await (await get('/api/policy', 'alice')).json();
    assert.equal(j.policy.allowedState, 'texas', 'reset restores the default policy');
    assert.deepEqual(await runs('alice'), []);
    assert.deepEqual((await runs('bob')).map((r) => r.decision), ['denied']);
    assert.equal((await post('/api/weather/tool', 'Bad Id!', { tool: 'get_current_conditions' })).status, 400);
  });
});

test('GET /api/diagram serves the gateway-scope-flow diagram-studio data, uncached', async () => {
  await withServer(async (url) => {
    const r = await fetch(`${url}/api/diagram`);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    const j = await r.json();
    assert.equal(j.steps.length, 5);
    assert.ok(j.nodes.some((n) => n.label.includes('Agent gateway')));
    assert.ok(j.steps[0].say.includes('tools/call'));
  });
});

test('rule 19: POST /api/mode switches (mock) and answers 409 when Real is not configured', async () => {
  await withServer(async (url) => {
    const post = (body) => fetch(`${url}/api/mode`, { method: 'POST', headers: { 'content-type': 'application/json', origin: url }, body: JSON.stringify(body) });
    const ok = await post({ source: 'mock' });
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { source: 'mock' });
    const conflict = await post({ source: 'real' });
    assert.equal(conflict.status, 409);
    assert.equal((await conflict.json()).error, 'real_not_configured');
    assert.equal((await post({ source: 'banana' })).status, 400);
    assert.equal((await post({})).status, 400);
  });
});

test('GET /api/shelf returns SHELF_URL (slash trimmed) with no web build; POST is not 200', async () => {
  const prev = process.env.SHELF_URL;
  process.env.SHELF_URL = 'https://shelf.example:8443/';
  try {
    await withServer(async (url) => {
      const r = await fetch(`${url}/api/shelf`);
      assert.equal(r.status, 200);
      assert.deepEqual(await r.json(), { shelfUrl: 'https://shelf.example:8443' });
      const post = await fetch(`${url}/api/shelf`, { method: 'POST', headers: { origin: url } });
      assert.notEqual(post.status, 200);
    });
  } finally {
    if (prev === undefined) delete process.env.SHELF_URL; else process.env.SHELF_URL = prev;
  }
});
