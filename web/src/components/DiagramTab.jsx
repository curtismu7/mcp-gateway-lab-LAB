import { useEffect, useMemo, useState } from "react";
import PatternDiagram from "./PatternDiagram";
import { getJson } from "../api";

/** The run's hops as the kit's call data, one entry per arrow. Verdict: PERMIT->ok, DENY->deny, else held. */
function hopCalls(run) {
  if (!run || !Array.isArray(run.hops)) return [];
  const verdict = run.decision === "PERMIT" ? "ok" : run.decision === "DENY" ? "deny" : "held";
  return run.hops.map((h) => ({ from: h.from, to: h.to, hop: { title: h.label, fact: h.label, verdict, request: h.request, response: h.response } })).filter((c) => c.from !== c.to);
}

export default function DiagramTab({ vertical, resetSignal, run = null }) {
  const [pattern, setPattern] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => { setPattern(null); getJson(`/api/diagram?vertical=${encodeURIComponent(vertical)}&name=gateway-scope-flow`).then(setPattern, (e) => setError(e.message)); }, [vertical]);
  // The gate tab's last run's hops ride on the matching arrows: the expanded box shows what went over the wire.
  const withHops = useMemo(() => {
    if (!pattern) return null;
    const calls = hopCalls(run);
    if (!calls.length) return pattern;
    const steps = pattern.steps.map((st) => ({ ...st }));
    let ci = 0;
    for (const st of steps) if (st.from === calls[ci]?.from && st.to === calls[ci]?.to) st.hop = calls[ci++].hop;
    return { ...pattern, steps };
  }, [pattern, run]);
  if (error) return <p className="field-error" role="alert">Could not load the diagram ({error}).</p>;
  if (!withHops) return <p className="muted">Loading...</p>;
  return (
    <>
      <PatternDiagram key={vertical} pattern={withHops} resetSignal={resetSignal} />
    </>
  );
}
