/* The size guard's own guard.
 *
 * island.test.ts and regex.test.ts weigh three binaries against the figures
 * size-class.ts records. Those assertions are only worth what the comparator
 * behind them is worth, and a size check that cannot fail is the exact shape
 * of the problem this file exists to prevent: the win32 ceilings sat RED for
 * days while reporting nothing but "651264 is not less than 646000", and the
 * 16 KB SHRINK that fixed them would have been invisible to every assertion
 * in the suite.
 *
 * So: plant a page and require a complaint back. These are pure-function
 * tests — no compiler, no linker, no toolchain — so they run everywhere and
 * cannot go quiet because a platform stopped being weighable.
 */
import { describe, expect, test } from "vitest";
import {
  REGEX_CLASS_MAX,
  REGEX_CLASS_RECORDED,
  SIZE_DRIFT_PAGE,
  STATIC_CLASS_MAX,
  STATIC_CLASS_RECORDED,
  recordedSizeComplaint,
} from "./size-class.js";

const R = 637_952; // a stand-in recorded figure, so these tests do not move
                   // when the real measurement is re-recorded.

describe("the recorded-size guard is armed", () => {
  test("an exact match is silent", () => {
    expect(recordedSizeComplaint("x", R, R)).toBeNull();
  });

  test("a PLANTED PAGE of growth fails", () => {
    const complaint = recordedSizeComplaint("x", R + SIZE_DRIFT_PAGE, R);
    expect(complaint).not.toBeNull();
    // It must say which way, how much, and against what — the three things
    // the bare ceiling never said.
    expect(complaint).toContain("GREW");
    expect(complaint).toContain(String(SIZE_DRIFT_PAGE));
    expect(complaint).toContain(String(R));
    expect(complaint).toContain(String(R + SIZE_DRIFT_PAGE));
  });

  test("a PLANTED PAGE of shrink fails too — the ceiling cannot see this one", () => {
    const complaint = recordedSizeComplaint("x", R - SIZE_DRIFT_PAGE, R);
    expect(complaint).not.toBeNull();
    expect(complaint).toContain("SHRANK");
    expect(complaint).toContain(String(SIZE_DRIFT_PAGE));
  });

  test("many pages fail, and the complaint scales with them", () => {
    for (const pages of [1, 2, 4, 40]) {
      const grew = recordedSizeComplaint("x", R + pages * SIZE_DRIFT_PAGE, R);
      const shrank = recordedSizeComplaint("x", R - pages * SIZE_DRIFT_PAGE, R);
      expect(grew, `+${pages} pages must fail`).not.toBeNull();
      expect(shrank, `-${pages} pages must fail`).not.toBeNull();
      expect(grew).toContain(String(pages * SIZE_DRIFT_PAGE));
    }
  });

  test("sub-page drift is tolerated, right up to the last byte before a page", () => {
    // PE file alignment is 512, so real drift arrives in 512-byte steps.
    for (const d of [0, 512, 1024, 2048, 3584, SIZE_DRIFT_PAGE - 1]) {
      expect(recordedSizeComplaint("x", R + d, R), `+${d} must be tolerated`).toBeNull();
      expect(recordedSizeComplaint("x", R - d, R), `-${d} must be tolerated`).toBeNull();
    }
    // ...and the very next byte is a page, which is not.
    expect(recordedSizeComplaint("x", R + SIZE_DRIFT_PAGE, R)).not.toBeNull();
  });

  test("a platform with no recorded figure is silent rather than wrong", () => {
    // linux and darwin cannot be weighed from the box that recorded these,
    // and inventing a figure for an unweighed platform is the mistake the
    // calibration history in size-class.ts keeps warning about.
    expect(recordedSizeComplaint("x", 1, null)).toBeNull();
    expect(recordedSizeComplaint("x", 999_999_999, null)).toBeNull();
  });

  test("the recorded figures sit UNDER the class ceilings they share a file with", () => {
    // A recorded figure above its own ceiling would mean the suite is red by
    // construction — which is the state this whole change came out of.
    if (STATIC_CLASS_RECORDED !== null) {
      expect(STATIC_CLASS_RECORDED).toBeLessThan(STATIC_CLASS_MAX);
    }
    if (REGEX_CLASS_RECORDED !== null) {
      expect(REGEX_CLASS_RECORDED).toBeLessThan(REGEX_CLASS_MAX);
    }
  });

  test("win32 records both figures, and the class distance survives the gate", () => {
    if (process.platform !== "win32") return;
    expect(STATIC_CLASS_RECORDED).not.toBeNull();
    expect(REGEX_CLASS_RECORDED).not.toBeNull();
    // What the pair actually protects: linking libregexp + libunicode is a
    // LIBRARY-sized step (~135 KB), never an engine-sized one (~620 KB).
    const distance = (REGEX_CLASS_RECORDED as number) - (STATIC_CLASS_RECORDED as number);
    expect(distance).toBeGreaterThan(100_000);
    expect(distance).toBeLessThan(200_000);
  });
});
