// `const backend = backends[provider]` — an absent key bound to a COMPOSITE
// const answers undefined, so the author's own guard runs.
//
// zapo `store/createStore.ts:124`, `resolveStore`, sixteen of the ninety-four
// ABORT.real call sites in its emitted TU (fifteen of them the fifteen
// `resolveStore_%N` generic instantiations of this one source construct):
//
//     const backend = backends[provider]      // Record<string, WaStoreBackend>
//     if (!backend) {
//         throw new Error(`unknown backend '${provider}' for ${domain}`)
//     }
//
// THE AUTHOR WROTE THE GUARD. tsc types an index-signature read by the
// signature's VALUE type, so the read is spelled `WaStoreBackend`, a MISS has
// nowhere to go, and the emitted helper's `scr_trap_fmt` — an uncatchable
// process abort past every catch clause, with no [SCxxxx] tag — fired ONE
// LINE BEFORE the catchable throw the program has for exactly this input.
// Node runs that line and takes the author's branch. The abort was not
// protecting anything; it was pre-empting the program's own error handling,
// on ordinary input (any unrecognised provider name).
//
// WHY THE COMPOSITE NEEDED ITS OWN RUNG. The binding rule that already
// answers `const id = attrs.id` holds the read at DYN width, and refuses a
// composite for a real reason: a composite at dyn width is a `dynFrom` DEEP
// COPY (toDynHelper's record arm builds a fresh object field by field), which
// severs aliasing the binding has today. That argument is about the dyn
// REPRESENTATION. A union wrap retains the very value the map holds — r06
// below is the test that says so, and it must stay `true`.
//
// WHY IT DID NOT EXIST BEFORE. The undefined-armed union at a DECLARATION was
// refused as "tsc narrows the slot to the arm, so every later use compiles as
// a bare arm peek over a stored undefined — the r03 SEGFAULT". That claim was
// written six hours before `733f4db9` routed every checker-driven narrowing
// through `narrowedArmHelper`, which emits `if (unionIsTag) throw
// new TypeError(...)` BEFORE the payload peek. It was never revisited. r08
// and r09 below are that claim, measured: a `string | undefined` and a
// record-armed local that tsc narrowed away while holding the undefined arm
// each answer a CATCHABLE TypeError. No segfault, both backends.
//
// The guards themselves needed the twin fix in the same series
// (`narrowBridgeUnion`) — without it `!backend` throws the bridge's own
// TypeError on the way to the branch that exists to handle it, and
// `backend === undefined` folds to a SILENT false. Corpus 5091 covers that
// half; the two rungs are ablated apart (`SCRIPTC_COMPARM_OFF=1`,
// `SCRIPTC_ARMGUARD_OFF=1`) and neither alone makes this file pass.

interface AuthStore { readonly tag: string }

interface WaStoreBackend {
  readonly stores: {
    readonly auth: (sessionId: string) => AuthStore;
    readonly session: (sessionId: string) => AuthStore;
  };
  readonly caches: {
    readonly retry: (sessionId: string) => AuthStore;
  };
}

// ----------------------------------------------- 1. zapo's own construct
function resolveStore<T>(
  sessionId: string,
  backends: Readonly<Record<string, WaStoreBackend>>,
  provider: string | undefined,
  domain: string,
  kind: "stores" | "caches",
  fallback: () => T,
): T {
  if (!provider || provider === "memory" || provider === "none") {
    return fallback();
  }
  const backend = backends[provider];
  if (!backend) {
    throw new Error("unknown backend '" + provider + "' for " + domain);
  }
  const factory = backend[kind] as unknown as Readonly<Record<string, (id: string) => T>>;
  const made = factory[domain];
  return made === undefined ? fallback() : made(sessionId);
}

const redis: WaStoreBackend = {
  stores: {
    auth: (id: string) => ({ tag: "redis-auth:" + id }),
    session: (id: string) => ({ tag: "redis-session:" + id }),
  },
  caches: { retry: (id: string) => ({ tag: "redis-retry:" + id }) },
};
const backends: Readonly<Record<string, WaStoreBackend>> = { redis };

const fb = (): AuthStore => ({ tag: "memfallback" });

