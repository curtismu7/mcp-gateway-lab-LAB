// Opened from Customer Agent LAB: the strip and the header button show, the mapped scenario and vertical are preselected.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import ReturnLink from "./return-link/ReturnLink.jsx";
import { scenarioFor, verticalFor, UC_SCENARIO, VERTICAL_MAP } from "./handoffMap";
import { SCENARIOS } from "../../server/src/gatewayData.js";
import { VERTICALS } from "../../server/src/cast.js";

const calls = [];
vi.mock("./api", () => ({
  getJson: vi.fn(async (url) => { calls.push(url); return url.startsWith("/api/info") ? { mode: "mock", realAvailable: false, hosted: false } : { banner: "SIMULATED", intro: "i", verticals: ["retail", "health", "finance"], scenarios: [], talkTrack: [] }; }),
  resetWorkspace: vi.fn(), setMode: vi.fn(),
}));
vi.mock("./components/PolicyGate", () => ({ default: ({ requestedId }) => <p data-testid="pg">{String(requestedId)}</p> }));
vi.mock("./components/DiagramTab", () => ({ default: () => null }));
vi.mock("./components/ShelfLink", () => ({ default: () => null }));
import App from "./App";

afterEach(() => { cleanup(); calls.length = 0; window.history.replaceState(null, "", "/"); });
const NOTE = { name: "Opened from Customer Agent LAB" };

describe("hand-off from Customer Agent LAB", () => {
  it("the vendored files match return-link.sha256, which names the parent commit", () => {
    const dir = path.join(process.cwd(), "src", "return-link"); // vitest runs in web/
    const text = fs.readFileSync(path.join(dir, "return-link.sha256"), "utf8");
    expect(text.split("\n")[0]).toMatch(/^# vendored byte for byte from curtismu7\/AI-DEMO-Standalone shared\/return-link at [0-9a-f]{7,40}/);
    const pins = text.split("\n").filter((l) => l && !l.startsWith("#")).map((l) => l.split(/\s+/));
    expect(pins.map(([, f]) => f).sort()).toEqual(["ReturnLink.jsx", "ReturnLink.test.jsx", "returnTargets.js"]);
    for (const [h, f] of pins) expect(createHash("sha256").update(fs.readFileSync(path.join(dir, f))).digest("hex"), f).toBe(h);
  });

  it("every mapped use case names a real scenario, every mapped vertical a real vertical", () => {
    const ids = SCENARIOS.map((s) => s.id);
    for (const s of Object.values(UC_SCENARIO)) expect(ids).toContain(s);
    for (const v of Object.values(VERTICAL_MAP)) expect(Object.keys(VERTICALS)).toContain(v);
    expect(scenarioFor({ uc: "UC9" })).toBeNull();
    expect(scenarioFor({ uc: "toString" })).toBeNull();
    expect(verticalFor({ vertical: "constructor" })).toBeNull();
  });

  it("UC31 in healthcare: banner then strip, header Back, the Texas deny and the health vertical are preselected", async () => {
    window.history.replaceState(null, "", "/?from=customer-agent&uc=UC31&vertical=healthcare");
    render(<App />);
    const strip = screen.getByRole("note", NOTE);
    expect(strip.textContent).toContain("UC31");
    expect(screen.getByTestId("banner").nextElementSibling).toBe(strip);
    expect(screen.getAllByRole("button", { name: /Back to Customer Agent LAB/ })).toHaveLength(2);
    expect(document.querySelector(".head__tools > button.return-link--header")).not.toBeNull();
    await waitFor(() => expect(screen.getByTestId("pg").textContent).toBe("texas-deny"));
    expect(calls).toContain("/api/scenarios?vertical=health");
  });

  it("an unmapped use case: strip only, defaults kept", async () => {
    window.history.replaceState(null, "", "/?from=customer-agent&uc=UC9&vertical=government");
    render(<App />);
    expect(screen.getByRole("note", NOTE)).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("pg").textContent).toBe("null"));
    expect(calls).toContain("/api/scenarios?vertical=retail");
  });

  it("no from, an unknown from or a bad id: no strip, no button, defaults", async () => {
    for (const q of ["/", "/?from=elsewhere&uc=UC30", "/?from=customer-agent&uc=%3Cb%3E", "/?from=customer-agent&uc=UC30&vertical=a%20b"]) {
      window.history.replaceState(null, "", q);
      render(<App />);
      expect(screen.queryByRole("button", { name: /Back to/ })).toBeNull();
      await waitFor(() => expect(screen.getByTestId("pg").textContent).toBe("null"));
      cleanup();
    }
    expect(calls.filter((u) => u.startsWith("/api/scenarios")).every((u) => u.endsWith("retail"))).toBe(true);
  });

  it("Back goes to the proxy path under /mcp-gateway-lab/, the direct URL at the root", () => {
    const navigate = vi.fn();
    const search = "?from=customer-agent&uc=UC32";
    render(<ReturnLink app="mcp-gateway-lab" navigate={navigate} location={{ pathname: "/mcp-gateway-lab/", search }} />);
    fireEvent.click(screen.getByRole("button", { name: /Back to/ }));
    expect(navigate).toHaveBeenLastCalledWith("/customer-agent/?returned=mcp-gateway-lab&uc=UC32");
    cleanup();
    render(<ReturnLink app="mcp-gateway-lab" navigate={navigate} location={{ pathname: "/", search }} />);
    fireEvent.click(screen.getByRole("button", { name: /Back to/ }));
    expect(navigate).toHaveBeenLastCalledWith("http://127.0.0.1:5603/?returned=mcp-gateway-lab&uc=UC32");
  });
});
