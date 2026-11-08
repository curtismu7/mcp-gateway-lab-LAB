// One Express app. /api = health, policy (admin-editable, live), weather tool call through the gateway,
// geocode, diagram, info and reset. The only server state is each workspace's policy and recent runs, kept per
// workspace id (X-Workspace) so one visitor's Reset never touches another's. Loopback Host check and same-origin
// writes on everything. Serves web/dist when it exists.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { hostCheck, sameOriginWrites } from './safety.js';
import { createHealth } from './health.js';
import { mountShelfRoute } from './shelfLink.js';
import { loadCast, verticalFrom, VERTICALS } from './cast.js';
import { hostedFrom, modeFrom, realAvailableFrom } from './config.js';
import { buildStory } from './story.js';
import { DIAGRAM_NAMES, buildDiagram } from './diagramData.js';
import { DEFAULT_POLICY, GatewayInputError, evaluateWeatherScope, geocodeCity, normalizePolicy } from './gateway.js';
import { callWeatherTool } from './weatherServer.js';
import { buildHops, newTrace } from './trace.js';
import { createWorkspaces, workspaceFrom } from './workspaces.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIST = process.env.WEB_DIST || path.resolve(HERE, '../../web/dist');
const CONFIG = process.env.CUSTOMER_CONFIG || path.resolve(HERE, '../../customer.config.json');

