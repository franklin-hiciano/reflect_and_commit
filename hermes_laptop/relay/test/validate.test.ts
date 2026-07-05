import { describe, expect, test } from "bun:test";
import { parseRole, parseSessionId, parseTunnelFrame } from "../src/validate";

describe("parseTunnelFrame", () => {
  test("accepts valid JSON-RPC frame", () => {
    const frame = parseTunnelFrame(
      JSON.stringify({ jsonrpc: "2.0", method: "browser.click", id: 1 }),
    );
    expect(frame?.method).toBe("browser.click");
  });

  test("rejects invalid JSON", () => {
    expect(parseTunnelFrame("not json")).toBeNull();
  });

  test("rejects missing method", () => {
    expect(parseTunnelFrame(JSON.stringify({ jsonrpc: "2.0" }))).toBeNull();
  });
});

describe("parseRole", () => {
  test("accepts brain and actuator", () => {
    expect(parseRole("brain")).toBe("brain");
    expect(parseRole("actuator")).toBe("actuator");
  });

  test("rejects unknown roles", () => {
    expect(parseRole("human")).toBeNull();
  });
});

describe("parseSessionId", () => {
  test("requires non-empty value", () => {
    expect(parseSessionId("abc-123")).toBe("abc-123");
    expect(parseSessionId("")).toBeNull();
    expect(parseSessionId(null)).toBeNull();
  });
});
