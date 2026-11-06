// The THIRD-PARTY weather MCP server, mock. It is deliberately unmodified and policy-blind: it answers
// whatever the gateway forwards and has no concept of a state scope. If the gateway is removed, every
// city works — that is the point of the demo. Data is invented (fixture weather), hosts are .example.

const FIXTURES = {
  austin: { temp_f: 82, sky: 'sunny', wind_mph: 8 },
  houston: { temp_f: 88, sky: 'humid', wind_mph: 10 },
  dallas: { temp_f: 85, sky: 'partly cloudy', wind_mph: 12 },
  'el paso': { temp_f: 91, sky: 'sunny', wind_mph: 6 },
  detroit: { temp_f: 47, sky: 'overcast', wind_mph: 14 },
  'ann arbor': { temp_f: 45, sky: 'rain', wind_mph: 11 },
  lansing: { temp_f: 44, sky: 'cloudy', wind_mph: 9 },
  miami: { temp_f: 86, sky: 'thunderstorms', wind_mph: 15 },
  chicago: { temp_f: 52, sky: 'windy', wind_mph: 22 },
};

// A deterministic pseudo-forecast for any other city: same input, same answer, no state kept.
function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967295;
}

const clean = (v, max = 80) => String(v ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').trim().slice(0, max);

export const WEATHER_TOOLS = [
  { name: 'get_current_conditions', description: 'Current conditions for a city (third-party tool, policy-blind)' },
  { name: 'check_service_status', description: 'Weather service health (no location argument)' },
];

/** Handles one tools/call. Expects { name, arguments }. Never enforces policy — that is the gateway's job. */
export function callWeatherTool({ name, arguments: args }) {
  const tool = String(name ?? '').slice(0, 64);
  if (tool === 'check_service_status') {
    return { ok: true, content: [{ type: 'text', text: JSON.stringify({ service: 'up', provider: 'third-party weather (mock)' }) }] };
  }
  if (tool !== 'get_current_conditions') {
    return { ok: false, error: { code: -32602, message: `unknown tool: ${tool}` } };
  }
  const city = clean(typeof args?.city_name === 'string' ? args.city_name : args?.location, 80);
  if (!city) {
    // Coordinates without a resolved city: the third-party service answers the point (fixture-free hash forecast).
    const lat = Number(args?.latitude); const lon = Number(args?.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      const h = hash(`${lat},${lon}`);
      return {
        ok: true,
        content: [{ type: 'text', text: JSON.stringify({ lat, lon, provider: 'third-party weather (mock)', temp_f: Math.round(30 + h * 60), sky: ['sunny', 'cloudy', 'rain', 'partly cloudy'][Math.floor(h * 4)], wind_mph: Math.round(3 + h * 20) }) }],
      };
    }
    return { ok: false, error: { code: -32602, message: 'city_name (or location) is required' } };
  }
  const key = city.toLowerCase();
  const base = Object.hasOwn(FIXTURES, key) ? FIXTURES[key] : null;
  const h = hash(key);
  const conditions = base
    ? { ...base }
    : { temp_f: Math.round(30 + h * 60), sky: ['sunny', 'cloudy', 'rain', 'partly cloudy'][Math.floor(h * 4)], wind_mph: Math.round(3 + h * 20) };
  return {
    ok: true,
    content: [{ type: 'text', text: JSON.stringify({ city, provider: 'third-party weather (mock)', ...conditions }) }],
  };
}
