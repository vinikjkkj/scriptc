/* The decoded-string cache over the tsgo AST client (src/frontend/ts7/node-string-cache.ts) must really apply to the installed client and must
 * leave a client of another shape alone. The first test FAILS if a dependency update moves getString and the patch silently stops applying
 * (nodeStringCacheStatus() would read "absent" and every build would lose the 9-13% of lowering it was measured to save). */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, test } from "vitest";
import { installNodeStringCache, nodeStringCacheStatus } from "../../src/frontend/ts7/node-string-cache.js";
import { ad, options7 } from "./harness.js";

const host = new ad.Ts7Host();
afterAll(() => host.close());

test("the real client's getString is patched, and a node's text still reads the same", () => {
  const dir = mkdtempSync(join(tmpdir(), "nsc-"));
  const file = join(dir, "a.ts");
  writeFileSync(file, "const alpha = 1;\nconst beta = alpha + 2;\nconsole.log(beta);\n");
  const program = ad.createProgram([file], options7(), host);
  const sf = program.getSourceFile(file)!;
  expect(sf).toBeDefined();
  expect(nodeStringCacheStatus()).toBe("patched");
  const names: string[] = [];
  const walk = (n: { forEachChild(cb: (c: never) => unknown): unknown; kind: number; text?: string }): void => {
    if (n.kind === ad.SyntaxKind.Identifier) names.push(n.text as string);
    n.forEachChild(((c: never) => walk(c)) as never);
  };
  walk(sf as never);
  expect(names).toEqual(["alpha", "beta", "alpha", "console", "log", "beta"]);
  // the file object carries the cache, and a second pass answers from it with the same values
  const cache = (sf as unknown as Record<string, Map<number, string>>)["_scrStrings"];
  expect(cache).toBeInstanceOf(Map);
  expect(cache!.size).toBeGreaterThan(0);
  const again: string[] = [];
  const walk2 = (n: { forEachChild(cb: (c: never) => unknown): unknown; kind: number; text?: string }): void => {
    if (n.kind === ad.SyntaxKind.Identifier) again.push(n.text as string);
    n.forEachChild(((c: never) => walk2(c)) as never);
  };
  walk2(sf as never);
  expect(again).toEqual(names);
});

test("the install is idempotent and a node without the method does not change the status", () => {
  // already patched in this process: the guard must be idempotent
  const before = nodeStringCacheStatus();
  installNodeStringCache({});
  expect(nodeStringCacheStatus()).toBe(before);
});
