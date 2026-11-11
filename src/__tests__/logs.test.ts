import { describe, it, expect, beforeEach } from "vitest";
import { addLog, getLogs, resetLogs, subscribe } from "../logs.js";

describe("log buffer", () => {
  beforeEach(() => resetLogs());

  it("returns entries after a given id, oldest first", () => {
    addLog("info", "a");
    addLog("warn", "b");
    addLog("error", "c");
    expect(getLogs(1).map((e) => e.message)).toEqual(["b", "c"]);
    expect(getLogs(0, 2).map((e) => e.message)).toEqual(["b", "c"]);
  });

  it("keeps only the newest 1000 entries", () => {
    for (let i = 0; i < 1005; i++) addLog("info", `m${i}`);
    const logs = getLogs();
    expect(logs).toHaveLength(1000);
    expect(logs[0].message).toBe("m5");
  });

  it("notifies subscribers until they unsubscribe", () => {
    const seen: string[] = [];
    const unsubscribe = subscribe((e) => seen.push(e.message));
    addLog("info", "one");
    unsubscribe();
    addLog("info", "two");
    expect(seen).toEqual(["one"]);
  });

  it("keeps logging when a subscriber throws", () => {
    subscribe(() => {
      throw new Error("closed");
    });
    expect(() => addLog("info", "still works")).not.toThrow();
    expect(getLogs()).toHaveLength(1);
  });

  it("truncates very long messages", () => {
    const entry = addLog("info", "x".repeat(5000));
    expect(entry.message.length).toBeLessThan(4100);
    expect(entry.message.endsWith("(truncated)")).toBe(true);
  });
});
