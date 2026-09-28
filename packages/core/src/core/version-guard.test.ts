import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SUPPORTED_AZTEC_CLIENT_VERSION,
  assertAztecNodeVersionCompatible,
} from "./version-guard.ts";

describe("Aztec version guard", () => {
  it("accepts matching versions", () => {
    assert.equal(SUPPORTED_AZTEC_CLIENT_VERSION, "5.2.0");
    assert.doesNotThrow(() => assertAztecNodeVersionCompatible("5.2.0"));
    assert.doesNotThrow(() => assertAztecNodeVersionCompatible("v5.2.0"));
  });

  it("rejects mismatches and missing versions", () => {
    assert.throws(() => assertAztecNodeVersionCompatible("5.0.1"));
    assert.throws(() => assertAztecNodeVersionCompatible(undefined));
  });
});
