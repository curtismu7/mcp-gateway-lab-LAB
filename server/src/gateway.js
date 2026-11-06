// The gateway scope engine, mirroring the AI-DEMO2 tx-weather-scope gateway policy (UC30/UC31/UC32) in mock.
// One configurable US state at a time (default Texas), wide open ("any"), or open everywhere except an
// admin-managed blocked-city list ("any-except-blocked"). The engine runs BEFORE the third-party weather
// server; the backend never sees the restriction and has no concept of it.
// Pure functions: no I/O, no clocks. Input is bounded everywhere.

export const LIMITS = { cityName: 80, blockedCities: 8, label: 80, lat: 90, lon: 180, radius: 5 };

// Named-state scope data. Each state: an approximate, generous bounding box and its ~20 largest cities
// (case-insensitive, trimmed, NO substring containment — "Plano, IL" must not match Plano, TX).
export const STATES = {
  texas: {
    label: 'Texas',
    latMin: 25.8, latMax: 36.5, lonMin: -106.6, lonMax: -93.5,
    abbrevs: ['tx', 'texas'],
    cities: ['houston', 'san antonio', 'dallas', 'austin', 'fort worth', 'el paso', 'arlington', 'corpus christi', 'plano', 'laredo', 'lubbock', 'irving', 'garland', 'frisco', 'mckinney', 'amarillo', 'grand prairie', 'brownsville', 'killeen', 'mcallen'],
  },
  michigan: {
    label: 'Michigan',
    latMin: 41.7, latMax: 48.3, lonMin: -90.5, lonMax: -82.1,
    abbrevs: ['mi', 'michigan'],
    cities: ['detroit', 'grand rapids', 'warren', 'sterling heights', 'ann arbor', 'lansing', 'dearborn', 'livonia', 'westland', 'troy', 'farmington hills', 'kalamazoo', 'wyoming', 'southfield', 'rochester hills', 'taylor', 'pontiac', 'novi', 'st. clair shores', 'royal oak'],
  },
};

export const POLICY_MODES = ['texas', 'michigan', 'any', 'any-except-blocked'];
export const DEFAULT_POLICY = { showcase: true, allowedState: 'texas', blockedCities: [], blockRadiusDeg: 0.2 };
// Deliberate default city coordinates (approximate, public knowledge). The lab geocodes a city ONCE when it
// is added, like the real design — no lookup happens in the decision hot path.
const CITY_COORDS = {
  miami: { lat: 25.7617, lon: -80.1918 },
  'miami, fl': { lat: 25.7617, lon: -80.1918 },
  'orlando, fl': { lat: 28.5383, lon: -81.3792 },
  'new york, ny': { lat: 40.7128, lon: -74.006 },
  chicago: { lat: 41.8781, lon: -87.6298 },
  'miami, oh': { lat: 39.8308, lon: -84.5403 },
};

export class GatewayInputError extends Error {
  constructor(code, detail) { super(detail); this.code = code; }
}

const toNum = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') { const n = Number(v.trim()); return Number.isFinite(n) ? n : null; }
  return null;
};

/** Normalize a raw policy object to the canonical shape. Unknown values fall back to the NARROWEST state
 * (texas), never to a wider scope — an outage or a version-skewed value must never widen the policy. */
export function normalizePolicy(raw) {
  const p = { ...DEFAULT_POLICY, blockedCities: [] };
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return p;
  if (typeof raw.showcase === 'boolean') p.showcase = raw.showcase;
  if (POLICY_MODES.includes(raw.allowedState)) p.allowedState = raw.allowedState;
  if (Array.isArray(raw.blockedCities)) {
    p.blockedCities = raw.blockedCities.slice(0, LIMITS.blockedCities)
      .filter((c) => c && typeof c === 'object' && !Array.isArray(c) && typeof c.label === 'string' && c.label.trim())
      .map((c) => {
        const lat = toNum(c.lat); const lon = toNum(c.lon);
        return (lat !== null && lon !== null)
          ? { label: String(c.label).trim().slice(0, LIMITS.label), lat, lon }
          : null;
      })
      .filter(Boolean);
  }
  const r = toNum(raw.blockRadiusDeg);
  if (r !== null && r > 0 && r <= LIMITS.radius) p.blockRadiusDeg = r;
  return p;
}

/** The one geocode a blocked city gets, when it is added (mirrors the BFF geocode-on-add design). */
export function geocodeCity(name) {
  const key = String(name ?? '').toLowerCase().trim().slice(0, LIMITS.cityName);
  const known = CITY_COORDS[key];
  if (known) return { label: key, lat: known.lat, lon: known.lon };
  // Unknown city: refuse the add rather than store an unverifiable coordinate (the deny would be name-only,
  // the exact failure this design exists to avoid).
  return null;
}

// Split on the FIRST comma: "Corpus Christi, TX" -> cityPart + statePart. Exact match on both parts — no
// substring containment — so "Plano, IL" or "Houston Street, New York, NY" are correctly denied.
const nameParts = (city) => {
  const normalized = String(city).toLowerCase().trim().slice(0, LIMITS.cityName);
  const commaIdx = normalized.indexOf(',');
  if (commaIdx >= 0) return { cityPart: normalized.slice(0, commaIdx).trim(), statePart: normalized.slice(commaIdx + 1).trim() };
  return { cityPart: normalized, statePart: '' };
};