export function createApp({ health = createHealth(), configFile = CONFIG, hosted = false, workspaces = createWorkspaces({ defaults: DEFAULT_POLICY }) } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(hostCheck);
  app.use(sameOriginWrites);
  app.use((_req, res, next) => { res.set('X-Content-Type-Options', 'nosniff'); next(); });

  const api = express.Router();
  api.use(express.json({ limit: '8kb' }));
  api.use('/health', health.router);
  const castFor = (req) => loadCast(configFile, verticalFrom(req.query.vertical));
  // customer.config.json is read on every request so editing it shows up on reload.
  api.get('/scenarios', (req, res) => { res.set('Cache-Control', 'no-store'); res.json({ ...buildStory(castFor(req), { hosted }), verticals: Object.keys(VERTICALS), hosted }); });
  api.get('/diagram', (req, res) => { res.set('Cache-Control', 'no-store'); res.json(buildDiagram(castFor(req), DIAGRAM_NAMES.includes(req.query.name) ? req.query.name : DIAGRAM_NAMES[0])); });
  // What this build is, for the banner and for verifying a deploy by content (not by a 200).
  api.get('/info', (_req, res) => { res.set('Cache-Control', 'no-store'); res.json({ mode: modeFrom(), source: modeFrom(), simulated: true, hosted, realAvailable: realAvailableFrom() }); });
  // Rule 19: the Mock/Real toggle. Exactly { source: "mock"|"real" }; 409 when Real is not configured.
  api.post('/mode', (req, res) => {
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body) || !['mock', 'real'].includes(body.source)) {
      return res.status(400).json({ error: 'bad_source', detail: 'body must be exactly { source: "mock" | "real" }' });
    }
    if (body.source === 'real' && !realAvailableFrom()) {
      return res.status(409).json({ error: 'real_not_configured', detail: 'Real mode needs a live gateway configuration (MGLAB_REAL_* env, owner-run). Mock keeps working.' });
    }
    return res.json({ source: body.source });
  });

  const withWorkspace = (handler) => (req, res) => {
    const ws = workspaceFrom(req);
    if (!ws) return res.status(400).json({ error: 'bad_workspace' });
    res.set('Cache-Control', 'no-store');
    return handler(ws, req, res);
  };

  // The workspace's current policy. Null policy means "never touched" → the story defaults (Texas).
  api.get('/policy', withWorkspace((ws, req, res) => {
    const v = workspaces.state(ws);
    res.json({ policy: v.policy || DEFAULT_POLICY, tools: ['get_current_conditions', 'check_service_status'], workspace: ws });
  }));

  // Set the workspace's policy (the admin-editable live control; the UC32 reconfigure). Body is normalized;
  // an unrecognized allowedState falls back to the NARROWEST state, never wider.
  api.post('/policy', withWorkspace((ws, req, res) => {
    const body = req.body;
    if (body === null || typeof body !== 'object' || Array.isArray(body)) return res.status(400).json({ error: 'bad_request' });
    if (body.policy !== undefined && (typeof body.policy !== 'object' || Array.isArray(body.policy) || body.policy === null)) {
      return res.status(400).json({ error: 'bad_policy', detail: 'policy must be a JSON object' });
    }
    const raw = body.policy ?? body;
    if (Array.isArray(raw.blockedCities)) {
      const geocoded = [];
      for (const c of raw.blockedCities) {
        const g = geocodeCity(typeof c === 'object' ? c.label : c);
        if (!g) return res.status(400).json({ error: 'unknown_city', detail: 'only demo-known cities can be blocked (the gateway geocodes once, at add time); try Miami or Chicago' });
        geocoded.push(g);
      }
      raw.blockedCities = geocoded;
    }
    const policy = normalizePolicy(raw);
    workspaces.setPolicy(ws, policy);
    return res.json({ policy, workspace: ws });
  }));

  // The gateway: one tools/call through the scope check (UC30/UC31). Forwarded calls are answered by the
  // mock third-party weather server; denied calls never reach it. Mirrors the tx-weather-scope contract:
  // permit → forwarded (200 weather answer), deny → refused at the edge (403-shaped JSON-RPC error).
  api.post('/weather/tool', withWorkspace((ws, req, res) => {
    const body = req.body;
    if (body === null || typeof body !== 'object' || Array.isArray(body)) return res.status(400).json({ error: 'bad_request' });
    if (typeof body.tool !== 'string' || !body.tool) return res.status(400).json({ error: 'tool_name_required', detail: 'body.tool must be non-empty text' });
    const args = (body.arguments && typeof body.arguments === 'object' && !Array.isArray(body.arguments)) ? body.arguments : {};
    const v = workspaces.state(ws);
    const policy = v.policy || DEFAULT_POLICY;

    const result = evaluateWeatherScope({ policy, args: body.tool === 'check_service_status' ? {} : args });
    let weather = null;
    if (result.decision === 'forward') {
      const r = callWeatherTool({ name: body.tool, arguments: args });
      if (r.ok) weather = r.content[0].text;
      else return res.status(400).json({ error: 'tool_error', detail: r.error?.message || 'the third-party tool refused the call', workspace: ws });
    }
    workspaces.record(ws, { tool: body.tool, decision: result.decision, reason: result.reason, allowedState: policy.allowedState });
    const trace = newTrace(req.headers.traceparent);
    const hops = buildHops({ trace, cast: castFor(req), decision: result.decision, reason: result.reason, tool: body.tool, args, policy, weather });
    res.set('traceparent', hops[0].traceparent);
    return res.status(result.decision === 'forward' ? 200 : 403).json({
      decision: result.decision, reason: result.reason, tool: body.tool, arguments: args,
      policy: { allowedState: policy.allowedState, showcase: policy.showcase, blockedCities: policy.blockedCities },
      ...(weather ? { weather } : {}),
      workspace: ws, traceId: trace.traceId, hops,
    });
  }));

  api.get('/runs', withWorkspace((ws, _req, res) => res.json(workspaces.runs(ws))));
  // Reset clears this workspace's policy (back to defaults) and runs. Leaving the page also restores defaults
  // (the AI-DEMO2 behaviour), so the next pass of the permit/deny scenarios starts from the documented policy.
  api.post('/reset', withWorkspace((ws, _req, res) => { workspaces.resetWorkspace(ws); res.json({ reset: 'ok', workspace: ws }); }));
  mountShelfRoute(api); // GET /api/shelf for the header "Shelf" button: before the 404 below, outside the web-build check
  api.use((_req, res) => res.status(404).json({ error: 'not_found' }));
  app.use('/api', api);
  // Errors become short JSON. Express's default handler would send an HTML stack trace with absolute file paths.
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    const status = Number(err?.status || err?.statusCode);
    if (status === 413) return res.status(413).json({ error: 'payload_too_large' });
    if (status >= 400 && status < 500) return res.status(status).json({ error: 'bad_request' });
    return res.status(500).json({ error: 'internal_error' });
  });

  if (fs.existsSync(path.join(WEB_DIST, 'index.html'))) {
    app.use(express.static(WEB_DIST));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(WEB_DIST, 'index.html')));
  }
  return app;
}

export function startHttpServer({ port, host, app = createApp() } = {}) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => resolve({ server, url: `http://${host}:${server.address().port}/` }));
    server.once('error', reject);
  });
}
