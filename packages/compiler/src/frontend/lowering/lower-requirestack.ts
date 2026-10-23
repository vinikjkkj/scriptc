/* Node's MODULE_NOT_FOUND message carries the live REQUIRE STACK: the file
 * that made the failing require, then the file that first required it, and so
 * on up to the entry. The compiled program holds no module objects, so the
 * stack is rebuilt at build time from the program's module graph.
 *
 * A module's PARENT in Node is the module whose `require` first loaded it, so
 * the parent chain is a spanning tree of the require graph in the order the
 * program evaluates it. The tree is built here by a depth-first walk from the
 * entry that follows each file's require edges in source order: the
 * top-level ones first (they run while the module's body runs), then the ones
 * written inside functions (they run later, when something calls the
 * function). A file first reached by an ES `import` has no parent: Node's ESM
 * loader hands CommonJS its source without a requiring module, so the stack
 * ends at that file.
 *
 * Exact where one chain reaches the module (every program whose require graph
 * is a tree, and pg's native client: client.js <- native/index.js <- lib/index.js).
 * Where a module is first required through a function that the program calls
 * only after another path has loaded it, the order is an inference. */
import * as ts from "../ts7/adapter.js";
import type { Lowerer } from "./lowerer.js";
import { isCjsJsFile, isJsSourceFile, orderedImportsOf, requireSpecOf } from "../program.js";
import { nativePath } from "../shared.js";
import { requireResolutionBase } from "../npm.js";
import { resolve } from "node:path";

const parentMaps = new WeakMap<Lowerer, Map<ts.SourceFile, ts.SourceFile | null>>();

function requireEdgesOf(L: Lowerer, sf: ts.SourceFile): ts.SourceFile[] {
  const top: ts.SourceFile[] = [];
  const lazy: ts.SourceFile[] = [];
  const walk = (n: ts.Node, nested: boolean): void => {
    if (ts.isCallExpression(n)) {
      const spec = requireSpecOf(n);
      if (spec !== null) {
        const dep = L.requireDepOf(spec, n);
        if (dep !== null) (nested ? lazy : top).push(dep);
      }
    }
    const inner = nested || ts.isFunctionLike(n);
    ts.forEachChild(n, (c) => walk(c, inner));
  };
  for (const st of sf.statements) walk(st, false);
  return [...top, ...lazy];
}

function parentMapOf(L: Lowerer): Map<ts.SourceFile, ts.SourceFile | null> {
  const cached = parentMaps.get(L);
  if (cached !== undefined) return cached;
  const parent = new Map<ts.SourceFile, ts.SourceFile | null>();
  // Iterative: a long require chain must not overflow the stack.
  const visit = (root: ts.SourceFile): void => {
    if (parent.has(root)) return;
    parent.set(root, null);
    const stack: { sf: ts.SourceFile; edges: { dep: ts.SourceFile; viaRequire: boolean }[]; at: number }[] = [];
    const edgesOf = (sf: ts.SourceFile): { dep: ts.SourceFile; viaRequire: boolean }[] => [
      ...orderedImportsOf(L.program, sf).flatMap(({ dep }) => (dep !== null ? [{ dep, viaRequire: false }] : [])),
      ...requireEdgesOf(L, sf).map((dep) => ({ dep, viaRequire: true })),
    ];
    stack.push({ sf: root, edges: edgesOf(root), at: 0 });
    while (stack.length > 0) {
      const top = stack[stack.length - 1]!;
      if (top.at >= top.edges.length) {
        stack.pop();
        continue;
      }
      const { dep, viaRequire } = top.edges[top.at++]!;
      if (parent.has(dep)) continue;
      // A CommonJS file required by CommonJS has the requirer as its parent;
      // any other way in (an `import`, a require from a module that is not
      // CommonJS) leaves it parentless.
      parent.set(dep, viaRequire && isCjsJsFile(top.sf) && isJsSourceFile(top.sf) ? top.sf : null);
      stack.push({ sf: dep, edges: edgesOf(dep), at: 0 });
    }
  };
  visit(L.entry);
  for (const sf of L.moduleOrder) visit(sf);
  parentMaps.set(L, parent);
  return parent;
}

/** The files of the require stack for a failing require written in `sf`,
 * innermost first. */
export function requireStackOf(L: Lowerer, sf: ts.SourceFile): ts.SourceFile[] {
  const parent = parentMapOf(L);
  const out: ts.SourceFile[] = [sf];
  const seen = new Set<ts.SourceFile>(out);
  for (let p = parent.get(sf) ?? null; p !== null && !seen.has(p); p = parent.get(p) ?? null) {
    out.push(p);
    seen.add(p);
  }
  return out;
}

/** Node's MODULE_NOT_FOUND message for `spec` required from `sf`: the quoted
 * specifier, then the require stack, each file spelled where the RUNNING
 * program keeps it. */
export function moduleNotFoundMessage(L: Lowerer, sf: ts.SourceFile, spec: string): string {
  const lines = requireStackOf(L, sf).map((f) => `- ${nativePath(resolve(requireResolutionBase(f.fileName)))}`);
  return `Cannot find module '${spec}'\nRequire stack:\n${lines.join("\n")}`;
}

/** The message a compiled MODULE_NOT_FOUND throw carries: the full require
 * stack where the failing require sits in a CommonJS JavaScript file (Node's
 * own message), the probe's one-entry message anywhere else. */
export function refusalMessage(L: Lowerer, node: ts.Node, spec: string, probed: string): string {
  const sf = node.getSourceFile();
  return isJsSourceFile(sf) && isCjsJsFile(sf) ? moduleNotFoundMessage(L, sf, spec) : probed;
}
