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
import { irFunctionValueCode } from "../../ir/nodes.js";
import { isJsSourceFileName } from "../shared.js";

export interface FnTextAttachResult {
  /** The first fn.text use, when the program uses one at all. */
  used: SrcLoc | null;
  /** The first closure target with no exact text, when there is one. */
  missing: { loc: SrcLoc; fnName: string } | null;
  /** A program with a construct site over a checked-dynamic value (dyn.construct,
   * dyn.reflectConstruct): the first function value it can reach that has no exact
   * [[Construct]] answer, with the reason. Null when every reachable value is exact. */
  constructMissing: { loc: SrcLoc; fnName: string; reason: string } | null;
}

// Builtin members used as values: %builtin.<n>, %builtin.js.<n>, %number.<n>,
// %math.<n>, %string.<n>.<arity> (lower-fnvalue, lower-builtins, lower-island,
// surfaces). Node's text names the member: `function <n>() { [native code] }`.
const BUILTIN_VALUE = /^%(?:builtin(?:\.js)?|number|math|string)\.([A-Za-z_$][A-Za-z0-9_$]*)(?:\.[0-9]+)?\.value$/;
const ADAPTER_IMPL = /^%fn\.adapt\.[0-9]+\.impl$/;
const INTERNAL_THEN = /^%fn[0-9]+_then$/;

/** A value a non-plain-object prototype would come from: an array, a typed array, a function or a map. */
function nonPlainObjectValue(value: unknown): boolean {
  const v = value as { kind?: string; value?: { type?: { kind?: string } } } | undefined;
  if (v === undefined) return false;
  if (v.kind === "dynObjLit") return false;
  if (v.kind === "dynArrLit" || v.kind === "dynArrNew" || v.kind === "dynArrFrom" || v.kind === "dynMapNew") return true;
  if (v.kind === "dynFrom") {
    const t = v.value?.type?.kind;
    return t === "array" || t === "bytes" || t === "func" || t === "map" || t === "set";
  }
  return false;
}

/** Why a function value reachable from a construct site has no exact [[Construct]]
 * answer, or null when it has one. A plain user function constructs exactly (its
 * instance is the receiver). A non-constructor needs its text for Node's message.
 * The primitive constructors answer a wrapper object the runtime cannot hold, and a
 * static bind of a constructible target would construct with the wrong receiver. */
function constructReasonOf(name: string, fn: IrFunction | undefined): string | null {
  if (PRIMITIVE_CTOR_CLOSURE.test(name)) {
    return "the primitive constructor answers a wrapper object (new String / Number / Boolean) this build does not represent";
  }
  // Not in this pass's function list (a factory-minted closure): its kind code and text are
  // registered by the emitter from the whole module, so the run-time answer is exact.
  if (fn === undefined) return null;
  const code = irFunctionValueCode(fn);
  const nonCtor = (code & 7) !== 0;
  if (name.startsWith("%bindthis.")) {
    // A bind of a provably non-constructor (an arrow, a method) answers Node's own refusal exactly.
    return nonCtor ? null : "a statically bound function of a constructible target reaching a checked-dynamic value: its [[Construct]] answer is not carried exactly by the bound closure";
  }
  if (nonCtor && fn.srcText === undefined) {
    return "a non-constructor function has no exact source text for Node's TypeError message";
  }
  return null;
}

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

const PRIMITIVE_CTOR_CLOSURE = /^%builtin\.(?:dyn\.)?(String|Number|Boolean)$/;

