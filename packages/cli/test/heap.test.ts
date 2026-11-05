import { describe, expect, it } from "vitest";
import { heapCeilingMB, wantedCeilingMB } from "../src/heap.js";

const GB = 1024 * 1048576;

describe("heap ceiling of a build", () => {
  it("takes three quarters of the machine, capped", () => {
    expect(heapCeilingMB(16 * GB)).toBe(12288);
    expect(heapCeilingMB(8 * GB)).toBe(6144);
    expect(heapCeilingMB(1024 * GB)).toBe(32768);
  });

  it("raises the default ceiling only when the machine can give clearly more", () => {
    expect(wantedCeilingMB(16 * GB, 4.2 * GB, [])).toBe(12288);
    expect(wantedCeilingMB(4 * GB, 3 * GB, [])).toBe(0);
    expect(wantedCeilingMB(16 * GB, 12 * GB, [])).toBe(0);
    expect(wantedCeilingMB(16 * GB, 4.2 * GB, ["--max-old-space-size=1000"])).toBe(0);
  });
});
