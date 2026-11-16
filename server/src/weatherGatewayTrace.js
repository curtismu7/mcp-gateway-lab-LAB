// "What Privilege did" (Rule 25) for the mock weather gateway (POST /api/weather/tool). This lab is mock only: Real is reserved and has no
// data path, so the trace is always source 'mock', whatever MODE says. Every decision is 'checked' because evaluateWeatherScope really
// computed it, in the order it runs: the capability flag first, then the scope check, and only a permit reaches the third-party server.
// The request is the JSON-RPC tools/call the agent sends (the same body hop 1 shows); the response is the reply this endpoint sends, minus
// the hops and the trace themselves. The host is a non-real one (.example). The token is the placeholder, never a value.
import { mockTrace } from './gatewayTrace.js';

export function weatherGatewayTrace({ cast, tool, args, policy, decision, reason, body, traceparent, workspace }) {
  const forwarded = decision === 'forward';
  const capabilityOn = policy.showcase !== false;
  return mockTrace({
    url: `https://gateway.${cast.castHost}.example/weather`,
    authorization: 'Bearer <MOCK token>',
    requestHeaders: { traceparent, accept: null },
    rpc: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: args } },
    status: forwarded ? 200 : 403,
    headers: { 'content-type': 'application/json', traceparent },
    body,
    decisions: [
      { id: 'capability', label: 'Weather capability enabled (showcase flag)', outcome: capabilityOn ? 'pass' : 'fail',
        evidence: capabilityOn ? 'the showcase flag is on, so the call goes on to the scope check' : reason },
      { id: 'scope', label: `Scope check against the policy (${policy.allowedState})`, outcome: !capabilityOn ? 'skipped' : forwarded ? 'pass' : 'fail',
        evidence: !capabilityOn ? 'not reached: the capability is off' : reason },
      { id: 'forward', label: 'Forward to the third-party weather server', outcome: forwarded ? 'pass' : 'skipped',
        evidence: forwarded ? 'in scope, so the call was forwarded untouched and the server answered' : 'not reached: a denied call never leaves the gateway, so the backend never sees it' },
    ],
    record: `GET /api/runs (workspace ${workspace}) lists this decision`,
  });
}
