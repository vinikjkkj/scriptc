/* Function-value text for the IR (`libCall fn.text`, Function.prototype
 * .toString of a function VALUE).
 *
 * The lowering emits `fn.text` where a function value is converted to a
 * string (String(f), `${f}`, `f.toString()`, the %s position of util.format).
 * At run time the value is a closure, and the only handle the closure has is
 * its ENTRY POINT, so the text must be keyed by entry point exactly like the
 * JS-name table (ScrFnName). That table is filled at every closure creation
 * site from the IR function the site names; this pass gives each such
 * function its text (`IrFunction.srcText`) from the TypeScript AST at the
 * function's own location.
 *
 * COMPLETENESS. A function value can reach a `fn.text` from anywhere, so the
 * table must answer for EVERY closure the program creates. If any closure
 * target has no exact text, the program is refused at build time (SC2020)
 * rather than answering a wrong text for it. A program that converts a
 * function to a string is refused today on every spelling, so this refusal
 * is never a program that ran exactly before.
 *
 * TEXT SOURCES: a user function is found by its location (file, getStart,
 * end) among the value-function nodes of its source file (fn-srctext.ts);
 * a builtin used as a value (`%builtin.<name>.value`) prints Node's native
 * text, `function <name>() { [native code] }`.
 */
import * as ts from "../ts7/adapter.js";
import type { IrFunction, SrcLoc } from "../../ir/nodes.js";
import { functionSourceText, isValueFunctionNode } from "../fn-srctext.js";

export interface FnTextAttachResult {
  /** The first fn.text use, when the program uses one at all. */
  used: SrcLoc | null;
  /** The first closure target with no exact text, when there is one. */
  missing: { loc: SrcLoc; fnName: string } | null;
}

const BUILTIN_VALUE = /^%builtin\.([A-Za-z_$][A-Za-z0-9_$]*)\.value$/;

/** Visit every IR node once; `visit` sees each object with a `kind`. */
function forEachIrNode(root: unknown, visit: (node: { kind: string } & Record<string, unknown>) => void): void {
  const stack: unknown[] = [root];
  while (stack.length > 0) {
    const v = stack.pop();
    if (v === null || typeof v !== "object") continue;
    if (Array.isArray(v)) {
      for (const item of v) stack.push(item);
      continue;
    }
    const rec = v as Record<string, unknown>;
    if (typeof rec.kind === "string") visit(rec as { kind: string } & Record<string, unknown>);
    for (const key of Object.keys(rec)) {
      // A SrcLoc and a type are data, not code; skipping them keeps the walk
      // to the program's own nodes.
      if (key === "loc" || key === "type" || key === "srcText") continue;
      stack.push(rec[key]);
    }
  }
}

/** The value-function nodes of one source file, keyed by `start:end`. */
function indexFile(sf: ts.SourceFile): Map<string, ts.Node> {
  const out = new Map<string, ts.Node>();
  const stack: ts.Node[] = [sf];
  while (stack.length > 0) {
    const n = stack.pop()!;
    if (n !== sf && isValueFunctionNode(n)) out.set(`${n.getStart(sf)}:${n.end}`, n);
    ts.forEachChild(n, (c) => {
      stack.push(c);
      return undefined;
    });
  }
  return out;
}

export function attachFnSrcText(
  functions: IrFunction[],
  globals: unknown,
  program: ts.Program,
): FnTextAttachResult {
  const byName = new Map<string, IrFunction>();
  for (const fn of functions) byName.set(fn.name, fn);
  let used: SrcLoc | null = null;
  const targets = new Map<string, IrFunction | null>();
  const closureNames: string[] = [];
  forEachIrNode({ functions, globals }, (node) => {
    if (node.kind === "libCall" && node.fn === "fn.text" && used === null) used = node.loc as SrcLoc;
    if (node.kind === "closure" && typeof node.fnName === "string") closureNames.push(node.fnName);
  });
  const result: FnTextAttachResult = { used, missing: null };
  if (used === null) return result;
  const fileIndex = new Map<string, Map<string, ts.Node> | null>();
  for (const name of closureNames) {
    if (targets.has(name)) continue;
    targets.set(name, byName.get(name) ?? null);
  }
  for (const [name, fn] of targets) {
    if (fn !== null && fn.srcText !== undefined) continue;
    const builtin = BUILTIN_VALUE.exec(name);
    let text: string | null = null;
    if (fn === null) {
      // A closure over a function this lowering never emitted: no text.
    } else if (name.startsWith("%bindthis.")) {
      // A bound function: its own text is native (Node prints `function () {
      // [native code] }` for every bound function, whatever the target).
      text = "function () { [native code] }";
    } else if (builtin !== null) {
      text = `function ${builtin[1]}() { [native code] }`;
    } else if (fn.loc !== undefined) {
      const { file, start, end } = fn.loc;
      let index = fileIndex.get(file);
      if (index === undefined) {
        const sf = program.getSourceFile(file);
        index = sf === undefined ? null : indexFile(sf);
        fileIndex.set(file, index);
      }
      const node = index?.get(`${start}:${end}`);
      if (node !== undefined) text = functionSourceText(node);
    }
    if (text === null) {
      if (result.missing === null) result.missing = { loc: used, fnName: name };
      continue;
    }
    fn!.srcText = text;
  }
  return result;
}
