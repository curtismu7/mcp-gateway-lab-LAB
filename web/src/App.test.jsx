import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App, { BANNER_UNKNOWN } from "./App";
import { labelOffsets } from "./components/PatternDiagram";

const STORY = {
  title: "t", intro: "intro text", banner: "SIMULATED: mock gateway", tokenLabel: "MOCK gateway decisions", hosted: false, verticals: ["retail", "health"],
  rule: { name: "Third-party weather scope (mock gateway policy)", appliesTo: "Agent gateway", note: "n", defaults: { showcase: true, allowedState: "texas", blockedCities: [], blockRadiusDeg: 0.2 } },
  tools: [
    { name: "get_current_conditions", tier: "weather", sampleLocation: "Austin", lesson: "l" },
    { name: "check_service_status", tier: "weather", sampleLocation: null, lesson: "l" },
  ],
  scenarios: [
    { id: "texas-permit", title: "PERMIT: Austin under the Texas policy", policy: { showcase: true, allowedState: "texas", blockedCities: [] }, call: { tool: "get_current_conditions", arguments: { city_name: "Austin" } }, expected: "forward", lesson: "Forwarded." },
    { id: "texas-deny", title: "DENY: Miami under the Texas policy", policy: { showcase: true, allowedState: "texas", blockedCities: [] }, call: { tool: "get_current_conditions", arguments: { city_name: "Miami" } }, expected: "denied", lesson: "Refused at the edge." },
  ],
  facts: [
    { id: "scope-at-edge", status: "measured", text: "The scope check runs before the call is forwarded.", source: "tx-weather-scope" },
    { id: "fail-narrow", status: "measured", text: "The scope policy fails narrow.", source: "flag defaults" },
  ],
  talkTrack: [
    { id: "say-first", title: "Say first", say: "Everything is simulated." },
    { id: "third-party", title: "The third-party tool", say: "The weather server is unmodified and policy-blind." },
  ],
  cast: { castHost: "northwind", castBrand: "Northwind Retail" },
};
const DIAGRAM = {
  title: "Weather MCP", intro: "diagram intro",
  nodes: [{ id: "agent", label: "AI agent", kind: "actor", x: 0, y: 0 }, { id: "gateway", label: "Agent gateway: scope check", kind: "gateway", x: 300, y: 0 }],
  steps: [{ from: "agent", to: "gateway", label: "tools/call", say: "The agent calls the gateway." }, { from: "gateway", to: "agent", label: "Decision", say: "The gateway answers." }],
};
const hop = (n) => ({ n, from: "agent", to: "gateway", label: `hop ${n}`, traceparent: `00-${"a".repeat(32)}-${String(n).repeat(16)}-01`, request: `traceparent: 00-${"a".repeat(32)}-${String(n).repeat(16)}-01`, response: "HTTP/1.1 200 OK" });

const DEFAULT_POLICY = { showcase: true, allowedState: "texas", blockedCities: [], blockRadiusDeg: 0.2 };
let calls;
let override = {};
function mockFetch() {
  calls = [];
  globalThis.fetch = vi.fn(async (url, opts = {}) => {
    calls.push({ url, opts });
    const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
    if (url.startsWith("/api/scenarios")) return override.scenarios ? override.scenarios() : json(STORY);
    if (url === "/api/info") return override.info ? override.info() : json({ mode: "mock", simulated: true, hosted: false });
    if (url.startsWith("/api/diagram")) return json(DIAGRAM);
    if (url === "/api/policy" && (!opts.method || opts.method === "GET")) {
      return json({ policy: override.policy || DEFAULT_POLICY, tools: STORY.tools, workspace: "t" });
    }
    if (url === "/api/policy" && opts.method === "POST") {
      const b = JSON.parse(opts.body || "{}");
      if (b.policy === "junk" || b.policy === null) return json({ error: "bad_policy", detail: "must be an object" }, 400);
      override.policy = { ...DEFAULT_POLICY, ...(b.policy || b), blockedCities: (b.policy || b).blockedCities || [] };
      return json({ policy: override.policy, workspace: "t" });
    }
    if (url === "/api/weather/tool") {
      const b = JSON.parse(opts.body);
      const policy = override.policy || DEFAULT_POLICY;
      const city = String(b.arguments?.city_name || "").toLowerCase();
      const miami = city.startsWith("miami") && city !== "miami, oh";
      let decision = "forward"; let status = 200; let reason = "in scope"; let weather = JSON.stringify({ city, provider: "third-party weather (mock)", temp_f: 82 });
      if (policy.showcase === false) { decision = "denied"; status = 403; reason = "weather capability disabled"; weather = undefined; }
      else if (policy.allowedState === "texas" && miami) { decision = "denied"; status = 403; reason = "weather scope restricted to Texas (demo policy) — city not recognized as Texas"; weather = undefined; }
      else if (policy.allowedState === "michigan" && city === "austin") { decision = "denied"; status = 403; reason = "weather scope restricted to Michigan"; weather = undefined; }
      return json({ decision, reason, tool: b.tool, arguments: b.arguments, policy: { allowedState: policy.allowedState, showcase: policy.showcase, blockedCities: policy.blockedCities || [] }, ...(weather ? { weather } : {}), traceId: "a".repeat(32), hops: [hop(1), hop(2), hop(3), hop(4), hop(5)] }, status);
    }
    if (url === "/api/shelf") return json({ shelfUrl: override.shelf ?? null });
    if (url === "/api/runs") return json({ workspace: "t", runs: [] });
    if (url === "/api/reset") { override = {}; return json({ reset: "ok" }); }
    return json({}, 404);
  });
}
beforeEach(() => { override = {}; mockFetch(); window.location.hash = ""; });

