// Rule 14: W3C Trace Context on every (mock) hop. One trace id per gateway decision, a new span id per hop. A valid incoming
// `traceparent` header continues its trace; anything else starts a new one. Nothing is sent anywhere: these are the raw
// request/response panes the UI shows. Values are random, mock, and carry no meaning outside this app.
import { randomBytes } from 'node:crypto';

const TP = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;
const ZERO32 = '0'.repeat(32);
const ZERO16 = '0'.repeat(16);

export function parseTraceparent(v) {
  if (typeof v !== 'string' || v.length !== 55) return null;
  const m = TP.exec(v);
  return m && m[1] !== ZERO32 && m[2] !== ZERO16 ? { traceId: m[1], parentId: m[2], flags: m[3] } : null;
}
export const formatTraceparent = (traceId, spanId, flags = '01') => `00-${traceId}-${spanId}-${flags}`;

export function newTrace(incoming, rand = randomBytes) {
  const p = parseTraceparent(incoming);
  const span = () => rand(8).toString('hex').replace(/^0{16}$/, '0000000000000001');
  return { traceId: p ? p.traceId : rand(16).toString('hex').replace(/^0{32}$/, `${'0'.repeat(31)}1`), parentId: p ? p.parentId : null, span };
}

// The five mock hops of one weather tool-call evaluation, with the raw request and response text of each.
export function buildHops({ trace, cast, decision, reason, tool, args, policy, weather }) {
  const host = `gateway.${cast.castHost}.example`;
  const backend = `weather.${cast.castHost}.example`;
  const ids = [trace.span(), trace.span(), trace.span(), trace.span(), trace.span()];
  const tp = ids.map((id) => formatTraceparent(trace.traceId, id));
  const forwarded = decision === 'forward';
  const gatewayStatus = forwarded ? '202 (in scope; forwarding)' : '403 Forbidden (out of scope)';
  const backendStatus = forwarded ? '200 OK' : '— never reached —';
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: args } });
  const policyLine = `allowedState: ${policy.allowedState}${policy.allowedState === 'any-except-blocked' ? `; blockedCities: [${policy.blockedCities.map((c) => c.label).join(', ') || 'none'}]; radius: ${policy.blockRadiusDeg}` : ''}`;
  return [
    { n: 1, from: 'agent', to: 'gateway', label: 'Agent calls the third-party tool through the gateway', traceparent: tp[0],
      request: `POST https://${host}/weather\nAuthorization: Bearer <MOCK token>\ntraceparent: ${tp[0]}\ncontent-type: application/json\n\n${body}`,
      response: `HTTP/1.1 ${gatewayStatus}\ntraceparent: ${tp[0]}` },
    { n: 2, from: 'gateway', to: 'policy', label: 'Gateway reads the admin-editable policy (every request)', traceparent: tp[1],
      request: `GET policy (mock, in process)\ntraceparent: ${tp[1]}`,
      response: `showcase: ${policy.showcase}\n${policyLine}` },
    { n: 3, from: 'gateway', to: 'gateway', label: 'Scope check: name AND coordinates, exact match', traceparent: tp[2],
      request: `evaluateWeatherScope(args)\ntraceparent: ${tp[2]}`,
      response: `decision: ${decision}\nreason: ${reason}` },
    { n: 4, from: 'gateway', to: 'weather', label: forwarded ? 'In scope: forwarded untouched' : 'DENIED: the backend never sees it', traceparent: tp[3],
      request: forwarded ? `POST https://${backend}/\ntraceparent: ${tp[3]}\n\n${body}` : `— not sent —\ntraceparent: ${tp[3]}`,
      response: `HTTP/1.1 ${backendStatus}` },
    { n: 5, from: 'weather', to: 'agent', label: 'The answer (policy-blind)', traceparent: tp[4],
      request: `GATEWAY-RESULT (mock)\ntraceparent: ${tp[4]}`,
      response: forwarded ? `${weather ?? '(weather answer)'}` : `${reason}\nthe third-party server did not run` },
  ];
}
