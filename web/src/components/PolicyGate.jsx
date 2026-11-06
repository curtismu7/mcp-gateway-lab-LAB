import { useCallback, useEffect, useRef, useState } from "react";
import Json from "./Json";
import { runTool, getPolicy, setPolicy as postPolicy } from "../api";
import { visible } from "../safeText";

const STATUS_CLASS = { measured: "tag tag--ok", inferred: "tag", UNVERIFIED: "tag tag--warn" };

export function Hops({ hops, traceId }) {
  return (
    <section aria-label="Mock hops with traceparent" data-testid="hops">
      <h3>Hops (W3C traceparent) <span className="muted">trace {traceId}</span></h3>
      {hops.map((h) => (
        <details key={h.n} open={h.n === 1}>
          <summary>{h.n}. {h.label}</summary>
          <p className="muted">Request</p><Json value={h.request} label={`Request of hop ${h.n}`} />
          <p className="muted">Response</p><Json value={h.response} label={`Response of hop ${h.n}`} />
        </details>
      ))}
    </section>
  );
}

export function Verdict({ run }) {
  if (!run) return <p className="muted" data-testid="verdict-empty">Pick a scenario to run it.</p>;
  const cls = run.decision === "forward" ? "allow" : "deny";
  const word = run.decision === "forward" ? "FORWARDED — in scope, the third-party server answers" : "DENIED — refused at the gateway, the backend never ran";
  return (
    <div className={`verdict verdict--${cls}`} data-testid="verdict" role="status">
      <strong className="verdict__word">{word}</strong>
      {run.reason && <p className="reason" data-reason="scope">{visible(run.reason)}</p>}
      {run.weather && <p data-testid="weather">Weather (from the mock third-party server): <code>{visible(run.weather)}</code></p>}
    </div>
  );
}

const STATE_OPTIONS = [
  { id: "texas", label: "Texas (default demo policy)" },
  { id: "michigan", label: "Michigan" },
  { id: "any", label: "Any (no restriction)" },
  { id: "any-except-blocked", label: "Any except blocked cities" },
];

const BLOCKABLE = ["Miami, FL", "Orlando, FL", "New York, NY", "Chicago", "Miami, OH"];