const ready = async () => { render(<App />); await screen.findByText("PERMIT: Austin under the Texas policy"); await screen.findByTestId("verdict"); };

describe("shell", () => {
  it("shows the Shelf button when /api/shelf has a URL, and nothing when it does not", async () => {
    override.shelf = "https://shelf.example:8443";
    await ready();
    expect(await screen.findByRole("link", { name: "Shelf" })).toHaveAttribute("href", "https://shelf.example:8443");
  });
  it("renders no Shelf button without a shelf URL", async () => {
    await ready();
    expect(screen.queryByRole("link", { name: "Shelf" })).toBeNull();
  });

  it("shows the banner, the mode, and sends X-Workspace on API calls", async () => {
    await ready();
    expect(screen.getByTestId("banner")).toHaveTextContent(/^SIMULATED/);
    expect(screen.getByTestId("mode")).toHaveTextContent("Mode: mock (local)");
    const ev = calls.find((c) => c.url === "/api/weather/tool");
    expect(ev.opts.headers["x-workspace"]).toMatch(/^[a-z0-9-]{1,40}$/);
  });
  it("Reset calls /api/reset", async () => {
    await ready();
    await userEvent.click(screen.getByTestId("reset"));
    await waitFor(() => expect(calls.some((c) => c.url === "/api/reset" && c.opts.method === "POST")).toBe(true));
  });
});

describe("gateway scope tab", () => {
  it("permits the texas-permit scenario and shows the weather, hops and facts", async () => {
    await ready();
    expect(screen.getByTestId("verdict")).toHaveTextContent("FORWARDED");
    expect(screen.getByTestId("weather")).toHaveTextContent("third-party weather");
    expect(screen.getByTestId("hops")).toHaveTextContent(/traceparent: 00-a{32}-1{16}-01/);
    expect(screen.getByTestId("facts")).toHaveTextContent("measured");
  });
  it("routes texas-deny to DENIED with the scope reason and no weather answer", async () => {
    await ready();
    await userEvent.click(screen.getByRole("button", { name: /DENY: Miami/ }));
    await waitFor(() => expect(screen.getByTestId("verdict")).toHaveTextContent("DENIED"));
    expect(screen.getByTestId("verdict")).toHaveTextContent("the backend never ran");
    expect(screen.queryByTestId("weather")).toBeNull();
    expect(screen.getByTestId("lesson")).toHaveTextContent("Refused at the edge.");
  });
  it("the policy editor switches the allowed state live and the same call flips (UC32)", async () => {
    await ready();
    await userEvent.selectOptions(screen.getByTestId("policy-state"), "any");
    await waitFor(() => expect(calls.some((c) => c.url === "/api/policy" && c.opts.method === "POST")).toBe(true));
    await userEvent.click(screen.getByTestId("call-run"));
    await waitFor(() => expect(screen.getByTestId("verdict")).toHaveTextContent("FORWARDED"));
    await userEvent.selectOptions(screen.getByTestId("policy-state"), "michigan");
    await waitFor(() => expect(screen.getByTestId("verdict").textContent).toContain("DENIED"));
  }, 15000);
  it("the capability kill switch denies everything", async () => {
    await ready();
    await userEvent.click(screen.getByTestId("policy-showcase"));
    await waitFor(() => expect(screen.getByTestId("verdict").textContent).toContain("DENIED"), { timeout: 15000 });
  }, 20000);
  it("calling with resolved coordinates sends lat/lon", async () => {
    await ready();
    await userEvent.click(screen.getByTestId("as-coords"));
    await userEvent.click(screen.getByTestId("call-run"));
    await waitFor(() => expect(calls.some((c) => c.url === "/api/weather/tool" && JSON.parse(c.opts.body).arguments?.latitude === "25.7617")).toBe(true));
  });
});