export function attachFnSrcText(
  functions: IrFunction[],
  globals: unknown,
  program: ts.Program,
): FnTextAttachResult {
  const byName = new Map<string, IrFunction>();
  for (const fn of functions) byName.set(fn.name, fn);
  let used: SrcLoc | null = null;
  let construct: SrcLoc | null = null;
  // A construct site that did not compile on main: Reflect.construct, and a checked-dynamic `new`
  // written in TypeScript (main refused any/unknown TS callees). The JS dyn.construct sites compiled
  // on main with the answers they already had, so no construct refusal may be placed on account of them.
  let newConstruct: SrcLoc | null = null;
  let reflectConstruct: SrcLoc | null = null;
  let protoWrite: SrcLoc | null = null;
  let staticBoundReach: SrcLoc | null = null;
  let primitiveStored: SrcLoc | null = null;
  const argDynFroms = new Set<unknown>();
  const targets = new Map<string, IrFunction | null>();
  const closureNames: string[] = [];
  // Closures a checked-dynamic value is minted from (dynFrom over a closure):
  // only these can reach a construct site as a value.
  const dynNames = new Map<string, SrcLoc>();
  forEachIrNode({ functions, globals }, (node) => {
    if (node.kind === "libCall" && node.fn === "fn.text" && used === null) used = node.loc as SrcLoc;
    if (
      node.kind === "libCall" && (node.fn === "dyn.construct" || node.fn === "dyn.reflectConstruct") &&
      construct === null
    ) construct = node.loc as SrcLoc;
    if (
      node.kind === "libCall" &&
      (node.fn === "dyn.reflectConstruct" || (node.fn === "dyn.construct" && !isJsSourceFileName((node.loc as SrcLoc).file))) &&
      newConstruct === null
    ) newConstruct = node.loc as SrcLoc;
    if (node.kind === "libCall" && node.fn === "dyn.reflectConstruct" && reflectConstruct === null) {
      reflectConstruct = node.loc as SrcLoc;
    }
    // `o.prototype = <value>` on a checked-dynamic `o` with a literal key. A plain object
    // literal is a [[Prototype]] link this build holds; any other object kind is not.
    if (node.kind === "libCall" && node.fn === "dyn.keySet" && protoWrite === null) {
      const args = node.args as { kind?: string; value?: unknown }[] | undefined;
      const key = args?.[1];
      const value = args?.[2];
      if (key?.kind === "strLit" && key.value === "prototype" && nonPlainObjectValue(value)) {
        protoWrite = node.loc as SrcLoc;
      }
    }
    if (node.kind === "closure" && typeof node.fnName === "string") closureNames.push(node.fnName);
    // A dyn value passed directly as an argument is called, not stored: it can only reach a
    // construct site through the callee, which is a value of its own.
    if (Array.isArray(node.args)) {
      for (const a of node.args as unknown[]) {
        if (a !== null && typeof a === "object" && (a as { kind?: unknown }).kind === "dynFrom") argDynFroms.add(a);
      }
    }
    if (node.kind === "dynFrom") {
      const v = node.value as { kind?: string; fnName?: unknown; type?: { kind?: string } } | undefined;
      // A primitive constructor stored in a value (not passed as an argument) can be constructed.
      if (v !== undefined && v.kind === "closure" && typeof v.fnName === "string" && PRIMITIVE_CTOR_CLOSURE.test(v.fnName)) {
        if (!argDynFroms.has(node) && primitiveStored === null) primitiveStored = node.loc as SrcLoc;
      }
      // A statically bound function (`f.bind(...)`, reached through a variable or a member
      // as well as directly): its box carries the bind's text, not its target's.
      if (node.staticBindCtor === true && staticBoundReach === null) staticBoundReach = node.loc as SrcLoc;
      if (v !== undefined && v.kind === "closure" && typeof v.fnName === "string" && !dynNames.has(v.fnName) && !PRIMITIVE_CTOR_CLOSURE.test(v.fnName)) {
        dynNames.set(v.fnName, node.loc as SrcLoc);
      }
    }
  });
  const result: FnTextAttachResult = { used, missing: null, constructMissing: null };
  // Texts are needed for the fn.text answer and for the non-constructor message of a
  // construct site; a program with neither needs none.
  if (used === null && construct === null) return result;
  const fileIndex = new Map<string, Map<string, ts.Node> | null>();
  for (const name of closureNames) {
    if (targets.has(name)) continue;
    targets.set(name, byName.get(name) ?? null);
  }
  for (const name of dynNames.keys()) {
    if (targets.has(name)) continue;
    targets.set(name, byName.get(name) ?? null);
  }
  for (const [name, fn] of targets) {
    if (fn !== null && fn.srcText !== undefined) continue;
    // A promise handler the lowering builds for `.then(cb)` (`%fnN_then`, cb
    // returning a promise) is the runtime's own callback: no user code holds
    // it as a value, so no fn.text can reach it and it needs no text.
    if (fn !== null && INTERNAL_THEN.test(name)) continue;
    // An adapter body (funcCoerceAdapter's impl) wraps one function value in
    // capture slot 0; its text is that closure's, resolved at run time.
    if (fn !== null && ADAPTER_IMPL.test(name) && fn.captures?.length === 1 && fn.captures[0]!.type.kind === "func") {
      fn.srcForwardCap0 = true;
      continue;
    }
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
      if (used !== null && result.missing === null) result.missing = { loc: used, fnName: name };
      continue;
    }
    fn!.srcText = text;
  }
  if (newConstruct !== null && primitiveStored !== null) {
    result.constructMissing ??= {
      loc: primitiveStored,
      fnName: "<primitive constructor>",
      reason: "the primitive constructor (String / Number / Boolean) is stored as a value, and constructing it answers a wrapper object this build does not represent",
    };
  }
  if (newConstruct !== null && staticBoundReach !== null) {
    result.constructMissing ??= {
      loc: staticBoundReach,
      fnName: "<statically bound function>",
      reason: "a statically bound function reaching a checked-dynamic value: its [[Construct]] answer is not carried exactly by the bound closure",
    };
  }
  if (reflectConstruct !== null && protoWrite !== null) {
    result.constructMissing = {
      loc: protoWrite,
      fnName: "prototype",
      reason: "a write of a non-literal-object 'prototype' on a checked-dynamic value can make a constructed instance's [[Prototype]] a non-plain object, which this build does not link",
    };
  }
  if (newConstruct !== null) {
    for (const [name, loc] of dynNames) {
      const reason = constructReasonOf(name, byName.get(name));
      if (reason !== null) {
        result.constructMissing = { loc, fnName: name, reason };
        break;
      }
    }
  }
  return result;
}
