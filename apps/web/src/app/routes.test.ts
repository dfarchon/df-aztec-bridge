import { describe, expect, it } from "vitest";
import { normalizePath, ROUTES } from "./routes.ts";

describe("app routes", () => {
  it("normalizes shell paths and sends unknown paths to the bridge", () => {
    expect(normalizePath("/")).toBe(ROUTES.bridge);
    expect(normalizePath("/bridge")).toBe(ROUTES.bridge);
    expect(normalizePath("/recover/")).toBe(ROUTES.recover);
    expect(normalizePath("/vault")).toBe(ROUTES.vault);
    expect(normalizePath("/history")).toBe(ROUTES.history);
    expect(normalizePath("/explorer")).toBe(ROUTES.bridge);
    expect(normalizePath("/unknown")).toBe(ROUTES.bridge);
  });
});
