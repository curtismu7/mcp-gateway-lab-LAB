# Changelog

## Unreleased
- AirGuard Airlines (a fictional airline) is the default story: a fourth vertical pack `airlines` (host `airguard`, agent `passenger-chat-agent`) is first in the Vertical menu and the default on the server and in the web app; `retail`, `health` and `finance` still work by `?vertical=` or a saved choice. The page title reads "the {{castBrand}} agent gateway" so the airline name needs no possessive. The weather policy and scenarios are unchanged. Tests for the default, the other three packs and a retired-names sweep over the airline run; the repo guard also bars the earlier airline brands.
- Diagram: arrow labels are drawn in a layer above the boxes and placed so none overlaps another label or sits on a box (the walked arrow's label turns bold and coloured and is raised); click a box and it expands in place with its details below its title: its kind, reach (boxes upstream and downstream), and the arrows in and out (each opens that box), on a card with colour that means something (blue where it is, green what it sends to, amber what reaches it). Click again, Close, the empty canvas or Reset collapses it; Copy link and `?box=<id>` open the page with a box expanded. The shared `diagram-kit` (vendored into `web/src/diagram-kit/`, pinned) does the work.

- The Rule 25 trace panel is headed "What the gateway did" (the lab passes the shared panel its `title` prop) instead of the shared default "What Privilege did", which this lab never involves. The panel's lead sentence still names the Privilege gateway; that wording is in the shared component. 1 web test extended.
- The header shows this lab's own Verified / In progress mark from the demo shelf, through the shared `VerifyMark` (vendored from AI-DEMO-Standalone `shared/verify-mark`, pinned): in the top menu beside the Shelf link, nothing when the shelf has no mark for the lab. 2 web tests.

## v1.261028 AgentCore governance (2026-10-28)

- New tab "v1.261028 AgentCore": capability tables read from the binary diff, a runtime-bypass check and a gateway-caller-class check (pure engines in `server/src/agentcoreGov.js`, data in `agentcoreData.js`), `GET /api/agentcore`, `POST /api/agentcore/evaluate`, talk-track entry, 6 server tests and 3 web tests. Everything INFERRED; the real rules were not observed.

## v1.261027 scope gates (2026-10-28)

- New tab "v1.261027 scope gates": Cedar scope gate (Active vs candidate), PingFederate resource parameter trap, RequiredClaims scope tiers. Pure engines in `server/src/scopeGate.js`, data in `scopeData.js`, `GET /api/scope-gate`, `POST /api/scope-gate/evaluate` (scenario id plus optional own scope, bounded), a second diagram-studio/1 diagram (`scope-gate`), talk-track entry, 6 server tests and 4 web tests.

## 0.1.0 (unreleased)
- Step 1 (core, server and data), scaffolded from a sibling demo scaffold: pure `evaluateClaims` (nested dotted-path matching, flatten, bounded input), five claim-gate scenarios as `{{token}}` data in three vertical packs, AgentCore gateway posture mock (shape only), claim-gate diagram as diagram-studio/1 data, workspace-scoped evaluations and Reset, doctor, content pack, k8s manifests (not deployed). The web UI is step 2 (a placeholder page for now).
- Ports 5150-5199.
- Step 2: web UI (claim gate, posture, diagram, talk track, presenter mode), W3C traceparent on every mock hop, talk track as data, claim-gate diagram spacing.
