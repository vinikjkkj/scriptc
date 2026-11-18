/* A path built with node:path meets a TypeScript file name.
 *
 * TypeScript writes every file name with `/`, on Windows too; node:path's join and resolve write `\` there. `requiredTwinOf` (lower-twin-witness.ts) compared
 * `join(pkgDir, "umd/index.js")` to `sourceFile.fileName` with `===`, which on Windows is `G:\a\umd\index.js` against `G:/a/umd/index.js`: never equal, so the
 * `require('long')` of a provenance package was never bound to its twin. Linux builds both sides with `/`, which is why CI could not see it; here the Windows
 * spelling is produced by node:path's win32 flavour, so the comparison is exercised on any host. */
import path from "node:path";
import { describe, expect, test } from "vitest";
import { sourceFileAtHostPath } from "../../packages/compiler/src/frontend/lowering/lower-twin-witness.js";
import { tsgoPath } from "../../packages/compiler/src/frontend/shared.js";

describe("a node:path path against a TypeScript file name", () => {
  const files = [{ fileName: "G:/proj/node_modules/long/index.js" }, { fileName: "G:/proj/node_modules/long/umd/index.js" }, { fileName: "G:/proj/node_modules/other/umd/index.js" }];
  const hostPath = path.win32.join("G:/proj/node_modules/long", "umd/index.js"); // the join requireBranchOf does

  test("the host spelling is backslashed and a plain === never matches it (the defect)", () => {
    expect(hostPath).toBe("G:\\proj\\node_modules\\long\\umd\\index.js");
    expect(files.some((f) => f.fileName === hostPath)).toBe(false);
  });

  test("sourceFileAtHostPath finds the file under the Windows spelling and picks only that one", () => {
    expect(sourceFileAtHostPath(files, hostPath, "win32")).toBe(files[1]);
    expect(sourceFileAtHostPath(files, path.win32.join("G:/proj/node_modules/long", "index.js"), "win32")).toBe(files[0]);
    expect(sourceFileAtHostPath(files, path.win32.join("G:/proj/node_modules/long", "missing.js"), "win32")).toBeNull();
  });

  test("the file names may arrive backslashed too (both sides are normalized)", () => {
    const backslashed = [{ fileName: "G:\\proj\\node_modules\\long\\umd\\index.js" }];
    expect(sourceFileAtHostPath(backslashed, "G:/proj/node_modules/long/umd/index.js", "win32")).toBe(backslashed[0]);
  });

  test("POSIX paths are untouched: a backslash is a file-name character there", () => {
    const odd = [{ fileName: "/a/b\\c.js" }, { fileName: "/a/b/c.js" }];
    expect(sourceFileAtHostPath(odd, "/a/b/c.js", "linux")).toBe(odd[1]);
    expect(sourceFileAtHostPath(odd, "/a/b\\c.js", "linux")).toBe(odd[0]);
    expect(tsgoPath("G:\\a\\umd\\index.js", "win32")).toBe("G:/a/umd/index.js");
  });
});