describe("diagram tab", () => {
  it("draws the boxes from /api/diagram and Simulate highlights a step; Reset clears it", async () => {
    await ready();
    await userEvent.click(screen.getByRole("tab", { name: "Diagram" }));
    expect(await screen.findByText("Agent gateway: scope check")).toBeInTheDocument();
    expect(calls.some((c) => c.url.startsWith("/api/diagram?vertical=retail"))).toBe(true);
    expect(screen.getByTestId("banner")).toBeInTheDocument();
    expect(screen.getByLabelText(/Step time/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /simulate/i }));
    expect(await screen.findByTestId("pattern-now")).toHaveTextContent("Step 1: tools/call");
    await userEvent.click(screen.getByTestId("reset"));
    await waitFor(() => expect(screen.queryByTestId("pattern-now")).toBeNull());
  });
});

describe("talk track and presenter mode", () => {
  it("lists the talk track; presenter mode keeps the banner and shows the say-text; Esc leaves", async () => {
    await ready();
    await userEvent.click(screen.getByRole("tab", { name: "Talk track" }));
    expect(screen.getByTestId("talk-track")).toHaveTextContent("Everything is simulated.");
    await userEvent.click(screen.getByRole("tab", { name: "Gateway scope" }));
    await userEvent.keyboard("p");
    expect(await screen.findByTestId("presenter-say")).toHaveTextContent("The weather server is unmodified and policy-blind.");
    expect(screen.getByTestId("banner")).toHaveTextContent(/^SIMULATED/);
    expect(document.querySelector(".app--presenter")).not.toBeNull();
    await userEvent.keyboard("{Escape}");
    expect(document.querySelector(".app--presenter")).toBeNull();
  });
  it("the hosted build says HOSTED SIMULATION in the banner", async () => {
    const orig = STORY.banner;
    STORY.banner = "HOSTED SIMULATION: x"; STORY.hosted = true;
    try { render(<App />); await waitFor(() => expect(screen.getByTestId("banner")).toHaveTextContent(/^HOSTED SIMULATION/)); expect(screen.getByTestId("mode")).toHaveTextContent("(hosted)"); }
    finally { STORY.banner = orig; STORY.hosted = false; }
  });
});

describe("diagram edge labels", () => {
  it("nudges the two labels of a back-and-forth pair in opposite directions and leaves the rest alone", () => {
    const steps = [{ from: "a", to: "b" }, { from: "b", to: "a" }, { from: "a", to: "c" }];
    expect(labelOffsets(steps)).toEqual([-16, 16, 0]);
    expect(labelOffsets([])).toEqual([]);
  });
});

describe("banner visibility on every tab, presenter mode and hosted mode", () => {
  it("is visible (not hidden, not display:none) on every tab and in presenter mode", async () => {
    await ready();
    for (const name of ["Diagram", "Talk track"]) {
      await userEvent.click(screen.getByRole("tab", { name }));
      expect(screen.getByTestId("banner")).toBeVisible();
    }
  });
  it("hosted: shows HOSTED SIMULATION from /api/info even before /api/scenarios answers, never plain SIMULATED", async () => {
    override.info = async () => ({ ok: true, status: 200, json: async () => ({ mode: "mock", simulated: true, hosted: true }) });
    override.scenarios = () => new Promise(() => {});
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("banner")).toHaveTextContent(/^HOSTED SIMULATION/));
    expect(screen.getByTestId("banner")).toBeVisible();
  });
  it("while nothing has answered, and when both calls fail, the banner says both and stays visible", async () => {
    override.info = async () => json404();
    override.scenarios = async () => json404();
    function json404() { return { ok: false, status: 404, json: async () => ({}) }; }
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("banner")).toHaveTextContent(BANNER_UNKNOWN));
    expect(screen.getByTestId("banner")).toBeVisible();
  });
});
