/** STABLE LATE-BOUND SYMBOL NAMES.
 *
 * tsgo spells the member a computed symbol key declares `__@<variable>@<id>` (`{ [s]: v }`, `[Symbol.iterator]`, an `Error`'s
 * `__@captureRejectionSymbol@10`), and a `#private` member `__#<id>@<name>`, where `<id>` is the CHECKER'S internal symbol id. The ids are handed out in
 * the order the checker happens to resolve things, which is not the same from one run to the next: two builds of ONE tree named the same member
 * `__@dispose@47` and `__@dispose@21`. The name is the record field name, the field's mangled C identifier (`sc_fld____x40_dispose_x40_47`) and an input of
 * every shape, record-struct and union-narrow hash derived from it, so the emitted program differed run to run (measured on REST and mysql, in CI, on the
 * same tree: masking the suffixes was not enough, the hashed type names moved too).
 *
 * The id carries no meaning beyond telling two symbols of one spelling apart, so the client renumbers it: the Nth distinct raw spelling a snapshot
 * materialises becomes `N` (one counter per snapshot, shared by both forms, so the number stays unique within a snapshot as the id was). First-encounter
 * order is the order of the compiler's own requests, which is deterministic.
 *
 * ONE CHOKE POINT. Every Symbol the client builds goes through SnapshotObjectRegistry.getOrCreateSymbol, so that is wrapped (once, on the class's
 * prototype, from the first snapshot's registry). The two checker queries that send a name BACK to tsgo (getPropertyOfType, getMemberInModuleExports) are
 * wrapped to translate a renumbered name to the spelling the server knows. Nothing else in the client sends a symbol name. */

interface SymbolData {
  name?: string;
}
interface RegistryLike {
  getOrCreateSymbol(data: SymbolData): unknown;
}
interface CheckerLike {
  objectRegistry: { snapshotRegistry: RegistryLike };
  getPropertyOfType(type: unknown, name: string): unknown;
  getMemberInModuleExports(symbol: unknown, name: string): unknown;
}

interface Canon {
  /** raw spelling -> renumbered spelling */
  readonly toStable: Map<string, string>;
  /** renumbered spelling -> raw spelling */
  readonly toRaw: Map<string, string>;
  next: number;
}

const LATE = /^__@(.*)@(\d+)$/;
const PRIVATE = /^__#(\d+)@(.*)$/;

const canons = new WeakMap<object, Canon>();
let installed = false;

function canonOf(registry: object): Canon {
  let c = canons.get(registry);
  if (c === undefined) {
    c = { toStable: new Map(), toRaw: new Map(), next: 1 };
    canons.set(registry, c);
  }
  return c;
}

function stableName(c: Canon, raw: string): string {
  const known = c.toStable.get(raw);
  if (known !== undefined) return known;
  let stable = raw;
  const late = LATE.exec(raw);
  const priv = late === null ? PRIVATE.exec(raw) : null;
  if (late !== null) stable = `__@${late[1]}@${c.next++}`;
  else if (priv !== null) stable = `__#${c.next++}@${priv[2]}`;
  c.toStable.set(raw, stable);
  if (stable !== raw) c.toRaw.set(stable, raw);
  return stable;
}

/** Installs the renumbering on the tsgo client, once per process; `checker` is any live project's checker (it leads to the prototypes). */
export function installSymbolCanon(checker: unknown): void {
  if (installed) return;
  const chk = checker as CheckerLike;
  const registry = chk.objectRegistry.snapshotRegistry;
  const registryProto = Object.getPrototypeOf(registry) as RegistryLike;
  const checkerProto = Object.getPrototypeOf(chk) as CheckerLike;
  const create = registryProto.getOrCreateSymbol;
  registryProto.getOrCreateSymbol = function (this: object, data: SymbolData): unknown {
    // A symbol already built keeps its name; only a NEW one is renamed (the data object is the wire's, owned by this call).
    if (typeof data.name === "string" && (data.name.startsWith("__@") || data.name.startsWith("__#"))) {
      data = { ...data, name: stableName(canonOf(this), data.name) };
    }
    return create.call(this, data);
  };
  const toRaw = (self: CheckerLike, name: string): string =>
    canons.get(self.objectRegistry.snapshotRegistry)?.toRaw.get(name) ?? name;
  const getProp = checkerProto.getPropertyOfType;
  checkerProto.getPropertyOfType = function (this: CheckerLike, type: unknown, name: string): unknown {
    return getProp.call(this, type, toRaw(this, name));
  };
  const getMember = checkerProto.getMemberInModuleExports;
  checkerProto.getMemberInModuleExports = function (this: CheckerLike, symbol: unknown, name: string): unknown {
    return getMember.call(this, symbol, toRaw(this, name));
  };
  installed = true;
}
