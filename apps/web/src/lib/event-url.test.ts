import { describe, expect, it } from "vitest";
import { eventUrlOrNull } from "./event-url.ts";

describe("eventUrlOrNull", () => {
  it("hides the event when the URL is absent or invalid", () => {
    for (const value of [undefined, "", " ", "not a URL", "javascript:alert(1)", "https://user:pass@example.com"]) {
      expect(eventUrlOrNull(value)).toBeNull();
    }
  });

  it("accepts a configured http or https event URL", () => {
    expect(eventUrlOrNull("  http://dfaztec-s1.dfarchon.xyz/  ")).toBe("http://dfaztec-s1.dfarchon.xyz/");
    expect(eventUrlOrNull("https://example.com/event")).toBe("https://example.com/event");
  });
});
