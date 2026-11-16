import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import App from "./App.jsx";

// The header shows this lab's own Verified / In progress mark, read from the same /api/shelf call the Shelf link makes (through the lab-proxy
// that call reaches the shelf, whose payload lists every demo with its mark). On its own port the lab's /api/shelf has no demos, so no mark.
// Only /api/shelf is answered; every other call 404s (the page body shows its load error, the header is what is under test).
const mark = (status, label, extra = {}) => ({ status, label, note: "", updatedAt: "2026-11-15", source: "shipped", ...extra });
function withShelf(payload) {
  globalThis.fetch = vi.fn(async (url) => ({ ok: url === "/api/shelf", status: url === "/api/shelf" ? 200 : 404, json: async () => (url === "/api/shelf" ? payload : {}) }));
}
beforeEach(() => { window.location.hash = ""; });
afterEach(() => { vi.restoreAllMocks(); });

describe("verification mark in the header", () => {
  it("shows this lab's own mark beside the Shelf link, and no other lab's", async () => {
    withShelf({ shelfUrl: "http://shelf.example", demos: [{ id: "other-lab", verification: mark("in-progress", "In progress") }, { id: "mcp-gateway-lab", verification: mark("verified", "Verified", { note: "Every scope decision on the mock" }) }] });
    render(<App />);
    await screen.findByRole("tablist");
    const bar = within(await screen.findByTestId("top-menu"));
    expect(await bar.findByText("Verified")).toBeInTheDocument();
    expect(bar.getByRole("link", { name: "Shelf" })).toBeInTheDocument();
    expect(bar.queryByText("In progress")).toBeNull();
    expect(document.querySelectorAll(".verify")).toHaveLength(1);
    expect(bar.getByText("Verified").closest(".verify")).toHaveAttribute("title", expect.stringContaining("Every scope decision on the mock"));
  });

  it("shows nothing when the lab is opened on its own port (its /api/shelf has no demos) or the shelf has no mark for it", async () => {
    for (const payload of [{ shelfUrl: "http://shelf.example" }, { shelfUrl: "http://shelf.example", demos: [{ id: "mcp-gateway-lab", verification: null }] }]) {
      withShelf(payload);
      const { unmount } = render(<App />);
      await screen.findByRole("tablist");
      const bar = within(await screen.findByTestId("top-menu"));
      expect(await bar.findByRole("link", { name: "Shelf" })).toBeInTheDocument(); // the shelf answered, and still no badge
      expect(document.querySelector(".verify")).toBeNull();
      unmount();
    }
  });
});
