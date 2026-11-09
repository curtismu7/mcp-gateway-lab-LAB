// Customer Agent LAB hands a use case here with ?from=customer-agent&uc=<id>&vertical=<id> (read by the vendored return-link module).
// Preselect only where the catalog id obviously maps to this lab's own scenario or vertical; anything else opens the defaults (strip only).
// UC30 third-party MCP scoped at the gateway -> the Texas permit; UC31 out-of-scope call denied -> the Texas deny; UC32 live-reconfigure.
export const UC_SCENARIO = Object.freeze({ UC30: "texas-permit", UC31: "texas-deny", UC32: "live-reconfigure" });
export const VERTICAL_MAP = Object.freeze({ banking: "finance", healthcare: "health", retail: "retail" });
export const scenarioFor = (ctx) => (ctx && Object.hasOwn(UC_SCENARIO, ctx.uc) ? UC_SCENARIO[ctx.uc] : null);
export const verticalFor = (ctx) => (ctx && ctx.vertical && Object.hasOwn(VERTICAL_MAP, ctx.vertical) ? VERTICAL_MAP[ctx.vertical] : null);
