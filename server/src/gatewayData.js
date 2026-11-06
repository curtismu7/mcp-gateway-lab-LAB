// The story as data: a third-party weather MCP server scoped at a mock agent gateway, with a live,
// admin-editable state policy. Mirrors the AI-DEMO2 tx-weather-scope gateway policy (UC30/UC31/UC32) in mock.
// Text is {{token}} templated (see cast.js). Every host ends in .example. No real credential, tenant or customer.

export const BANNER = 'SIMULATED: a mock agent gateway, a mock policy store and a mock third-party weather MCP server. Nothing here calls a real gateway, identity provider or tenant.';
export const HOSTED_BANNER = 'HOSTED SIMULATION: a mock agent gateway, a mock policy store and a mock third-party weather MCP server. Nothing here calls a real gateway, identity provider or tenant.';

export const TITLE = "Weather MCP: {{castBrand}}'s agent gateway scopes a third-party tool";
export const INTRO = 'The agent calls an unmodified third-party weather MCP server through the agent gateway. The gateway enforces a live, admin-editable state-scope policy entirely at the edge: the backend never sees the restriction and has no concept of it. Change the policy and the SAME call flips — no restart.';

// status: measured = seen live in AI-DEMO2 (weather-mcp page, tx-weather-scope gateway script); inferred = our reading; UNVERIFIED = not confirmed.
export const FACTS = [
  { id: 'scope-at-edge', status: 'measured', text: 'The scope check runs in the gateway policy BEFORE the call is forwarded: a denied call never reaches the third-party server. The backend is unmodified and policy-blind.', source: 'AI-DEMO2 tx-weather-scope gateway script + weather-mcp page' },
  { id: 'live-flag', status: 'measured', text: 'The allowed state (texas | michigan | any | any-except-blocked) is admin-editable and read on EVERY request — a policy change takes effect on the very next call, with no gateway restart. Leaving the editor restores Texas so the next pass starts from the documented policy.', source: 'AI-DEMO2 ff_weather_mcp_allowed_state feature flag, live-reconfigured on the weather-mcp page' },
  { id: 'name-and-coords', status: 'measured', text: 'The policy checks the city NAME and the COORDINATES: the agent does not always call the tool with a city string — it geocodes first, so the coordinate branch carries the location. The gateway compares the coordinates the agent will send.', source: 'AI-DEMO2 tx-weather-scope: name + bounding-box check' },
  { id: 'no-substring', status: 'measured', text: 'City matching is exact, split on the first comma — no substring containment: "Plano, IL" and "Miami, OH" are real, different cities and stay allowed under Texas-only / blocked-Miami policies.', source: 'AI-DEMO2 tx-weather-scope: exact-match branch' },
  { id: 'fail-narrow', status: 'measured', text: 'The scope policy fails NARROW: an unreadable or unrecognized policy value falls back to the narrowest state (Texas), never to "any". A failure never widens the boundary.', source: 'AI-DEMO2 tx-weather-scope: flag-check defaults' },
  { id: 'malformed-not-policy', status: 'measured', text: 'Unparseable coordinates are NOT treated as a blocked city — the upstream server rejects them instead. A malformed call is not turned into a policy story it is not.', source: 'AI-DEMO2 tx-weather-scope: coordinate branch' },
];

// The gateway policy, as data. A visitor edits these in the UI; the server normalizes them (gateway.js).
export const RULE = {
  name: 'Third-party weather scope (mock gateway policy)',
  appliesTo: 'Agent gateway /weather MCP route https://gateway.{{castHost}}.example/weather',
  note: 'Mock shape of the gateway state-scope policy. Not exported from, or checked against, a real gateway.',
  defaults: { showcase: true, allowedState: 'texas', blockedCities: [], blockRadiusDeg: 0.2 },
};

// The third-party tool catalog, as the gateway advertises it.
export const TOOLS = [
  { name: 'get_current_conditions', tier: 'weather', sampleLocation: 'Austin', lesson: 'The third-party tool. The gateway scopes it; the tool itself would answer any city on earth.' },
  { name: 'check_service_status', tier: 'weather', sampleLocation: null, lesson: 'No location argument — nothing to scope, so it always forwards.' },
];

