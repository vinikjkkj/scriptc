import { describe, expect, test } from "vitest";
import { renderAll } from "../src/diagnostics/render.js";

/* A bundled or minified file puts its whole body on one line. Rendering a diagnostic used to print that line three times
 * and pad the caret row to the column, so one diagnostic cost megabytes and a few thousand of them exhausted the heap: the
 * mysql2 driver build died rendering its own errors. A long line renders as a window around the span. */
describe("renderAll over a very long source line", () => {
  const file = "/pkg/bundle.js";
  const line = "x".repeat(900_000);
  const text = `${line}\nshort second line\n`;
  const diag = (start: number) =>
    ({ code: "SC1090", message: "refused", loc: { file, start, end: start + 5 }, severity: "error" }) as never;

  test("each diagnostic stays small and names its line and column", () => {
    const out = renderAll([diag(450_000)], new Map([[file, text]]), { color: false });
    expect(out.length).toBeLessThan(2_000);
    expect(out).toContain(`${file}:1:450001 - error SC1090: refused`);
    expect(out).toContain("^~~~~");
  });

  test("thousands of them stay linear", () => {
    const diags = Array.from({ length: 5_000 }, (_, i) => diag(i * 100));
    const out = renderAll(diags, new Map([[file, text]]), { color: false });
    expect(out.length).toBeLessThan(5_000 * 2_000);
  });

  test("a short line renders exactly as before", () => {
    const t = "let a = 1;\nlet b = 2;\nlet c = 3;\n";
    const out = renderAll([diag(15)], new Map([[file, t]]), { color: false });
    expect(out).toContain("  1 | let a = 1;");
    expect(out).toContain("  2 | let b = 2;");
    expect(out).toContain("  3 | let c = 3;");
    expect(out).toContain("^~~~~");
  });
});
