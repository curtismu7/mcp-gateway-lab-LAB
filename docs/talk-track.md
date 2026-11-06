# Talk track

<!-- Generated from server/src/gatewayData.js by `npm run talk-track`. Do not edit by hand. -->

## Say first

Everything here is simulated: the gateway, the policy store and the weather server are mock, mirroring what we ran live in AI-DEMO2.

## The third-party tool

The weather server is unmodified and policy-blind. Remove the gateway and every city on earth works. That is the point: governance must live at the edge, because you cannot always change the tool.

## The scope policy

The gateway enforces one configurable state at a time — Texas by default — or wide open, or everywhere except an admin-managed blocked-city list. It checks the city name AND the coordinates, exactly, with no substring matching: Plano, IL is not Plano, TX.

## Denied at the edge

A denied call never reaches the third-party server. The backend does not run, does not see the request, and never learns that a policy exists.

## Live reconfigure

The allowed state is admin-editable and read on every request. Switch Texas to Any and the exact same Miami query flips from denied to permitted — no restart, no code change. Leaving the editor restores Texas.

## Fail narrow

An unreadable or unrecognized policy value falls back to the narrowest state, never to open. A failure never widens the boundary.

## What we do not claim

The mock weather data is invented and the policy values are demo values. The decision logic follows the gateway script we ran live; the product claims carry their own verification status.

## Close

Reset clears your workspace: policy, blocked cities and runs. Nothing was sent anywhere.

## The scenarios

1. **PERMIT: Austin under the Texas policy.** Austin is in Texas — the gateway forwards the call and the third-party server answers normally. The server never learns a policy exists.
2. **DENY: Miami under the Texas policy.** Miami is outside Texas — the gateway refuses BEFORE the third-party server ever sees the request. The backend never runs.
3. **RECONFIGURE: the same Miami call after switching to Any.** The exact same call flips from denied to permitted because the policy changed — live, no restart. The scope is admin-owned, not app logic.
4. **DENY: resolved coordinates outside Texas.** The agent geocoded first and called with latitude/longitude (Miami): the bounding-box branch catches it even without a city name.
5. **ALLOWED: "Miami, OH" is a different city.** A differently qualified name does not match the blocked label: Miami, OH is a real, different city. Exact matching, no substring containment.
6. **DENY: the capability flag is off.** With the showcase flag off, every weather call is refused regardless of location — a capability kill switch above the scope check.