/** Policy editor: the admin-editable, live allowed state (UC32). The visitor IS the admin here. */
function PolicyEditor({ current, onSaved }) {
  const [policy, setPolicy] = useState(() => ({ blockedCities: [], ...current }));
  const [msg, setMsg] = useState(null);
  useEffect(() => setPolicy({ blockedCities: [], ...current }), [current]);
  const save = async (next) => {
    setMsg(null);
    const res = await postPolicy({ policy: next }).catch(() => ({ ok: false }));
    setMsg(res.ok ? "Policy saved — it is read on every request, so the very next call already uses it." : res.body?.detail || "Could not save the policy.");
    if (res.ok) onSaved(res.body.policy);
  };
  const toggleCity = (label) => {
    const has = (policy.blockedCities || []).some((c) => c.label === label.toLowerCase());
    const next = has
      ? (policy.blockedCities || []).filter((c) => c.label !== label.toLowerCase())
      : [...(policy.blockedCities || []), label];
    save({ ...policy, blockedCities: next });
  };
  return (
    <section className="panel" aria-labelledby="policy-h" data-testid="policy-editor" id="policy">
      <h2 id="policy-h">Gateway scope policy (admin-editable, live)</h2>
      <p className="muted">The business boundary, enforced entirely at the gateway. It is read on EVERY request: change it and the same call flips, with no restart. This is the mock of the allowed-state flag.</p>
      <label htmlFor="policy-state">Allowed state</label>
      <select id="policy-state" value={policy.allowedState} onChange={(e) => save({ ...policy, allowedState: e.target.value })} data-testid="policy-state">
        {STATE_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
      <fieldset>
        <legend>Blocked cities (only in "Any except blocked cities" mode; geocoded once at add time)</legend>
        {BLOCKABLE.map((label) => (
          <label className="chk" key={label}>
            <input type="checkbox" checked={(policy.blockedCities || []).some((c) => c.label === label.toLowerCase())} onChange={() => toggleCity(label)} />
            {label}
          </label>
        ))}
      </fieldset>
      <label className="chk">
        <input type="checkbox" checked={policy.showcase !== false} onChange={(e) => save({ ...policy, showcase: e.target.checked })} data-testid="policy-showcase" />
        weather capability enabled (off = every weather call is refused regardless of location)
      </label>
      {msg && <p className="muted" role="status" data-testid="policy-msg">{msg}</p>}
    </section>
  );
}

/** The gateway: pick a tool and location, run the call through the scope check. */
function ToolCall({ tools, onResult }) {
  const [tool, setTool] = useState(tools[0].name);
  const [city, setCity] = useState("Austin");
  const [asCoords, setAsCoords] = useState(false);
  const [lat, setLat] = useState("25.7617");
  const [lon, setLon] = useState("-80.1918");
  const [fail, setFail] = useState(null);
  const run = async () => {
    setFail(null);
    const args = asCoords ? { latitude: lat, longitude: lon } : { city_name: city };
    const res = await runTool({ tool, arguments: args, scenario: "custom" }).catch(() => ({ ok: false, status: 0, body: {} }));
    if (res.ok || res.body.decision) onResult(res.body);
    else setFail(`Could not call the gateway (${res.body.detail || res.body.error || res.status}).`);
  };
  return (
    <section className="panel" aria-labelledby="call-h" data-testid="tool-call">
      <h2 id="call-h">Call the third-party tool through the gateway</h2>
      <p className="muted">One agent-originated tools/call: the gateway measures it against the policy BEFORE the third-party server ever sees it.</p>
      <label htmlFor="call-tool">Tool</label>
      <select id="call-tool" value={tool} onChange={(e) => setTool(e.target.value)}>
        {tools.map((t) => <option key={t.name} value={t.name}>{t.name} ({t.tier})</option>)}
      </select>
      {tool !== "check_service_status" && (
        <>
          <label className="chk">
            <input type="checkbox" checked={asCoords} onChange={(e) => setAsCoords(e.target.checked)} data-testid="as-coords" />
            call with resolved coordinates (the agent geocodes first)
          </label>
          {!asCoords && (
            <>
              <label htmlFor="call-city">City</label>
              <input id="call-city" type="text" maxLength={80} value={city} onChange={(e) => setCity(e.target.value)} data-testid="call-city" />
            </>
          )}
          {asCoords && (
            <>
              <label htmlFor="call-lat">Latitude</label>
              <input id="call-lat" type="text" maxLength={20} value={lat} onChange={(e) => setLat(e.target.value)} />
              <label htmlFor="call-lon">Longitude</label>
              <input id="call-lon" type="text" maxLength={20} value={lon} onChange={(e) => setLon(e.target.value)} />
            </>
          )}
        </>
      )}
      <button type="button" onClick={run} data-testid="call-run">Call as the agent</button>
      {fail && <p className="field-error" role="alert">{fail}</p>}
    </section>
  );
}

export default function PolicyGate({ story, resetSignal, requestedId, onSelect }) {
  const known = (v) => story.scenarios.some((s) => s.id === v);
  const [id, setId] = useState(known(requestedId) ? requestedId : story.scenarios[0].id);
  useEffect(() => { if (known(requestedId)) setId(requestedId); }, [requestedId]); // eslint-disable-line react-hooks/exhaustive-deps
  const [policy, setPolicyState] = useState(null);
  const [run, setRun] = useState(null);
  const [fail, setFail] = useState(null);
  const scenario = story.scenarios.find((s) => s.id === id) || story.scenarios[0];

  const loadPolicy = useCallback(async () => {
    const j = await getPolicy().catch(() => null);
    if (j) setPolicyState(j.policy);
  }, []);
  useEffect(() => { loadPolicy(); }, [loadPolicy, resetSignal]);

  // Run a shipped scenario: set its policy, then make the call — exactly what the gateway measures.
  // A run token drops a stale in-flight chain when the visitor switches scenarios mid-run.
  const runToken = useRef(0);
  const runScenario = useCallback(async (sid, { applyPolicy = true } = {}) => {
    const token = ++runToken.current;
    const drop = () => token !== runToken.current;
    setFail(null);
    const sc = story.scenarios.find((s) => s.id === sid) || story.scenarios[0];
    if (applyPolicy) {
      const saved = await postPolicy({ policy: sc.policy }).catch(() => null);
      if (drop()) return;
      if (saved) setPolicyState(saved.body.policy);
    }
    const res = await runTool({ tool: sc.call.tool, arguments: sc.call.arguments, scenario: sc.id }).catch(() => ({ ok: false, status: 0, body: {} }));
    if (drop()) return;
    if (res.ok || res.body.decision) setRun(res.body); else { setRun(null); setFail(`Could not evaluate (${res.body.detail || res.body.error || res.status}).`); }
  }, [story]);

  useEffect(() => { setRun(null); }, [resetSignal]);
  useEffect(() => { runScenario(id); }, [id, resetSignal, runScenario]); // eslint-disable-line react-hooks/exhaustive-deps

  // A policy save re-runs the SAME call under the new policy (UC32): the editor's policy, not the scenario's.
  const onPolicySaved = useCallback((p) => { setPolicyState(p); runScenario(id, { applyPolicy: false }); }, [id, runScenario]);

  return (
    <div className="gate">
      <section className="panel" aria-labelledby="sc-h">
        <h2 id="sc-h">Scenarios</h2>
        <div className="seg" role="group" aria-label="Scenario">
          {story.scenarios.map((s) => <button key={s.id} type="button" aria-pressed={s.id === id} onClick={() => { setId(s.id); if (onSelect) onSelect(s.id); }}>{s.title}</button>)}
        </div>
        <p className="lesson" data-testid="lesson">{scenario.lesson}</p>
      </section>
      <section className="panel" aria-labelledby="res-h">
        <h2 id="res-h">Gateway result</h2>
        {fail && <p className="field-error" role="alert">{fail}</p>}
        <Verdict run={run} />
        {run && <Hops hops={run.hops} traceId={run.traceId} />}
      </section>
      {policy && <PolicyEditor current={policy} onSaved={onPolicySaved} />}
      <ToolCall tools={story.tools} onResult={(r) => setRun(r)} />
      <section className="panel" aria-labelledby="policy-h2">
        <h2 id="policy-h2">Scenario policy (decoded)</h2>
        <p className="tag tag--warn">{story.tokenLabel}</p>
        <Json value={{ policy: scenario.policy, call: scenario.call }} label="Scenario input" testId="scenario-prefs" />
        <h3>What we know, and how well</h3>
        <ul className="facts" data-testid="facts">
          {story.facts.map((f) => <li key={f.id}><span className={STATUS_CLASS[f.status] || "tag"}>{f.status}</span> {visible(f.text)} <span className="muted">({visible(f.source)})</span></li>)}
        </ul>
      </section>
    </div>
  );
}
