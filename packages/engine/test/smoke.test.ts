import { describe, expect, it } from "vitest";
import { ENGINE_FORMAT_VERSION } from "../src/index.js";

describe("engine", () => {
  it("declares a record format version", () => {
    expect(ENGINE_FORMAT_VERSION).toBe(1);
  });
});
