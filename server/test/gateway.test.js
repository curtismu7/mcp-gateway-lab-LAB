import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_POLICY, evaluateWeatherScope, geocodeCity, normalizePolicy } from '../src/gateway.js';

test('normalizePolicy: junk falls back to the NARROWEST state, never wider', () => {
  assert.equal(normalizePolicy(null).allowedState, 'texas');
  assert.equal(normalizePolicy({ allowedState: 'everywhere' }).allowedState, 'texas');
  assert.equal(normalizePolicy({ allowedState: 'any' }).allowedState, 'any');
  assert.equal(normalizePolicy({ showcase: 'yes' }).showcase, true);
  // a half-populated blocked city (missing coordinates) is dropped, not kept name-only
  const p = normalizePolicy({ blockedCities: [{ label: 'miami', lat: 1, lon: 2 }, { label: 'nowhere' }, { label: 'x', lat: 'a', lon: 'b' }] });
  assert.equal(p.blockedCities.length, 1);
  // the blocked list is capped
  assert.equal(normalizePolicy({ blockedCities: Array.from({ length: 20 }, (_, i) => ({ label: `c${i}`, lat: 1, lon: 2 })) }).blockedCities.length, 8);
  // a bad radius is ignored
  assert.equal(normalizePolicy({ blockRadiusDeg: 99 }).blockRadiusDeg, 0.2);
  assert.equal(normalizePolicy({ blockRadiusDeg: 1 }).blockRadiusDeg, 1);
});

test('geocodeCity: known demo cities resolve once, unknown cities are refused (no name-only deny)', () => {
  assert.deepEqual(geocodeCity('MIAMI'), { label: 'miami', lat: 25.7617, lon: -80.1918 });
  assert.equal(geocodeCity('Atlantis'), null);
  assert.equal(geocodeCity(''), null);
  assert.equal(geocodeCity(undefined), null);
});

test('UC30: Austin in Texas forwards; the backend answers', () => {
  const r = evaluateWeatherScope({ policy: DEFAULT_POLICY, args: { city_name: 'Austin' } });
  assert.equal(r.decision, 'forward');
});

test('UC31: Miami under Texas denies before the backend', () => {
  for (const args of [{ city_name: 'Miami' }, { city_name: 'miami' }, { city_name: 'Miami, FL' }, { location: 'Miami' }, { latitude: 25.7617, longitude: -80.1918 }]) {
    const r = evaluateWeatherScope({ policy: DEFAULT_POLICY, args });
    assert.equal(r.decision, 'denied', JSON.stringify(args));
  }
});

test('exact matching: no substring containment', () => {
  // "Plano, IL" is not Plano, TX
  assert.equal(evaluateWeatherScope({ policy: DEFAULT_POLICY, args: { city_name: 'Plano, IL' } }).decision, 'denied');
  assert.equal(evaluateWeatherScope({ policy: DEFAULT_POLICY, args: { city_name: 'Plano, TX' } }).decision, 'forward');
  // "Houston Street, New York, NY" is not Houston, TX
  assert.equal(evaluateWeatherScope({ policy: DEFAULT_POLICY, args: { city_name: 'Houston Street, New York, NY' } }).decision, 'denied');
  // comma-less state qualifier: "austin tx"
  assert.equal(evaluateWeatherScope({ policy: DEFAULT_POLICY, args: { city_name: 'austin tx' } }).decision, 'forward');
  assert.equal(evaluateWeatherScope({ policy: DEFAULT_POLICY, args: { city_name: 'austin co' } }).decision, 'denied');
});

test('the coordinate branch carries the location when the agent geocodes first', () => {
  const inBox = evaluateWeatherScope({ policy: DEFAULT_POLICY, args: { latitude: 30.2672, longitude: -97.7431 } });
  assert.equal(inBox.decision, 'forward');
  const outBox = evaluateWeatherScope({ policy: DEFAULT_POLICY, args: { latitude: 40.7128, longitude: -74.006 } });
  assert.equal(outBox.decision, 'denied');
  // unparseable coordinates under a NAMED state are denied (the gateway cannot verify them); under
  // any-except-blocked they fall through — not a blocked city, the backend rejects them instead
  assert.equal(evaluateWeatherScope({ policy: DEFAULT_POLICY, args: { latitude: 'north', longitude: 'up' } }).decision, 'denied');
});

