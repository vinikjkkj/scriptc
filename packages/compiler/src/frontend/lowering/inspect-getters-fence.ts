/* util.inspect's `getters` option over a class VALUE, the one rendering this compiler cannot reproduce exactly.
 *
 * With showHidden, Node lists a class value's `prototype` object, whose accessors it runs when `getters` asks, with the PROTOTYPE as `this` (formatProperty's
 * `original`). A compiled accessor takes an instance struct; the prototype object has none of the instance's fields, so a body that reads `this` has no
 * exact answer here (Node reads `undefined` fields off it, or throws and prints the stack of its own internals). The renderer runs an accessor whose body
 * never reads its receiver (the `ignores this` bit the member table carries) exactly, and the same applies to a runtime base class's accessors
 * (EventEmitter.captureRejections, Readable.prototype.readable, ...): Node's getters over those throw TypeErrors whose stacks name Node's own files.
 *
 * This fence fires only when the program's own options literal statically asks for BOTH showHidden and getters (a truthy literal each) AND hands a class
 * value that holds such an accessor to untyped code. Options known only at run time compile: a run-time `getters` over such a class value keeps
 * the renderer's own run-time stop (raised before any output, as it was before), and every other run-time case renders exactly as Node does. */
import type { IrClassDef, IrFunction, IrType, SrcLoc } from "../../ir/nodes.js";
import { EVAL_STATIC_CLASSES, RUNTIME_EMITTER_CLASS, RUNTIME_STREAM_CLASSES, accessorIgnoresThis } from "../../ir/nodes.js";

export interface InspGettersScan {
  /** An inspect/format call whose options may name `getters` (run-time options, or a literal that does). */
  mayGetters: boolean;
  /** Class values handed to untyped code: the IR class name and the first site. */
  classValues: Map<string, SrcLoc | undefined>;
}

export function newInspGettersScan(): InspGettersScan {
  return { mayGetters: false, classValues: new Map() };
}

type OptsNode = { kind?: string; fields?: { key?: { kind?: string; value?: unknown }; value?: unknown }[] } | undefined;

/** Is this option value statically known to be truthy? A `true` or a non-empty string literal (the dynamic boxing around it is looked through). */
function knownTruthy(v: unknown): boolean {
  let n = v as { kind?: string; value?: unknown } | undefined;
  while (n !== undefined && n.kind === "dynFrom") n = n.value as typeof n;
  if (n === undefined) return false;
  if (n.kind === "boolLit") return n.value === true;
  if (n.kind === "strLit") return typeof n.value === "string" && n.value !== "";
  return false;
}

/** Does this options literal statically ask for BOTH showHidden and getters? Only then is the refusal certain to matter: options known only at run
 * time compile (a run-time `getters` over such a class value stops at run time, as it did before), and so do literals that leave either out. */
function optionsAskGetters(opts: OptsNode): boolean {
  if (opts === undefined || opts.kind !== "dynObjLit") return false;
  let getters = false;
  let showHidden = false;
  for (const f of opts.fields ?? []) {
    if (f.key?.kind !== "strLit" || typeof f.key.value !== "string") continue;
    if (f.key.value === "getters" && knownTruthy(f.value)) getters = true;
    if (f.key.value === "showHidden" && knownTruthy(f.value)) showHidden = true;
  }
  return getters && showHidden;
}

/** Fold one IR node into the scan (the caller already walks every node). */
export function noteInspGettersNode(o: { kind?: string; callee?: unknown; args?: unknown; value?: { type?: IrType }; loc?: SrcLoc }, st: InspGettersScan): void {
  if (o.kind === "call" && typeof o.callee === "string" && Array.isArray(o.args)) {
    if (o.callee.startsWith("%util.inspopts.")) {
      if (optionsAskGetters(o.args[1] as OptsNode)) st.mayGetters = true;
    } else if (o.callee.startsWith("%util.fmtopts.")) {
      if (optionsAskGetters(o.args[0] as OptsNode)) st.mayGetters = true;
    }
    return;
  }
  if (o.kind === "dynFrom") {
    const t = o.value?.type;
    if (t?.kind === "classval") {
      if (!st.classValues.has(t.className)) st.classValues.set(t.className, o.loc);
    } else if (t?.kind === "object" && EVAL_STATIC_CLASSES.has(t.className)) {
      // the evaluation object of a class expression minted in a function: its instance class is the name without the `.%static` suffix
      const inst = t.className.endsWith(".%static") ? t.className.slice(0, -".%static".length) : t.className;
      if (!st.classValues.has(inst)) st.classValues.set(inst, o.loc);
    }
  }
}

/** The refusal: a class value reaching untyped code whose chain holds an accessor that reads `this`, or roots in a runtime class with accessors, in a
 * program that may ask for `getters`. Calls `push` once per offending class value. */
export function fenceInspGetters(
  st: InspGettersScan,
  functions: readonly IrFunction[],
  classes: readonly IrClassDef[],
  push: (d: { code: string; message: string; loc?: SrcLoc }) => void,
): void {
  if (!st.mayGetters || st.classValues.size === 0) return;
  const byName = new Map<string, IrClassDef>();
  for (const c of classes) byName.set(c.name, c);
  let fnByName: Map<string, IrFunction> | null = null;
  for (const [cname, loc] of st.classValues) {
    let why: string | null = null;
    for (let c = byName.get(cname); c !== undefined && why === null; c = c.base !== undefined ? byName.get(c.base) : undefined) {
      if (c.name === RUNTIME_EMITTER_CLASS || RUNTIME_STREAM_CLASSES.has(c.name)) {
        why = `its chain roots in the runtime class ${c.name.replace(/^%/, "")}, whose accessors Node runs against a prototype and reports with the stack of Node's own files`;
        break;
      }
      if (c.runtime === true) continue;
      for (const m of c.methods ?? []) {
        if (!m.startsWith("get:") || m.startsWith("get:#")) continue;
        if (fnByName === null) fnByName = new Map(functions.map((f) => [f.name, f]));
        const impl = c.dynMethods?.find((d) => d.name === m);
        const fn = fnByName.get(impl !== undefined ? impl.fn : `%${c.name}.${m}`) ?? fnByName.get(`%${c.name}.${m}%ns`);
        if (fn === undefined || !accessorIgnoresThis(fn)) {
          why = `its accessor '${m.slice(4)}' reads \`this\`, which is the prototype object (holding none of the instance's fields) when Node runs it`;
          break;
        }
      }
      if (why === null) {
        for (const d of c.dynMethods ?? []) {
          if (!d.name.startsWith("get:") || d.name.startsWith("get:#")) continue;
          if (fnByName === null) fnByName = new Map(functions.map((f) => [f.name, f]));
          const fn = fnByName.get(d.fn);
          if (fn === undefined || !accessorIgnoresThis(fn)) {
            why = `its accessor '${d.name.slice(4)}' reads \`this\`, which is the prototype object (holding none of the instance's fields) when Node runs it`;
            break;
          }
        }
      }
    }
    if (why !== null) {
      push({
        code: "SC1101",
        message:
          `converting the class value '${byName.get(cname)?.jsName ?? cname}' to 'unknown' in a program that asks util.inspect / util.format for showHidden and getters (the \`getters\` option runs ` +
          `a class value's prototype accessors against the prototype object): ${why}`,
        ...(loc !== undefined ? { loc } : {}),
      });
    }
  }
}