// The paths that must NOT move: the author's early return, both spellings.
console.log("r01", resolveStore<AuthStore>("s1", backends, undefined, "auth", "stores", fb).tag);
console.log("r02", resolveStore<AuthStore>("s1", backends, "memory", "auth", "stores", fb).tag);
// A HIT is the value it always was, through both kind arms.
console.log("r03", resolveStore<AuthStore>("s1", backends, "redis", "session", "stores", fb).tag);
console.log("r04", resolveStore<AuthStore>("s2", backends, "redis", "retry", "caches", fb).tag);
// THE MISS THE AUTHOR GUARDED — this line used to abort the process.
try {
  console.log("r05 unreachable", resolveStore<AuthStore>("s1", backends, "postgres", "auth", "stores", fb).tag);
} catch (e) {
  console.log("r05 caught:", (e as Error).message);
}

// -------------------------------------------------- 2. identity, not a copy
// The whole reason this rung wraps in a union instead of widening to dyn.
function pick(bs: Readonly<Record<string, WaStoreBackend>>, k: string): WaStoreBackend {
  const b = bs[k];
  if (!b) {
    throw new Error("no " + k);
  }
  return b;
}
console.log("r06 identity:", pick(backends, "redis") === redis);

// ------------------------------------- 3. the reader that NEEDS the value
// No guard at all: Node throws its own TypeError on the member read. Ours is
// the checked extraction's, which is catchable too — a loud, catchable
// failure where there used to be an uncatchable abort.
function unguarded(bs: Readonly<Record<string, WaStoreBackend>>, k: string): string {
  const b = bs[k];
  return b.stores.auth("z").tag;
}
try {
  console.log("r07 unreachable", unguarded(backends, "gone"));
} catch (e) {
  console.log("r07 caught:", (e as Error).name);
}

// ------------------------------------------ 4. the r03 claim, measured
// A declared `T | undefined` that tsc narrowed to `T` while the value is the
// undefined arm. The claim said "a bare arm peek — SEGFAULT". It is the
// checked extraction, and it is catchable, for a scalar and for a record.
function lieStr(v: string | undefined): v is string { return true; }
function lieRec(v: WaStoreBackend | undefined): v is WaStoreBackend { return true; }
const gone: string | undefined = undefined as string | undefined;
if (lieStr(gone)) {
  try {
    console.log("r08 unreachable", gone.length);
  } catch (e) {
    console.log("r08 caught:", (e as Error).name);
  }
}
const goneRec: WaStoreBackend | undefined = undefined as WaStoreBackend | undefined;
if (lieRec(goneRec)) {
  try {
    console.log("r09 unreachable", goneRec.stores.auth("z").tag);
  } catch (e) {
    console.log("r09 caught:", (e as Error).name);
  }
}

// ------------------------------------------ 5. the cases that must NOT move
// The author who wrote the arm HERSELF, at a declaration tsc then narrows
// away: the same rung, with the annotation's own union instead of a
// synthesized one. This is the shape the r03 claim was literally about.
// (At FILE scope the same two lines still abort -- the module-global branch
// of lowerVarDecl takes `lowerExprExpecting(init, g.type)` and never
// consults these rungs; `keyedReadGlobalIsDyn` is its scalar-only twin. That
// destination is named in estado-resolvestore.md and is not closed here.)
function annotated(bs: Readonly<Record<string, WaStoreBackend>>): string {
  const already: WaStoreBackend | undefined = bs["nope"];
  return already === undefined ? "undefined" : "present";
}
console.log("r10", annotated(backends));
// A SIGNATURE-FREE shape's keyed read was proven to name a declared field, so
// its miss is a smuggled key and it keeps the stranded stance untouched.
const plain = { a: 1, b: 2 };
const which = "a";
console.log("r11", plain[which]);
// A SCALAR width still takes the dyn binding rule, not this one.
const attrs: Readonly<Record<string, string>> = { id: "x" };
const id = attrs.id;
const missing = attrs.nope;
console.log("r12", String(id), String(missing), missing === undefined);
// A LET rebound after the guard keeps the value it was given.
function rebind(bs: Readonly<Record<string, WaStoreBackend>>): string {
  let b = bs["nope"];
  if (!b) {
    b = redis;
  }
  return b.stores.auth("r").tag;
}
console.log("r13", rebind(backends));

console.log("r14 still running");