test('saved locations cannot be verified: denied', () => {
  assert.equal(evaluateWeatherScope({ policy: DEFAULT_POLICY, args: { location_name: 'home' } }).decision, 'denied');
});

test('no location argument: nothing to scope', () => {
  assert.equal(evaluateWeatherScope({ policy: DEFAULT_POLICY, args: {} }).decision, 'forward');
  assert.equal(evaluateWeatherScope({ policy: DEFAULT_POLICY, args: null }).decision, 'forward');
});

test('"any" skips the scope check entirely', () => {
  const p = normalizePolicy({ allowedState: 'any' });
  assert.equal(evaluateWeatherScope({ policy: p, args: { city_name: 'Miami' } }).decision, 'forward');
  assert.equal(evaluateWeatherScope({ policy: p, args: { latitude: 0, longitude: 0 } }).decision, 'forward');
});

test('any-except-blocked: name AND coordinate blocks, differently qualified names stay allowed', () => {
  const p = normalizePolicy({ allowedState: 'any-except-blocked', blockedCities: [geocodeCity('Miami, FL')] });
  assert.equal(evaluateWeatherScope({ policy: p, args: { city_name: 'Miami' } }).decision, 'denied');
  assert.equal(evaluateWeatherScope({ policy: p, args: { city_name: 'Miami, FL' } }).decision, 'denied');
  assert.equal(evaluateWeatherScope({ policy: p, args: { city_name: 'Miami, OH' } }).decision, 'forward', 'a different real city');
  assert.equal(evaluateWeatherScope({ policy: p, args: { latitude: 25.76, longitude: -80.19 } }).decision, 'denied', 'inside the radius');
  assert.equal(evaluateWeatherScope({ policy: p, args: { latitude: 26.5, longitude: -81 } }).decision, 'forward', 'outside the radius');
  assert.equal(evaluateWeatherScope({ policy: p, args: { latitude: 'x', longitude: 'y' } }).decision, 'forward', 'malformed is not a block');
  // non-blocked cities anywhere are fine
  assert.equal(evaluateWeatherScope({ policy: p, args: { city_name: 'Chicago' } }).decision, 'forward');
});

test('the showcase kill switch denies everything, in scope or not', () => {
  const p = normalizePolicy({ showcase: false });
  assert.equal(evaluateWeatherScope({ policy: p, args: { city_name: 'Austin' } }).decision, 'denied');
});

test('an unknown policy value fails narrow: normalizePolicy coerces it to the narrowest state', () => {
  // The normalization step IS the fail-closed enforcement: 'atlantis' behaves exactly as texas would.
  const p = normalizePolicy({ allowedState: 'atlantis' });
  assert.equal(p.allowedState, 'texas');
  assert.equal(evaluateWeatherScope({ policy: { allowedState: 'atlantis' }, args: { city_name: 'Austin' } }).decision, 'forward', 'Austin is in Texas');
  assert.equal(evaluateWeatherScope({ policy: { allowedState: 'atlantis' }, args: { city_name: 'Miami' } }).decision, 'denied', 'Miami is not — the unknown value never widened the boundary');
});

test('hostile input is bounded and inert', () => {
  const long = 'x'.repeat(500);
  assert.equal(evaluateWeatherScope({ policy: DEFAULT_POLICY, args: { city_name: long } }).decision, 'denied');
  const p = normalizePolicy({ allowedState: 'any-except-blocked', blockedCities: [{ label: long, lat: 1, lon: 2 }] });
  assert.ok(p.blockedCities[0].label.length <= 80);
  assert.equal(normalizePolicy({ blockedCities: 'junk' }).blockedCities.length, 0);
});
