import { describe, it, expect, beforeEach } from "vitest";
import { markIfNew, resetDedupe } from "../dedupe.js";

describe("markIfNew", () => {
  beforeEach(() => resetDedupe());

  it("returns false for a signature already seen", () => {
    expect(markIfNew("sig1", 0)).toBe(true);
    expect(markIfNew("sig1", 1000)).toBe(false);
    expect(markIfNew("sig2", 1000)).toBe(true);
  });

  it("forgets a signature after 10 minutes", () => {
    expect(markIfNew("sig1", 0)).toBe(true);
    expect(markIfNew("sig1", 10 * 60 * 1000)).toBe(true);
  });
});