// Three gateway scenarios, the walkthrough (UC30 permit / UC31 deny / UC32 live reconfigure).
export const SCENARIOS = [
  {
    id: 'texas-permit',
    title: 'PERMIT: Austin under the Texas policy',
    policy: { showcase: true, allowedState: 'texas', blockedCities: [] },
    call: { tool: 'get_current_conditions', arguments: { city_name: 'Austin' } },
    expected: 'forward',
    lesson: 'Austin is in Texas — the gateway forwards the call and the third-party server answers normally. The server never learns a policy exists.',
  },
  {
    id: 'texas-deny',
    title: 'DENY: Miami under the Texas policy',
    policy: { showcase: true, allowedState: 'texas', blockedCities: [] },
    call: { tool: 'get_current_conditions', arguments: { city_name: 'Miami' } },
    expected: 'denied',
    lesson: 'Miami is outside Texas — the gateway refuses BEFORE the third-party server ever sees the request. The backend never runs.',
  },
  {
    id: 'live-reconfigure',
    title: 'RECONFIGURE: the same Miami call after switching to Any',
    policy: { showcase: true, allowedState: 'any', blockedCities: [] },
    call: { tool: 'get_current_conditions', arguments: { city_name: 'Miami' } },
    expected: 'forward',
    lesson: 'The exact same call flips from denied to permitted because the policy changed — live, no restart. The scope is admin-owned, not app logic.',
  },
  {
    id: 'coords-outside',
    title: 'DENY: resolved coordinates outside Texas',
    policy: { showcase: true, allowedState: 'texas', blockedCities: [] },
    call: { tool: 'get_current_conditions', arguments: { latitude: 25.7617, longitude: -80.1918 } },
    expected: 'denied',
    lesson: 'The agent geocoded first and called with latitude/longitude (Miami): the bounding-box branch catches it even without a city name.',
  },
  {
    id: 'qualified-city',
    title: 'ALLOWED: "Miami, OH" is a different city',
    policy: { showcase: true, allowedState: 'any-except-blocked', blockedCities: [{ label: 'miami, fl', lat: 25.7617, lon: -80.1918 }] },
    call: { tool: 'get_current_conditions', arguments: { city_name: 'Miami, OH' } },
    expected: 'forward',
    lesson: 'A differently qualified name does not match the blocked label: Miami, OH is a real, different city. Exact matching, no substring containment.',
  },
  {
    id: 'capability-off',
    title: 'DENY: the capability flag is off',
    policy: { showcase: false, allowedState: 'texas', blockedCities: [] },
    call: { tool: 'get_current_conditions', arguments: { city_name: 'Austin' } },
    expected: 'denied',
    lesson: 'With the showcase flag off, every weather call is refused regardless of location — a capability kill switch above the scope check.',
  },
];

// The talk track, as data, so the web talk-track view and presenter mode read the same words as docs/talk-track.md.
export const TALK_TRACK = [
  { id: 'say-first', title: 'Say first', say: 'Everything here is simulated: the gateway, the policy store and the weather server are mock, mirroring what we ran live in AI-DEMO2.' },
  { id: 'third-party', title: 'The third-party tool', say: 'The weather server is unmodified and policy-blind. Remove the gateway and every city on earth works. That is the point: governance must live at the edge, because you cannot always change the tool.' },
  { id: 'scope', title: 'The scope policy', say: 'The gateway enforces one configurable state at a time — Texas by default — or wide open, or everywhere except an admin-managed blocked-city list. It checks the city name AND the coordinates, exactly, with no substring matching: Plano, IL is not Plano, TX.' },
  { id: 'deny', title: 'Denied at the edge', say: 'A denied call never reaches the third-party server. The backend does not run, does not see the request, and never learns that a policy exists.' },
  { id: 'reconfigure', title: 'Live reconfigure', say: 'The allowed state is admin-editable and read on every request. Switch Texas to Any and the exact same Miami query flips from denied to permitted — no restart, no code change. Leaving the editor restores Texas.' },
  { id: 'fail-narrow', title: 'Fail narrow', say: 'An unreadable or unrecognized policy value falls back to the narrowest state, never to open. A failure never widens the boundary.' },
  { id: 'unverified', title: 'What we do not claim', say: 'The mock weather data is invented and the policy values are demo values. The decision logic follows the gateway script we ran live; the product claims carry their own verification status.' },
  { id: 'close', title: 'Close', say: 'Reset clears your workspace: policy, blocked cities and runs. Nothing was sent anywhere.' },
];