const inStateByName = (state, city) => {
  const { cityPart, statePart } = nameParts(city);
  if (statePart !== '') return state.abbrevs.includes(statePart);
  // Also accept "austin tx" (comma-less qualifier) before falling back to the exact allowlist.
  const sp = cityPart.lastIndexOf(' ');
  if (sp > 0 && state.abbrevs.includes(cityPart.slice(sp + 1).trim())) return true;
  return state.cities.includes(cityPart);
};

/**
 * The decision core (UC30 permit / UC31 deny). `args` is the tools/call arguments object.
 * Returns { decision: 'forward' | 'denied', reason } — 'forward' means the gateway passes the call to the
 * third-party server; 'denied' means it refuses before the backend ever sees the request.
 */
export function evaluateWeatherScope({ policy, args }) {
  const p = normalizePolicy(policy);
  if (!p.showcase) {
    return { decision: 'denied', reason: 'weather capability disabled (showcase flag is off)' };
  }
  if (args === null || typeof args !== 'object' || Array.isArray(args)) {
    return { decision: 'forward', reason: 'not a tools/call arguments object — nothing to scope' };
  }

  // Wide open — no restriction at all, every location argument shape passes.
  if (p.allowedState === 'any') return { decision: 'forward', reason: 'policy is "any" — no scope check' };

  const state = STATES[p.allowedState];
  const hasCoords = Object.hasOwn(args, 'latitude') || Object.hasOwn(args, 'longitude');
  const city = typeof args.city_name === 'string' ? args.city_name : (typeof args.location === 'string' ? args.location : null);

  if (!p.allowedState || !POLICY_MODES.includes(p.allowedState)) {
    // An unknown policy value must never widen the boundary: deny before any scope evaluation.
    return { decision: 'denied', reason: 'unknown policy state (fail closed)' };
  }

  // BOTH shapes on one call: check BOTH, deny if EITHER fails. A caller cannot launder a denied
  // city name through a second argument shape (e.g. "Plano, IL" + in-state coordinates).
  if (hasCoords && city) {
    const byCoords = evaluateWeatherScope({ policy: p, args: { latitude: args.latitude, longitude: args.longitude } });
    if (byCoords.decision === 'denied') return byCoords;
    const byName = evaluateWeatherScope({ policy: p, args: { city_name: city } });
    if (byName.decision === 'denied') return byName;
    return { decision: 'forward', reason: `city and coordinates are in ${STATES[p.allowedState]?.label || 'scope'}` };
  }

  if (p.allowedState === 'any-except-blocked') {
    if (hasCoords) {
      const dLat = toNum(args.latitude); const dLon = toNum(args.longitude);
      // Unparseable coordinates are NOT a blocked city — the upstream server rejects them instead. Denying
      // here would turn a malformed call into a policy story it is not.
      if (dLat !== null && dLon !== null) {
        const hit = p.blockedCities.find((c) => Math.abs(dLat - c.lat) <= p.blockRadiusDeg && Math.abs(dLon - c.lon) <= p.blockRadiusDeg);
        if (hit) return { decision: 'denied', reason: `${hit.label} is blocked by demo policy (coordinate match)` };
      }
      return { decision: 'forward', reason: 'coordinates do not match a blocked city' };
    }
    if (city) {
      // Match the typed name against each label on its own terms: "Miami, FL" blocks bare "miami", but a
      // DIFFERENTLY qualified name does not — "Miami, OH" is a real, different city and stays allowed.
      const d = nameParts(city);
      const hit = p.blockedCities.find((c) => {
        const l = nameParts(c.label);
        return d.cityPart === l.cityPart && (d.statePart === '' || l.statePart === '' || d.statePart === l.statePart);
      });
      if (hit) return { decision: 'denied', reason: `${hit.label} is blocked by demo policy (name match)` };
      return { decision: 'forward', reason: 'city is not on the blocked list' };
    }
    return { decision: 'forward', reason: 'no location argument to scope' };
  }


  if (hasCoords) {
    const latVal = toNum(args.latitude); const lonVal = toNum(args.longitude);
    if (latVal === null || lonVal === null) {
      return { decision: 'denied', reason: `weather scope restricted to ${state.label} (demo policy) — invalid or incomplete coordinates` };
    }
    if (latVal < state.latMin || latVal > state.latMax || lonVal < state.lonMin || lonVal > state.lonMax) {
      return { decision: 'denied', reason: `weather scope restricted to ${state.label} (demo policy) — coordinates outside ${state.label}` };
    }
    return { decision: 'forward', reason: `coordinates are inside ${state.label}` };
  }

  if (city) {
    if (!inStateByName(state, city)) {
      return { decision: 'denied', reason: `weather scope restricted to ${state.label} (demo policy) — city not recognized as ${state.label}` };
    }
    return { decision: 'forward', reason: `${city.trim()} is in ${state.label}` };
  }

  if (Object.hasOwn(args, 'location_name')) {
    return { decision: 'denied', reason: `weather scope restricted to ${state.label} (demo policy) — saved locations cannot be verified` };
  }

  // No location argument at all (e.g. check_service_status) — nothing to scope.
  return { decision: 'forward', reason: 'no location argument to scope' };
}
