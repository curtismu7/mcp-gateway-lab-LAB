// Rule 13: a workspace id keeps one visitor's state apart from another's. Per workspace: the gateway policy,
// the recent runs. Bounded in count, size and age.
export const WORKSPACE_RE = /^[a-z0-9-]{1,40}$/;
export const DEFAULT_WORKSPACE = 'default';
export const MAX_RUNS = 20;

export function workspaceFrom(req) {
  const raw = req.headers['x-workspace'];
  if (raw === undefined) return DEFAULT_WORKSPACE;
  return typeof raw === 'string' && WORKSPACE_RE.test(raw) ? raw : null;
}

export function createWorkspaces({ max = 500, ttlMs = 60 * 60 * 1000, now = Date.now, defaults } = {}) {
  const map = new Map(); // id -> { runs, at, policy }
  const sweep = () => {
    const t = now();
    for (const [id, v] of map) { if (t - v.at > ttlMs) map.delete(id); else break; }
    while (map.size > max) map.delete(map.keys().next().value);
  };
  const blank = () => ({
    runs: [],
    policy: defaults ? { ...defaults, blockedCities: defaults.blockedCities ? [...defaults.blockedCities] : [] } : null,
  });
  return {
    state(id) {
      sweep();
      let v = map.get(id);
      if (!v) { v = blank(); map.set(id, v); }
      v.at = now();
      return v;
    },
    setPolicy(id, policy) {
      const v = this.state(id);
      v.policy = { ...policy };
      return v.policy;
    },
    runs(id) { sweep(); const v = map.get(id); return { workspace: id, runs: v ? v.runs : [] }; },
    record(id, run) {
      const v = this.state(id);
      v.runs = [...v.runs, { ...run, at: now() }].slice(-MAX_RUNS);
      sweep();
      return v.runs;
    },
    resetWorkspace(id) { map.delete(id); },
    size() { return map.size; },
  };
}
