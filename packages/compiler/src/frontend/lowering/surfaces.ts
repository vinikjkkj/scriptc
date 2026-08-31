/* Surface tables and provenance predicates of the lowerer: the island
 * surface (Math/number/string/global functions marshalable through the
 * dynamic island), the node builtin-module call tables and their fence
 * hints, the string/array/map/set method-name sets, the unsupported-syntax
 * diagnostic tables, and the "which world declared this symbol" predicates
 * (ambient scriptc.d.ts / standard lib / @types/node provenance). */
import * as ts from "../ts7/adapter.js";
import type { Lowerer } from "./lowerer.js";
import { UNSUPPORTED } from "../../diagnostics/diagnostic.js";
import { BOOL, BYTES_U8, CHILD_T, DYN, F64, FILEHANDLE_T, IrExpr, IrLibFn, IrParam, IrStmt, IrStrIntrinsicMethod, IrType, KEYOBJ, SPAWNRES_T, STATS_T, STRING, SrcLoc, URL_T, VOID, arrayOf, funcOf, typeEquals, UNDEFINED_T, } from "../../ir/nodes.js";
import { STR_INTRINSIC_SIGS } from "../../ir/validate.js";
import { definePropTableDecline } from "./lower-classes.js";
import { isJsSourceFile, isNodeTypesPath, locOf, requireSpecOf } from "../program.js";

/** Statement-level constructs rejected wholesale, keyed by syntax kind. */
export const UNSUPPORTED_STMT: Partial<Record<ts.SyntaxKind, { code: keyof typeof UNSUPPORTED; feature?: string }>> = {
  // Top-level ClassDeclarations are supported (collected in run()); one
  // reaching lowerStmt is nested inside a function.
  [ts.SyntaxKind.ClassDeclaration]: { code: "SC1090", feature: "class declarations inside functions" },
  // DoStatement / SwitchStatement are supported; handled in lowerStmt.
  // ForOfStatement is supported (arrays); handled in lowerStmt.
  // ThrowStatement / TryStatement are supported (exceptions); handled in
  // lowerStmt (catch bindings and jumps crossing a finally stay rejected).
  // ForInStatement is supported (records/index-signature shapes via the
  // Object.keys walk, arrays via index strings, globalThis empty) —
  // handled in lowerStmt via lowerForIn; tuple/class/other receivers keep
  // named SC1052 fences there.
  // LabeledStatement is supported (labels on loops/switches directly, a
  // labeled block wrapper for everything else) — handled in lowerStmt via
  // lowerLabeled; what remains fenced is labeled jumps naming a loop whose
  // lowering is a label-free desugar (SC1050 at the jump site).
  // EnumDeclaration is supported (constant members fold; computed members
  // fence) — handled in lowerStmt via lower-enums.ts.
  [ts.SyntaxKind.ModuleDeclaration]: { code: "SC1090", feature: "namespaces" },
  [ts.SyntaxKind.DebuggerStatement]: { code: "SC1090", feature: "debugger statements" },
  // `with` blocks rewrite identifier resolution at runtime — statically
  // uncompilable by design, and already an error in strict-mode JS.
  [ts.SyntaxKind.WithStatement]: {
    code: "SC1090",
    feature: "'with' statements (runtime scope injection has no static resolution — bind the object to a variable and read members through it)",
  },
};

export const UNSUPPORTED_EXPR: Partial<Record<ts.SyntaxKind, { code: keyof typeof UNSUPPORTED; feature?: string }>> = {
  // ArrowFunction / FunctionExpression are supported (closures); handled in
  // lowerExpr before this table.
  [ts.SyntaxKind.ClassExpression]: { code: "SC1020" },
  // ObjectLiteralExpression is supported (records); handled in lowerExpr.
  // ArrayLiteralExpression / ElementAccessExpression are supported (arrays);
  // handled in lowerExpr.
  // PropertyAccessExpression rejections are per-site in lowerExpr (the
  // receiver lowers first — its blocker wins — and the residue names the
  // property and receiver type; never a generic "property access").
  // NewExpression / ThisKeyword are supported (classes); handled in lowerExpr.
  // YieldExpression is supported (generators); handled in lowerExpr via
  // lowerYield (value-position yield* and non-generator contexts keep
  // their SC1071 fences there).
  // TaggedTemplateExpression is supported (an interned per-site strings
  // object + an ordinary call); handled in lowerExpr via lowerTaggedTemplate.
  [ts.SyntaxKind.TypeOfExpression]: { code: "SC1090", feature: "typeof expressions" },
  [ts.SyntaxKind.DeleteExpression]: { code: "SC1090", feature: "delete expressions" },
  // RegularExpressionLiteral is supported (regex); handled in lowerExpr.
  [ts.SyntaxKind.SpreadElement]: { code: "SC1090", feature: "spread arguments" },
  // PostfixUnaryExpression is supported (expression-position ++/-- over
  // f64 locals/globals — lowerIncDec); field/element receivers fence there.
};

/** The narrow-first hint every union fence shares — how to get from a
 * union-typed value to the single arm the static compiler can use. One
 * string so the fences speak with one voice (and match SC2003's hint). */
export const NARROW_FIRST =
  "narrow first: check a discriminant field, or compare with '!== undefined'/'!== null' for unit arms";

/* ── the options-record stance ───────────────────────────────────────────
 * Node's object-options rule: an options record's unknown keys are simply
 * IGNORED — the runtime reads the keys it documents and never validates
 * the rest, so `http.request({ port, wibble: 1 })` runs identically to the
 * wibble-free call. Rejecting a real Node program's option keys with a
 * generic excess-property error is therefore itself a divergence, so the
 * RECORD-shaped options parameters of the fallback surface carry an
 * `[option: string]: unknown` index signature (every key typechecks) and
 * each option WALK splits per key instead:
 *   - lowered keys take their lowering (bad VALUE shapes keep their
 *     per-key fences);
 *   - keys Node DOCUMENTS for the API but this compiler cannot honor
 *     fence BY NAME at the use site — an option that changes
 *     Node-observable behavior must work or fence, never silently drop;
 *   - undocumented keys DROP exactly as Node drops them, provided the
 *     value expression is side-effect-free (an effectful initializer
 *     fences: Node would have evaluated it, so skipping it would be
 *     observable).
 * fenceOrDropOptionKey is that split's tail — option walks call it for
 * every key outside their lowered set. */

/** True iff evaluating the option value can have no observable effect —
 * the drop-safety test of the options-record stance. Literals, identifier
 * reads (shorthand included), closures (created, never called — the key
 * is unknown, so nothing can reach it), prefix +/-/! over these, and
 * object/array literals of these all qualify; anything with a call,
 * a property read (getters), or an assignment does not. */
export function sideEffectFreeOptionValue(node: ts.Expression): boolean {
  let e = node;
  while (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isTypeAssertion(e)) e = e.expression;
  if (ts.isIdentifier(e)) return true; // includes `undefined`
  if (ts.isStringLiteralLike(e) || ts.isNumericLiteral(e) || ts.isBigIntLiteral(e)) return true;
  if (e.kind === ts.SyntaxKind.TrueKeyword || e.kind === ts.SyntaxKind.FalseKeyword ||
      e.kind === ts.SyntaxKind.NullKeyword) return true;
  if (ts.isArrowFunction(e) || ts.isFunctionExpression(e)) return true;
  if (ts.isPrefixUnaryExpression(e) &&
      (e.operator === ts.SyntaxKind.MinusToken || e.operator === ts.SyntaxKind.PlusToken ||
       e.operator === ts.SyntaxKind.ExclamationToken)) {
    return sideEffectFreeOptionValue(e.operand);
  }
  if (ts.isObjectLiteralExpression(e)) {
    return e.properties.every((p) =>
      ts.isShorthandPropertyAssignment(p) ||
      (ts.isPropertyAssignment(p) && !ts.isComputedPropertyName(p.name) &&
        sideEffectFreeOptionValue(p.initializer)));
  }
  if (ts.isArrayLiteralExpression(e)) {
    return e.elements.every((el) => !ts.isSpreadElement(el) && sideEffectFreeOptionValue(el));
  }
  return false;
}

/** The stance's tail: `key` is outside the walk's lowered set. Documented
 * keys of the API fence by name (pointed per-key hints first, the walk's
 * supported-options hint otherwise); undocumented keys drop like Node
 * drops them when the value is side-effect-free, and fence when it is
 * not. `prop` is the property entry (assignment or shorthand) for spans. */
export function fenceOrDropOptionKey(
  L: Lowerer,
  prop: ts.ObjectLiteralElementLike,
  key: string,
  api: string,
  documented: ReadonlySet<string>,
  supportedHint: string,
  pointedHints?: Record<string, string | undefined>,
): void {
  if (documented.has(key)) {
    L.noLowering(`${api} option '${key}'`, prop, pointedHints?.[key] ?? supportedHint);
  }
  const value = ts.isPropertyAssignment(prop) ? prop.initializer : null;
  if (value !== null && !sideEffectFreeOptionValue(value)) {
    L.noLowering(
      `the undocumented ${api} option '${key}' with an effectful value`,
      prop,
      "Node ignores undocumented option keys and so does this compiler, but Node still evaluates the value — hoist it (const v = ...) or drop the entry",
    );
  }
  // Dropped: Node's own ignore, byte-exact.
}

/** http.request/http.get's documented option keys (Node v24 — the
 * `http.request(options)` and `net.socket.connect` tables); everything
 * else on a client options literal is undocumented and drops. */
export const HTTP_CLIENT_DOCUMENTED_OPTIONS: ReadonlySet<string> = new Set([
  "agent", "auth", "createConnection", "defaultPort", "family", "headers",
  "hints", "host", "hostname", "insecureHTTPParser", "joinDuplicateHeaders",
  "localAddress", "localPort", "lookup", "maxHeaderSize", "method", "path",
  "port", "protocol", "setDefaultHeaders", "setHost", "signal", "socketPath",
  "timeout", "uniqueHeaders",
]);

/** http.createServer / http.Server's documented option keys (Node v24 —
 * http.createServer options + the net.Server knobs it forwards). The
 * lowered pair is requireHostHeader/joinDuplicateHeaders; the rest fence
 * by name here, and unknown keys drop like Node drops them. */
export const HTTP_SERVER_DOCUMENTED_OPTIONS: ReadonlySet<string> = new Set([
  "IncomingMessage", "ServerResponse", "allowHalfOpen", "connectionsCheckingInterval",
  "headersTimeout", "highWaterMark", "insecureHTTPParser", "joinDuplicateHeaders",
  "keepAlive", "keepAliveInitialDelay", "keepAliveTimeout", "maxHeaderSize",
  "noDelay", "pauseOnConnect", "rejectNonStandardBodyWrites", "requestTimeout",
  "requireHostHeader", "uniqueHeaders",
]);

/** new http.Agent(options)'s documented keys (Node v24 — the Agent
 * constructor table plus the socket.connect() options it forwards into
 * each dial). The lowered set is keepAlive/keepAliveMsecs/maxSockets/
 * maxFreeSockets/timeout/port (+ scheduling, dropped: no free pool
 * exists); the rest fence by name and unknown keys drop like Node. */
export const AGENT_DOCUMENTED_OPTIONS: ReadonlySet<string> = new Set([
  "family", "hints", "host", "keepAliveInitialDelay", "localAddress",
  "localPort", "lookup", "maxTotalSockets", "noDelay", "path",
]);

/** https.request adds tls.connect's client-side TLS knobs. */
export const HTTPS_CLIENT_DOCUMENTED_OPTIONS: ReadonlySet<string> = new Set([
  ...HTTP_CLIENT_DOCUMENTED_OPTIONS,
  "ca", "cert", "checkServerIdentity", "ciphers", "clientCertEngine", "crl",
  "dhparam", "ecdhCurve", "highWaterMark", "honorCipherOrder", "key",
  "maxVersion", "minVersion", "passphrase", "pfx", "privateKeyEngine",
  "privateKeyIdentifier", "rejectUnauthorized", "secureOptions",
  "secureProtocol", "servername", "session", "sessionIdContext",
  "sessionTimeout", "sigalgs", "ticketKeys",
]);

/** tls.createServer / tls.createSecureContext / https.createServer /
 * http2.createSecureServer's documented TLS-side option keys (Node v24 —
 * tls.createSecureContext + tls.createServer + net.createServer). */
export const TLS_SERVER_DOCUMENTED_OPTIONS: ReadonlySet<string> = new Set([
  "ALPNProtocols", "ALPNCallback", "SNICallback", "allowHalfOpen", "ca",
  "cert", "ciphers", "clientCertEngine", "crl", "dhparam", "ecdhCurve",
  "enableTrace", "handshakeTimeout", "highWaterMark", "honorCipherOrder",
  "keepAlive", "keepAliveInitialDelay", "key", "maxVersion", "minVersion",
  "noDelay", "passphrase", "pauseOnConnect", "pfx", "privateKeyEngine",
  "privateKeyIdentifier", "pskCallback", "pskIdentityHint",
  "rejectUnauthorized", "requestCert", "requestOCSP", "secureContext",
  "secureOptions", "secureProtocol", "sessionIdContext", "sessionTimeout",
  "sigalgs", "ticketKeys",
]);

/** http2.createSecureServer's documented keys: the h2 knobs on top of the
 * TLS server set. */
export const HTTP2_SECURE_SERVER_DOCUMENTED_OPTIONS: ReadonlySet<string> = new Set([
  ...TLS_SERVER_DOCUMENTED_OPTIONS,
  "allowHTTP1", "maxDeflateDynamicTableSize", "maxSettings",
  "maxSessionMemory", "maxHeaderListPairs", "maxOutstandingPings",
  "maxSendHeaderBlockLength", "origins", "paddingStrategy",
  "peerMaxConcurrentStreams", "remoteCustomSettings", "selectPadding",
  "settings", "streamResetBurst", "streamResetRate",
  "unknownProtocolTimeout",
]);

/** fs.watch's documented option keys. */
export const FS_WATCH_DOCUMENTED_OPTIONS: ReadonlySet<string> = new Set([
  "persistent", "recursive", "encoding", "signal",
]);

/** fs.createReadStream's documented option keys (Node v24). `flags`,
 * `encoding`, `start`, `end`, `highWaterMark`, `mode`, `autoClose` and
 * `emitClose` LOWER; `fd`, `signal` and `fs` fence by name here. */
export const FS_READ_STREAM_DOCUMENTED_OPTIONS: ReadonlySet<string> = new Set([
  "flags", "encoding", "fd", "mode", "autoClose", "emitClose", "start", "end",
  "highWaterMark", "signal", "fs",
]);

/** fs.createWriteStream's documented option keys (Node v24) — the same
 * list without `end`, which WriteStream's constructor never reads. */
export const FS_WRITE_STREAM_DOCUMENTED_OPTIONS: ReadonlySet<string> = new Set([
  "flags", "encoding", "fd", "mode", "autoClose", "emitClose", "start",
  "highWaterMark", "signal", "fs",
]);

/** The per-key hints for the fs stream options that do NOT lower. */
export const FS_STREAM_OPTION_HINTS: Record<string, string | undefined> = {
  fd: "an existing descriptor makes 'path' undefined and hands the fd's lifetime to the caller — open the path instead, or read it with fs.readSync",
  signal: "AbortSignal has no lowering yet; destroy() the stream to stop it",
  fs: "a substitute fs implementation is a dependency-injection seam with no lowering",
};

/** fs.readdirSync's documented option keys. */
export const FS_READDIR_DOCUMENTED_OPTIONS: ReadonlySet<string> = new Set([
  "encoding", "withFileTypes", "recursive",
]);

/** fs.writeFileSync's documented option keys. */
export const FS_WRITE_FILE_DOCUMENTED_OPTIONS: ReadonlySet<string> = new Set([
  "encoding", "mode", "flag", "flush", "signal",
]);

/** dns.lookup's documented option keys. */
export const DNS_LOOKUP_DOCUMENTED_OPTIONS: ReadonlySet<string> = new Set([
  "family", "hints", "all", "order", "verbatim",
]);

/** querystring.parse's documented option keys (Node v24). */
export const QS_PARSE_DOCUMENTED_OPTIONS: ReadonlySet<string> = new Set([
  "maxKeys", "decodeURIComponent",
]);

/** querystring.stringify's documented option keys (Node v24). */
export const QS_STRINGIFY_DOCUMENTED_OPTIONS: ReadonlySet<string> = new Set([
  "encodeURIComponent",
]);

/** readline.createInterface's documented option keys. */
export const READLINE_DOCUMENTED_OPTIONS: ReadonlySet<string> = new Set([
  "input", "output", "completer", "terminal", "history", "historySize",
  "removeHistoryDuplicates", "prompt", "crlfDelay", "escapeCodeTimeout",
  "tabSize", "signal",
]);

/** The lowered Array<T> method surface. Like STR_METHODS, membership is
 * only half the check — the resolved symbol must be declared by the
 * standard library (isStdlibMember); lib-declared array methods outside
 * this set hit the SC2020 fence. */
export const ARRAY_METHODS = new Set([
  "fill",
  "push",
  "pop",
  "concat",
  "map",
  "filter",
  "forEach",
  "find",
  "findIndex",
  "findLast",
  "findLastIndex",
  "some",
  "every",
  "at",
  "flatMap",
  "reduce",
  "reduceRight",
  "indexOf",
  "includes",
  "join",
  "slice",
  "unshift",
  "reverse",
  "copyWithin",
  "toReversed",
  "toSpliced",
  "toSorted",
  "with",
]);

/** The lowered Map<K, V> method surface. Like ARRAY_METHODS, membership is
 * only half the check — the resolved symbol must be declared by the
 * standard library (isStdlibMember). `size` is a property, handled in
 * property-access position. */
export const MAP_METHODS = new Set(["get", "set", "has", "delete", "clear", "forEach"]);

/** The lowered Set<T> method surface — Map's minus get/set plus add.
 * `size` is a property, handled in property-access position. */
export const SET_METHODS = new Set(["add", "has", "delete", "clear", "forEach"]);

/** The ES2025 Set composition surface (union/intersection/…): desugared
 * to interned helper loops over the set iteration primitives — no user
 * code runs mid-loop, so the walks need no enter/exit bracketing. The
 * lib accepts any ReadonlySetLike argument; only a real Set lowers (the
 * argument's has/size must be the builtins for the desugar to BE the
 * spec's algorithm). */
export const SET_COMBINE_METHODS = new Set([
  "union",
  "intersection",
  "difference",
  "symmetricDifference",
  "isSubsetOf",
  "isSupersetOf",
  "isDisjointFrom",
]);

export type CompoundOp = "+" | "-" | "*" | "/" | "%" | "**" | "&" | "|" | "^" | "<<" | ">>" | ">>>";

export const COMPOUND_ASSIGN_OPS: Partial<Record<ts.SyntaxKind, CompoundOp>> = {
  [ts.SyntaxKind.PlusEqualsToken]: "+",
  [ts.SyntaxKind.MinusEqualsToken]: "-",
  [ts.SyntaxKind.AsteriskEqualsToken]: "*",
  [ts.SyntaxKind.SlashEqualsToken]: "/",
  [ts.SyntaxKind.AmpersandEqualsToken]: "&",
  [ts.SyntaxKind.BarEqualsToken]: "|",
  [ts.SyntaxKind.CaretEqualsToken]: "^",
  [ts.SyntaxKind.LessThanLessThanEqualsToken]: "<<",
  [ts.SyntaxKind.GreaterThanGreaterThanEqualsToken]: ">>",
  [ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken]: ">>>",
  [ts.SyntaxKind.PercentEqualsToken]: "%",
  [ts.SyntaxKind.AsteriskAsteriskEqualsToken]: "**",
};

/** String methods lowered to `strIntrinsic` (`.length` is handled in
 * property-access position). Membership here is only half the check: the
 * resolved symbol must also be declared by the standard library (see
 * isStdlibMember), so a user-declared `slice` on some other type can never
 * smuggle itself in by name. `minArgs`/`maxArgs` pin the LOWERED call
 * forms: the lib declares wider signatures (optional position/fromIndex
 * parameters) that typecheck but have no lowering — those forms are fenced
 * per site instead of silently dropping arguments. */
export const STR_METHODS: Record<
  string,
  { method: IrStrIntrinsicMethod; result: IrType; minArgs: number; maxArgs: number }
> = {
  charCodeAt: { method: "charCodeAt", result: F64, minArgs: 1, maxArgs: 1 },
  charAt: { method: "charAt", result: STRING, minArgs: 1, maxArgs: 1 },
  indexOf: { method: "indexOf", result: F64, minArgs: 1, maxArgs: 2 },
  // includes with a position argument is indexOf's clamp exactly (the
  // spec routes both through StringIndexOf) — the emitter composes
  // scr_str_index_of(...) != -1 for the two-argument form.
  includes: { method: "includes", result: BOOL, minArgs: 1, maxArgs: 2 },
  startsWith: { method: "startsWith", result: BOOL, minArgs: 1, maxArgs: 1 },
  endsWith: { method: "endsWith", result: BOOL, minArgs: 1, maxArgs: 1 },
  slice: { method: "slice", result: STRING, minArgs: 0, maxArgs: 2 },
  // substring: slice's clamp-and-swap sibling (negatives clamp to 0
  // instead of counting from the end; start > end swaps).
  substring: { method: "substring", result: STRING, minArgs: 1, maxArgs: 2 },
  repeat: { method: "repeat", result: STRING, minArgs: 1, maxArgs: 1 },
  trim: { method: "trim", result: STRING, minArgs: 0, maxArgs: 0 },
  trimStart: { method: "trimStart", result: STRING, minArgs: 0, maxArgs: 0 },
  trimEnd: { method: "trimEnd", result: STRING, minArgs: 0, maxArgs: 0 },
  // The Annex B aliases (lib.es2019 declares them as trimStart/trimEnd's
  // deprecated twins — same behavior, per spec).
  trimLeft: { method: "trimStart", result: STRING, minArgs: 0, maxArgs: 0 },
  trimRight: { method: "trimEnd", result: STRING, minArgs: 0, maxArgs: 0 },
  // The STRING-separator split, no limit (the lib's limit parameter
  // fences by arity here; regex separators lowered earlier as
  // regexIntrinsic). Empty separator splits per UTF-16 code unit —
  // astral halves become U+FFFD (SEMANTICS.md divergence 2, the same
  // substitution the island's boundary marshal applied).
  split: { method: "split", result: arrayOf(STRING), minArgs: 1, maxArgs: 1 },
  // padStart/padEnd with the fill omitted: Node pads with " " — the
  // lowering completes the default (lowerStringMethodCall).
  padStart: { method: "padStart", result: STRING, minArgs: 1, maxArgs: 2 },
  padEnd: { method: "padEnd", result: STRING, minArgs: 1, maxArgs: 2 },
  // The lre-backed pair (ECMA Default Case Conversion, final sigma
  // included — scr_regex.c): static now, no island needed; their presence
  // flips the regex LINK switch (moduleUsesRegex).
  toLowerCase: { method: "toLowerCase", result: STRING, minArgs: 0, maxArgs: 0 },
  toUpperCase: { method: "toUpperCase", result: STRING, minArgs: 0, maxArgs: 0 },
  // The ES2024 well-formedness pair — no-ops over the runtime's
  // well-formed storage (constant true / the identity, per spec on
  // well-formed input; where Node would answer false the program already
  // diverged at the string's creation, SEMANTICS.md 2).
  isWellFormed: { method: "isWellFormed", result: BOOL, minArgs: 0, maxArgs: 0 },
  toWellFormed: { method: "toWellFormed", result: STRING, minArgs: 0, maxArgs: 0 },
};

/** One member of the island-backed ambient surface: declared argument
 * types (tsc enforces them at call sites; the arity double-checks the
 * table against the ambient file) and the validated island-exit target the
 * engine's result must satisfy. */
export interface IslandFnEntry {
  args: IrType[];
  ret: IrType;
}

export const ISL_N1: IslandFnEntry = { args: [F64], ret: F64 };

export const ISL_N2: IslandFnEntry = { args: [F64, F64], ret: F64 };

export const boundaryIntoIslandMsg = (typeName: string): string =>
  `passing a value of type '${typeName}' into dynamically-executed ('any'-typed) code ` +
  `(only numbers, strings, booleans, typed arrays, URLs, undefined/null-armed unions, ` +
  `and JSON-safe records/arrays/unions can cross the boundary)`;

export const boundaryOutOfIslandMsg = (typeName: string): string =>
  `using an 'any' value where '${typeName}' is expected ` +
  `(an 'any' value can only exit to numbers, strings, booleans, JSON-safe records/arrays/unions, ` +
  `and 'T | undefined' over those)`;

/** The island-backed surface — standard-library APIs with no static
 * runtime implementation (Math.*, number/string methods beyond the
 * intrinsic set, parseFloat, ...). ONE table drives both sides of the
 * gate: under --dynamic each entry lowers to marshal → engine execution →
 * validated exit to the declared return type; without the flag each use
 * site is a per-site SC2012. Membership here is only half the check — the
 * resolved symbol must be declared by the standard library (provenance,
 * never names), so a user's own `parseFloat` or `.toFixed` takes the
 * ordinary paths. The lib declares MORE than this table (extra members,
 * optional-parameter forms): everything untabled falls through to the
 * SC2020 lib fence — never an ICE, never a link error. Exported so the
 * table-vs-lib consistency test can check every entry against the lib's
 * own declarations — a drifted entry fails a test instead of surprising a
 * user. */
export const ISLAND_SURFACE = {
  /** `Math.<fn>(...)` lowers to callMethod(globalGet("Math"), fn, args);
   * the readonly number props (`Math.PI`) to getProp(globalGet("Math")).
   * min/max/atan2/hypot/pow are declared with exactly two parameters
   * (rest/optional parameters aren't representable). */
  math: {
    // floor, min/max (two-arg), random, pow, log and clz32 are STATIC now
    // (STATIC_MATH_FNS below); so is every number constant
    // (STATIC_MATH_CONSTS), which is why `props` is empty.
    fns: {
      abs: ISL_N1, acos: ISL_N1, asin: ISL_N1, atan: ISL_N1, atan2: ISL_N2,
      cbrt: ISL_N1, ceil: ISL_N1, cos: ISL_N1, exp: ISL_N1,
      hypot: ISL_N2, log2: ISL_N1, log10: ISL_N1,
      round: ISL_N1,
      sign: ISL_N1, sin: ISL_N1, sqrt: ISL_N1, tan: ISL_N1, trunc: ISL_N1,
    } as Record<string, IslandFnEntry | undefined>,
    props: {} as Record<string, IrType | undefined>,
  },
  /** Methods on `number` receivers. The receiver marshals by value; the
   * engine auto-boxes primitives on method calls, so `this` binds the
   * number exactly as in JS. toString takes an EXPLICIT radix (radix-free
   * conversion is the static template-literal path). */
  number: {
    toFixed: { args: [F64], ret: STRING },
    toPrecision: { args: [F64], ret: STRING },
    toString: { args: [F64], ret: STRING },
  } as Record<string, IslandFnEntry | undefined>,
  /** Methods on `string` receivers beyond the static strIntrinsic set
   * (split/pad/trimStart/trimEnd moved to STR_METHODS — static now).
   * replace/replaceAll take STRING patterns (no regex is declared). `at`
   * returns `string`: out of range, the engine yields undefined and the
   * validated exit refuses it with a catchable TypeError (the documented
   * divergence from `string | undefined`). */
  string: {
    replace: { args: [STRING, STRING], ret: STRING },
    replaceAll: { args: [STRING, STRING], ret: STRING },
    at: { args: [F64], ret: STRING },
  } as Record<string, IslandFnEntry | undefined>,
  /** Global functions: parseInt and isNaN are STATIC (lower-calls.ts →
   * num.parseInt/num.isNaN), and parseFloat/isFinite lower statically
   * over EXACTLY-typed arguments (a string for parseFloat, a number for
   * isFinite — num.parseFloat/number.isFinite); these island entries
   * carry every OTHER argument shape, where the ToNumber/ToString
   * coercions stay engine territory. */
  globals: {
    parseFloat: { args: [STRING], ret: F64 },
    isFinite: { args: [F64], ret: BOOL },
  } as Record<string, IslandFnEntry | undefined>,
};

/** Math members with a STATIC lowering — each is one C call that IS the
 * JS operation, at the tabled arity (floor: libm's floor; min/max: the
 * NaN-poisoning ±0-ordered scalar folds; random: arc4random-backed
 * uniform [0,1) — SEMANTICS.md 62). Checked BEFORE the island table
 * (lowerIslandMethodCall), so the tabled arities compile statically and
 * other arities keep the island/fence story — except min/max, whose
 * variadic spelling lowers at ANY plain arity (the n-ary left fold of
 * the scalar compare; zero arguments answer the fold's ∓Infinity seed);
 * unioned with the island table for the methods-as-values fence
 * (lowerMathProperty). */
export const STATIC_MATH_FNS: Record<string, { fn: IrLibFn; arity: number } | undefined> = {
  floor: { fn: "math.floor", arity: 1 },
  abs: { fn: "math.abs", arity: 1 },
  round: { fn: "math.round", arity: 1 },
  // trunc/ceil joined the static table with ask 4: they are the
  // integer-boundary inference's wholeness-discharge operators (C
  // trunc()/ceil() ARE the JS operations, like floor).
  trunc: { fn: "math.trunc", arity: 1 },
  ceil: { fn: "math.ceil", arity: 1 },
  min: { fn: "math.min", arity: 2 },
  max: { fn: "math.max", arity: 2 },
  random: { fn: "math.random", arity: 0 },
  // pow/log/clz32 joined with the protobuf float codec, which is built
  // out of them: `Math.pow(2, e - 150)` denormalizes a float32 mantissa
  // and `Math.floor(Math.log(x) / Math.LN2)` recovers its exponent.
  // pow is the `**` operator's own runtime entry (one spec operation, so
  // one C symbol); log is libm's, which IS the JS function at every edge
  // the spec names; clz32 is the ToUint32 count.
  pow: { fn: "math.pow", arity: 2 },
  log: { fn: "math.log", arity: 1 },
  clz32: { fn: "math.clz32", arity: 1 },
};

/** Math's number CONSTANTS, and their exact double values — the same
 * literals V8 carries. A constant is a literal, so there is nothing here
 * for an engine to do: these fold to a numLit in every build, static or
 * dynamic, where they used to demand --dynamic through the island's
 * getProp. The two the island table already carried (PI, E) answer the
 * same bits; the other six are new, and `Math.LN2` in particular is what
 * a float32 exponent recovery divides by. */
export const STATIC_MATH_CONSTS: Record<string, number | undefined> = {
  PI: Math.PI,
  E: Math.E,
  LN2: Math.LN2,
  LN10: Math.LN10,
  LOG2E: Math.LOG2E,
  LOG10E: Math.LOG10E,
  SQRT2: Math.SQRT2,
  SQRT1_2: Math.SQRT1_2,
};

/** Number prototype methods with dedicated STATIC lowering paths. The
 * libCall spellings are also the compiled-graph witnesses used by library
 * fences, while the arity range is the surface manifest's support claim. */
export const STATIC_NUMBER_METHODS: Record<
  string,
  { fns: readonly IrLibFn[]; minArgs: number; maxArgs: number } | undefined
> = {
  toFixed: { fns: ["num.toFixed0", "num.toFixed"], minArgs: 0, maxArgs: 1 },
};

/** One lowerable builtin-module FUNCTION: `fn`'s libCall with `params`
 * completed exactly. `variadicPack` marks Node's rest-parameter functions
 * (path.join/resolve): every argument lowers as a string and the frontend
 * packs them into ONE string[] array-literal argument, so the C ABI stays
 * fixed-arity. `defaults` completes omitted TRAILING arguments with string
 * literals (path.basename's suffix → "", a Node no-op). */
export interface BuiltinModuleFn {
  fn: IrLibFn;
  params: IrType[];
  result: IrType;
  variadicPack?: boolean;
  defaults?: string[];
}

/** The lowerable surface of the supported node builtin modules, keyed by
 * CANONICAL module name (both "fs" and "node:fs" land on "fs" — see
 * canonicalBuiltinModule). Like STR_METHODS, membership is only half the
 * check — the identifier must be an IMPORT BINDING from that module's
 * specifier (see builtinImportOf), so a user function named `readFileSync`
 * can never smuggle itself in. Members @types/node declares beyond these
 * tables typecheck and hit the SC2020-family fence at their use site. */
/** node:path's POSIX members — the bare-module table on posix targets and
 * "path/posix" everywhere (Node's own aliasing: bare `path` IS the
 * target platform's implementation, and each named namespace answers ITS
 * platform's rules on any host). toNamespacedPath is the posix identity
 * (Node: a non-op on posix systems). */
const PATH_MODULE_FNS: Record<string, BuiltinModuleFn | undefined> = {
  join: { fn: "path.join", params: [STRING], result: STRING, variadicPack: true },
  resolve: { fn: "path.resolve", params: [STRING], result: STRING, variadicPack: true },
  normalize: { fn: "path.normalize", params: [STRING], result: STRING },
  dirname: { fn: "path.dirname", params: [STRING], result: STRING },
  basename: { fn: "path.basename", params: [STRING, STRING], result: STRING, defaults: [""] },
  extname: { fn: "path.extname", params: [STRING], result: STRING },
  isAbsolute: { fn: "path.isAbsolute", params: [STRING], result: BOOL },
  relative: { fn: "path.relative", params: [STRING, STRING], result: STRING },
  toNamespacedPath: { fn: "path.toNamespacedPath", params: [STRING], result: STRING },
};

/** The win32 twins (scr_path.c's Node-v24 path.win32 port, byte-for-byte):
 * "path/win32" everywhere, and the bare-module table when the build
 * TARGETS win32 — Node on Windows is path.win32. */
const PATH_WIN32_MODULE_FNS: Record<string, BuiltinModuleFn | undefined> = {
  join: { fn: "path.win32Join", params: [STRING], result: STRING, variadicPack: true },
  resolve: { fn: "path.win32Resolve", params: [STRING], result: STRING, variadicPack: true },
  normalize: { fn: "path.win32Normalize", params: [STRING], result: STRING },
  dirname: { fn: "path.win32Dirname", params: [STRING], result: STRING },
  basename: { fn: "path.win32Basename", params: [STRING, STRING], result: STRING, defaults: [""] },
  extname: { fn: "path.win32Extname", params: [STRING], result: STRING },
  isAbsolute: { fn: "path.win32IsAbsolute", params: [STRING], result: BOOL },
  relative: { fn: "path.win32Relative", params: [STRING, STRING], result: STRING },
  toNamespacedPath: { fn: "path.win32ToNamespacedPath", params: [STRING], result: STRING },
};

export const BUILTIN_MODULE_FNS: Record<string, Record<string, BuiltinModuleFn | undefined> | undefined> = {
  fs: {
    readFileSync: { fn: "fs.readFileSync", params: [STRING, STRING], result: STRING },
    writeFileSync: { fn: "fs.writeFileSync", params: [STRING, STRING], result: VOID },
    appendFileSync: { fn: "fs.appendFileSync", params: [STRING, STRING], result: VOID },
    existsSync: { fn: "fs.existsSync", params: [STRING], result: BOOL },
    mkdirSync: { fn: "fs.mkdirSync", params: [STRING], result: VOID },
    rmSync: { fn: "fs.rmSync", params: [STRING], result: VOID },
    rmdirSync: { fn: "fs.rmdirSync", params: [STRING], result: VOID },
    readdirSync: { fn: "fs.readdirSync", params: [STRING], result: arrayOf(STRING) },
    statSync: { fn: "fs.statSync", params: [STRING], result: STATS_T },
    mkdtempSync: { fn: "fs.mkdtempSync", params: [STRING], result: STRING },
    // accessSync's omitted mode completes to 0 (F_OK) in the special case
    // in lowerBuiltinModuleCall — string `defaults` can't spell a number.
    accessSync: { fn: "fs.accessSync", params: [STRING, F64], result: VOID },
    unlinkSync: { fn: "fs.unlinkSync", params: [STRING], result: VOID },
    chmodSync: { fn: "fs.chmodSync", params: [STRING, F64], result: VOID },
    chownSync: { fn: "fs.chownSync", params: [STRING, F64, F64], result: VOID },
    // The 2-argument form only: Node's mode flags (COPYFILE_EXCL, ...)
    // land on the arity fence.
    copyFileSync: { fn: "fs.copyFileSync", params: [STRING, STRING], result: VOID },
    // statSync's no-follow sibling; stats.isSymbolicLink answers what the
    // follow-free snapshot saw.
    lstatSync: { fn: "fs.lstatSync", params: [STRING], result: STATS_T },
    // realpath(3) — Node's realpathSync (failures spell syscall "lstat",
    // Node's own message shape).
    realpathSync: { fn: "fs.realpathSync", params: [STRING], result: STRING },
    // The fd pair behind spawn's fd-stdio form (the daemon-log idiom:
    // openSync(logPath, "a") → spawn stdio ["ignore", fd, fd] →
    // closeSync). openSync takes Node's string flags ("r", "w", "a", the
    // +/x variants — unknown flags throw Node's TypeError text); the
    // numeric-mode third argument fences by arity.
    openSync: { fn: "fs.openSync", params: [STRING, STRING], result: F64 },
    // The 4-argument buffer form (fd, buffer, offset, length) — what the
    // Node test harness's parseTestMetadata uses; the position parameter
    // and options-object forms fence by arity/shape.
    readSync: { fn: "fs.readSync", params: [F64, BYTES_U8, F64, F64], result: F64 },
    closeSync: { fn: "fs.closeSync", params: [F64], result: VOID },
    // The fs-backed source and sink: a real `%Readable` / `%Writable`
    // over the node:stream machinery (pipe, pipeline, for-await,
    // backpressure and the whole event order are that implementation).
    // The PATH-ONLY form — the options object (start/end/encoding/
    // highWaterMark/flags/fd/autoClose) fences by arity and keeps the
    // fs.streamOptsChk validation ladder in the JS lane.
    createReadStream: {
      fn: "fs.readStream", params: [STRING], result: { kind: "object", className: "%Readable" },
    },
    createWriteStream: {
      fn: "fs.writeStream", params: [STRING], result: { kind: "object", className: "%Writable" },
    },
    // Entirely special-cased (lowerFsWatchCall — the callback needs an
    // adapter per listener shape); this entry only routes the dispatch.
    watch: { fn: "fs.watch", params: [], result: VOID },
  },
  "fs/promises": {
    // The sync operations behind already-settled promises: failures
    // REJECT (catchable at the await) instead of throwing. readFile is
    // utf8-fenced exactly like readFileSync (same special case below).
    readFile: { fn: "fsp.readFile", params: [STRING, STRING], result: { kind: "promise", inner: STRING } },
    writeFile: { fn: "fsp.writeFile", params: [STRING, STRING], result: { kind: "promise", inner: VOID } },
    mkdir: { fn: "fsp.mkdir", params: [STRING], result: { kind: "promise", inner: VOID } },
    readdir: { fn: "fsp.readdir", params: [STRING], result: { kind: "promise", inner: arrayOf(STRING) } },
    rm: { fn: "fsp.rm", params: [STRING], result: { kind: "promise", inner: VOID } },
    stat: { fn: "fsp.stat", params: [STRING], result: { kind: "promise", inner: STATS_T } },
    // open(path, flags?) — the FileHandle the rest of the surface hangs
    // off. `defaults` completes Node's omitted flags to "r"; the numeric
    // mode third argument fences by arity, exactly like openSync's.
    // The result is a %FileHandle HANDLE, never the fd: a closed fd's
    // number is recycled by the OS, so a stale bare fd reads whatever
    // file got the number next and reports success (measured — see the
    // block report). Only an owned handle can answer Node's
    // `EBADF: file closed`.
    open: {
      fn: "fsp.open", params: [STRING, STRING],
      result: { kind: "promise", inner: FILEHANDLE_T }, defaults: ["r"],
    },
    unlink: { fn: "fsp.unlink", params: [STRING], result: { kind: "promise", inner: VOID } },
    chmod: { fn: "fsp.chmod", params: [STRING, F64], result: { kind: "promise", inner: VOID } },
  },
  // The bare module's POSIX-target binding; a win32 target rebinds it to
  // the win32 table (builtinModuleFnsOf — Node on Windows IS path.win32).
  path: PATH_MODULE_FNS,
  // Real Node modules ("node:path/posix" resolves), and the receivers of
  // `path.posix.<member>` / `path.win32.<member>` through the namespace
  // chain (builtinNamespaceModuleOf composes "path" + ".posix" to these
  // keys). Both namespaces carry the FULL surface on every platform,
  // Node's own rule: each answers its own platform's semantics anywhere.
  "path/posix": PATH_MODULE_FNS,
  "path/win32": PATH_WIN32_MODULE_FNS,
  os: {
    // One platform implementation: os.platform() === process.platform.
    platform: { fn: "process.platform", params: [], result: STRING },
    homedir: { fn: "os.homedir", params: [], result: STRING },
    tmpdir: { fn: "os.tmpdir", params: [], result: STRING },
    // uname(2)'s release field — Node's own implementation.
    release: { fn: "os.release", params: [], result: STRING },
    // uname(2)'s sysname field ("Darwin", "Linux", "Windows_NT") — the
    // libFn/runtime pair predates this entry (the portless surface used
    // them); this row makes the MODULE call reach them (test/common's
    // isAIX/isIBMi getters are the canonical callers).
    type: { fn: "os.type", params: [], result: STRING },
    // Total physical memory in bytes — same predating-pair story.
    totalmem: { fn: "os.totalmem", params: [], result: F64 },
    // Entirely special-cased (lowerOsNetworkInterfacesCall): the result is
    // the call site's mapped Dict<NetworkInterfaceInfo[]> shape, verified
    // structurally there — this entry only routes the dispatch.
    networkInterfaces: { fn: "os.networkInterfaces", params: [], result: VOID },
    // Special-cased too (lowerOsUserInfoCall): the call site's mapped
    // UserInfo record assembles field-by-field from scalar libCalls.
    userInfo: { fn: "os.userName", params: [], result: VOID },
  },
  crypto: {
    randomUUID: { fn: "crypto.randomUUID", params: [], result: STRING },
    // A real Buffer result. The composed randomBytes(n).toString(enc)
    // form KEEPS its one-libCall lowering (lowerCryptoComposedCall runs
    // first and the Buffer never materializes there); this entry covers
    // the bare calls and non-composed uses.
    randomBytes: { fn: "crypto.randomBytes", params: [F64], result: BYTES_U8 },
    randomInt: { fn: "crypto.randomInt", params: [F64, F64], result: F64 },
  },
  zlib: {
    // Buffer in, Buffer out, Node's default options; string inputs fence
    // per site (see the zlib special case in lowerBuiltinModuleCall).
    // cc.ts links libz only when these appear on the IR.
    deflateSync: { fn: "zlib.deflateSync", params: [BYTES_U8], result: BYTES_U8 },
    inflateSync: { fn: "zlib.inflateSync", params: [BYTES_U8], result: BYTES_U8 },
    gzipSync: { fn: "zlib.gzipSync", params: [BYTES_U8], result: BYTES_U8 },
    gunzipSync: { fn: "zlib.gunzipSync", params: [BYTES_U8], result: BYTES_U8 },
    unzipSync: { fn: "zlib.unzipSync", params: [BYTES_U8], result: BYTES_U8 },
    deflateRawSync: { fn: "zlib.deflateRawSync", params: [BYTES_U8], result: BYTES_U8 },
    inflateRawSync: { fn: "zlib.inflateRawSync", params: [BYTES_U8], result: BYTES_U8 },
  },
  url: {
    // fileURLToPath accepts a URL value OR a string — the call lowering
    // picks the libFn by the ARGUMENT's static type (see the special case
    // in lowerBuiltinModuleCall); the table entry carries the string form.
    fileURLToPath: { fn: "url.fileURLToPathStr", params: [STRING], result: STRING },
    pathToFileURL: { fn: "url.pathToFileURL", params: [STRING], result: URL_T },
  },
  child_process: {
    // spawnSync's and spawn's call completions are entirely special-cased
    // (an omitted args list completes to an empty string[]; spawnSync
    // accepts exactly { encoding: "utf8" } as options, spawn requires
    // exactly { stdio: "ignore" } — see lowerBuiltinModuleCall); the
    // entries carry the canonical shapes.
    spawnSync: { fn: "cp.spawnSync", params: [STRING, arrayOf(STRING)], result: SPAWNRES_T },
    spawn: { fn: "cp.spawn", params: [STRING, arrayOf(STRING)], result: CHILD_T },
    // execFileSync(file, args?, options?) and execSync(command, options?)
    // share the cp.execSync runtime entry (execSync sets the shell flag);
    // both call completions are special-cased in lowerBuiltinModuleCall.
    // The entries carry canonical shapes for the coverage/fence machinery.
    execFileSync: { fn: "cp.execSync", params: [STRING, arrayOf(STRING)], result: STRING },
    execSync: { fn: "cp.execSync", params: [STRING], result: STRING },
  },
  // node:util lowers through TWO paths, neither tabled here: promisify
  // only in the const-binding-over-execFile shape — recognized in
  // lowerVarDecl / collectGlobals BEFORE any call lowering runs — and
  // inspect/format/formatWithOptions through the util spoke
  // (lower-inspect.ts: per-type synthesized traversal helpers,
  // compile-time format strings), which both dispatch paths try before
  // the member fence below.
  util: {},
  // node:string_decoder's surface is the StringDecoder CLASS — new/write/
  // end are special-cased (lowerNew + lowerStringDecoderMethodCall); no
  // function members exist to table.
  string_decoder: {},
  // node:querystring — the legacy query-string codec (NOT URLSearchParams;
  // the escaping and '+' rules differ). escape/unescape ride the table
  // path directly; parse and stringify are special-cased in
  // lowerBuiltinModuleCall (parse's result is the call site's mapped
  // ParsedUrlQuery dictionary — the networkInterfaces verification stance
  // — and its sep/eq/options complete there; stringify's object argument
  // crosses as a dyn value). decode/encode are Node's own aliases of
  // parse/stringify (`const decode = parse` in lib/querystring.js) and
  // route to the same special cases; the entries carry canonical shapes.
  querystring: {
    parse: { fn: "qs.parse", params: [STRING], result: VOID },
    decode: { fn: "qs.parse", params: [STRING], result: VOID },
    stringify: { fn: "qs.stringify", params: [DYN], result: STRING },
    encode: { fn: "qs.stringify", params: [DYN], result: STRING },
    escape: { fn: "qs.escape", params: [STRING], result: STRING },
    unescape: { fn: "qs.unescape", params: [STRING], result: STRING },
  },
  // node:readline: createInterface's options are entirely special-cased
  // (exactly { input: process.stdin, output?: process.stdout } — see
  // lowerBuiltinModuleCall); the entry carries the canonical shape. The
  // interface's question/close/on lower through
  // lowerReadlineMethodCall.
  readline: {
    createInterface: { fn: "rl.create", params: [], result: F64 },
  },
  // node:net and node:http lower ENTIRELY through the server spoke
  // (lower-server.ts — every call shape is special-cased: closures, the
  // optional connect host, writeHead's literal headers); the member list
  // is NET_MODULE_FNS there. The modules still need keys here so future
  // table entries have a home, and so the "recognized module, unlowered
  // member" fence wording applies.
  net: {
    // The process-wide happy-eyeballs attempt budget: one runtime double
    // in the core unit (never links scr_net.c by itself), default 250ms
    // like Node's.
    getDefaultAutoSelectFamilyAttemptTimeout: { fn: "net.getAutoSelTimeout", params: [], result: F64 },
    setDefaultAutoSelectFamilyAttemptTimeout: { fn: "net.setAutoSelTimeout", params: [F64], result: VOID },
  },
  http: {},
  // node:tls and node:https ride the same spoke (tls.createServer's
  // options + secureConnection handler, https.createServer, and the
  // https client's rejectUnauthorized/ca options are all special-cased
  // in lower-server.ts).
  tls: {},
  https: {},
  // node:dgram and node:dns lower ENTIRELY through the dgram spoke
  // (lower-dgram.ts — createSocket's option literal, dns.lookup's
  // options + callback, and the Socket method surface are all
  // special-cased); the keys exist for the same reason net/http's do.
  dgram: {},
  dns: {},
  // node:assert lowers ENTIRELY through the assert spoke (lower-assert.ts
  // — every call shape is special-cased: optional messages complete, the
  // comparisons pick per-type libCalls, deep equality synthesizes
  // helpers); the keys exist so unlowered members fence module-qualified
  // with the hints below.
  assert: {},
  "assert/strict": {},
  // node:test lowers ENTIRELY through the test spoke (lower-test.ts —
  // registrations, suites, hooks, the TestContext surface); the key
  // exists so unlowered members fence module-qualified.
  test: {},
  // node:stream/promises lowers through the stream spoke too
  // (lower-stream.ts — finished/pipeline's promise forms special-case
  // their stream arguments exactly like the callback forms); the key
  // exists so unlowered members fence module-qualified.
  "stream/promises": {},
  // node:stream/consumers rides the stream spoke as well (text/json/
  // buffer special-case their stream argument); arrayBuffer and blob
  // fence module-qualified with the pointed hints below — neither value
  // has a representation in a compiled binary.
  "stream/consumers": {},
  // node:timers/promises — the delay-only setTimeout and bare setImmediate
  // (void promises the shared timer heap settles). The arity completion
  // (omitted delay = Node's 1ms) and the value/options fences are
  // special-cased in lowerBuiltinModuleCall; these entries carry the
  // canonical shapes and route the dispatch.
  "timers/promises": {
    setTimeout: { fn: "tp.setTimeout", params: [F64], result: { kind: "promise", inner: VOID } },
    setImmediate: { fn: "tp.setImmediate", params: [], result: { kind: "promise", inner: VOID } },
  },
  // node:diagnostics_channel — the pub/sub core. channel() answers an f64
  // handle (types.ts maps Channel to F64); the subscriber arguments box
  // into the checked-dynamic tree (special-cased in lowerBuiltinModuleCall — the entries
  // carry canonical shapes and route the dispatch). The Channel method
  // surface lowers through lowerDcChannelMethodCall/lowerDcChannelProperty.
  diagnostics_channel: {
    channel: { fn: "dc.channel", params: [STRING], result: F64 },
    subscribe: { fn: "dc.subscribe", params: [STRING, DYN], result: VOID },
    unsubscribe: { fn: "dc.unsubscribe", params: [STRING, DYN], result: BOOL },
    hasSubscribers: { fn: "dc.hasSubscribers", params: [STRING], result: BOOL },
    // The string form's canonical shape; the collection form (an object
    // literal of five Channels) is special-cased in lowerBuiltinModuleCall.
    tracingChannel: { fn: "dc.tracingChannel", params: [STRING], result: F64 },
  },
};

/** Builtin-module CONSTANTS (value reads of named imports): each lowers to
 * a literal of its value's kind. The bare-module values are the TARGET
 * platform's (builtinModuleConstOf swaps the win32 values in under a win32
 * triple — Node's own platform conditionals); the named namespaces answer
 * THEIR platform's constants everywhere. worker_threads/cluster carry the
 * main-thread truths: a compiled binary IS the main thread (no JS-engine
 * thread machinery) and never runs as a cluster worker (cluster forks the
 * node binary itself) — Node's own answers for a directly-run script. */
export const BUILTIN_MODULE_CONSTS: Record<string, Record<string, string | number | boolean | undefined> | undefined> = {
  path: { sep: "/", delimiter: ":" },
  "path/posix": { sep: "/", delimiter: ":" },
  "path/win32": { sep: "\\", delimiter: ";" },
  os: { EOL: "\n" },
  worker_threads: { isMainThread: true, threadId: 0 },
  cluster: { isPrimary: true, isMaster: true, isWorker: false },
};

/** ALTERNATE libCall spellings of tabled builtin members: lowerings the
 * dispatch special-cases around the table row (Buffer/fd/options forms,
 * the JS checked-validation variants) still ARE the member's surface —
 * the sidecar's determinism attestation demotes on them by prefix, so the
 * member's fence detector must witness them too (fencing one spelling
 * fences the operation, the trimLeft/trimStart rule). Keyed like
 * BUILTIN_MODULE_FNS; consumed by the fence taxonomy
 * (library/fence-eval.ts) and the attestation-parity test. */
export const BUILTIN_MODULE_FN_ALIASES: Record<string, Record<string, readonly IrLibFn[] | undefined> | undefined> = {
  fs: {
    // The Buffer form (no encoding), the fd forms (readFileSync(fd[,
    // "utf8"])), and the checked-dynamic encoding form.
    readFileSync: ["fs.readFileSyncBuf", "fs.readFileSyncBytes", "fs.readFileSyncDyn", "fs.readFdSync", "fs.readFdSyncBytes"],
    // The bytes-data form and the { mode } options form.
    writeFileSync: ["fs.writeFileSyncBytes", "fs.writeFileModeSync"],
    // The { recursive, mode } option lowerings.
    mkdirSync: ["fs.mkdirModeSync", "fs.mkdirRecursiveSync", "fs.mkdirRecursiveModeSync"],
    // The { recursive, force } and maxRetries/retryDelay option lowerings.
    rmSync: ["fs.rmOptsSync", "fs.rmRetrySync"],
    // The { withFileTypes: true } Dirent form.
    readdirSync: ["fs.readdirTypesSync"],
    // The JS-source validation-ladder variant (lowerFsLadderCall): the
    // real mkdtemp runs when the options leave utf8 semantics.
    mkdtempSync: ["fs.mkdtempSyncChk"],
    // lchmodSync is chmod's no-follow spelling, JS-ladder only (TypeScript
    // callers fence per site); the ladder runs the REAL lchmod on APPLE,
    // so the chmod fence witnesses it — fencing one spelling fences the
    // operation.
    chmodSync: ["fs.lchmodSyncChk"],
    // The two-argument listener form.
    watch: ["fs.watchCb"],
    // The options-object forms: the SAME file source and sink with a
    // byte range, a flag and a mark on them, so the member fence has to
    // witness them too — fencing createReadStream must fence the option
    // spelling with it. (The attestation-parity case in
    // surface-manifest.test.ts is what says so, and it caught these.)
    createReadStream: ["fs.readStreamOpts"],
    createWriteStream: ["fs.writeStreamOpts"],
  },
  "fs/promises": {
    // The Buffer form (no encoding).
    readFile: ["fsp.readFileBytes"],
  },
  crypto: {
    // The composed randomBytes(n).toString(enc) chain keeps its one-libCall
    // lowering (lowerCryptoComposedCall) — same surface, no Buffer.
    randomBytes: ["crypto.randomBytesToString"],
  },
  os: {
    // lowerOsUserInfoCall assembles the record from scalar libCalls.
    userInfo: [
      "os.userHomedir", "os.userShell", "os.userShellNull", "os.userUid", "os.userGid",
    ],
  },
};

/** Builtin-module members whose table row is a FAITHFUL description of
 * what the member's call lowers to -- one libCall, exactly the row's
 * parameter types, exactly its result, no argument-shape special case
 * anywhere in the dispatch. These are the members that may also be taken
 * as a VALUE (lower-fnvalue.ts's builtinMemberFnValueOf); everything else
 * keeps its SC1090.
 *
 * WHY AN ALLOW-LIST AND NOT A PREDICATE. A value form's body is the row's
 * libCall over the row's parameters, so it is right exactly when the row
 * is the whole truth about the call. For most of BUILTIN_MODULE_FNS it is
 * not: lowerBuiltinModuleCall special-cases fs.readFileSync's encoding,
 * fs.mkdirSync's options object, every zlib member's string input,
 * child_process's four call completions, querystring's parse/stringify,
 * readline.createInterface's option literal, timers/promises' arity
 * completion and diagnostics_channel's whole surface. A value minted from
 * the ROW for any of those would answer the row's libCall where the call
 * form answers a different one -- a silent wrong answer manufactured by
 * the value form, which is strictly worse than the refusal it replaced.
 * Nothing here is inferred; each name was read against the dispatch.
 *
 * WHAT THE SET ACTUALLY BUYS, measured rather than predicted. The set
 * names 49 members. How many of them get a value form depends on the TYPE
 * SURFACE the build reads, because the gate compares against the
 * checker's own mapping: 29 under @types/node 24.13.3, and 47 under this
 * compiler's own fallback .d.ts (whose signatures are narrower --
 * `existsSync(path: string)` rather than `PathLike`). Both numbers are
 * right; a program gets a value exactly where its own types justify one.
 *
 * The reach those 49 cover is bounded, and the bound is worth writing
 * down: over four corpora (zapo's compiled closure, this repo's own
 * accepted corpus, and two node_modules trees) the 99 tabled members are
 * named 1409 times in VALUE position, and 649 of those -- 46% -- are
 * path.join and path.resolve, which no fixed-arity value form can ever be.
 *
 * MEMBERSHIP IS NOT SUFFICIENT. The gate in lower-fnvalue.ts still
 * requires the CHECKER's own mapping of the member's type to equal
 * `funcOf(row.params, row.result)` exactly, the same gate the global
 * table applies for the same reason. That is what keeps a row whose
 * @types/node signature is wider than the row (`fs.existsSync(path:
 * PathLike)`, `os.platform(): NodeJS.Platform`) or has an optional
 * parameter (`crypto.randomUUID(options?)`) from being offered: those
 * would take an ADAPTER, and an adapter is a fresh closure with a
 * different pointer, so `f === existsSync` would answer false where Node
 * answers true. A name in this set that does not pass the gate keeps its
 * SC1090 -- the set widens what MAY be offered, never what is.
 *
 * Deliberately absent, and each for a reason that is not "it is hard":
 *   path.join / path.resolve      variadicPack -- Node's rest parameter,
 *                                 and the func ABI is fixed-arity, so no
 *                                 value form can be the same function
 *   path.basename                 `defaults` completes the omitted suffix;
 *                                 an exact-arity value would refuse the
 *                                 one-argument call Node accepts
 *   every ALIASED member          BUILTIN_MODULE_FN_ALIASES lists the
 *                                 dispatch's other spellings of the same
 *                                 member; more than one spelling means the
 *                                 row is not the whole call */
export const BUILTIN_MEMBER_FN_VALUES: Record<string, ReadonlySet<string> | undefined> = {
  // Every fs entry here is a single libCall over scalar parameters with no
  // arm in lowerBuiltinModuleCall: the option-form members (readFileSync,
  // writeFileSync, mkdirSync, rmSync, readdirSync, accessSync,
  // createReadStream, createWriteStream, watch, chmodSync, mkdtempSync)
  // are all either aliased or special-cased and are absent.
  fs: new Set([
    "appendFileSync", "chownSync", "closeSync", "copyFileSync", "existsSync",
    "lstatSync", "openSync", "readSync", "realpathSync", "rmdirSync",
    "statSync", "unlinkSync",
  ]),
  // fs/promises: readFile (encoding special case + alias), mkdir (options
  // arm) and open (`defaults`) are absent for those reasons.
  "fs/promises": new Set(["chmod", "readdir", "rm", "stat", "unlink", "writeFile"]),
  // The six fixed-arity path members, on all three tables. Each is one
  // libCall over strings; the platform binding (bare `path` IS win32 on a
  // win32 target) is the ROW's job and the value form inherits it, so the
  // same source lowers to the same implementation the call form uses.
  path: new Set(["dirname", "extname", "isAbsolute", "normalize", "relative", "toNamespacedPath"]),
  "path/posix": new Set(["dirname", "extname", "isAbsolute", "normalize", "relative", "toNamespacedPath"]),
  "path/win32": new Set(["dirname", "extname", "isAbsolute", "normalize", "relative", "toNamespacedPath"]),
  // os: networkInterfaces and userInfo are entirely special-cased (their
  // results are the call site's mapped shapes) and are absent.
  os: new Set(["homedir", "platform", "release", "tmpdir", "totalmem", "type"]),
  // crypto.randomBytes is aliased (the composed randomBytes(n).toString(enc)
  // lowering) and is absent.
  crypto: new Set(["randomInt", "randomUUID"]),
  // url.fileURLToPath picks its libFn by the ARGUMENT's static type, so the
  // row is not the whole call; pathToFileURL is.
  url: new Set(["pathToFileURL"]),
  // querystring: parse/decode/stringify/encode are special-cased; the
  // escaping pair rides the generic table tail.
  querystring: new Set(["escape", "unescape"]),
  // The process-wide happy-eyeballs budget: two plain libCalls.
  net: new Set([
    "getDefaultAutoSelectFamilyAttemptTimeout",
    "setDefaultAutoSelectFamilyAttemptTimeout",
  ]),
};

/** Ambient surfaces lowered through DEDICATED code paths (no lowering-table
 * row): the Date compositions, perf_hooks' performance.now, and the process
 * global's ambient reads and authority calls. These are the determinism
 * attestation's ground (ir/nodes.ts's LIB_NONDETERMINISTIC_PREFIXES), so
 * each row projects one surface-manifest entry — a permanent, fenceable id
 * — and carries the libCall spellings that witness the surface's reach in
 * a compiled graph (the fence detector and the attestation must agree; the
 * parity test in tests/harness/surface-manifest.test.ts holds them to it). */
export interface AmbientSurfaceRow {
  /** The manifest entry id (stable diff key — permanent API). */
  id: string;
  kind: "stdlib" | "node-builtin";
  /** Human-readable surface name (the manifest's `name`). */
  name: string;
  /** The IrLibFn spellings whose reach witnesses the surface. */
  fns: readonly IrLibFn[];
  note?: string;
}

export const AMBIENT_SURFACE_FNS: readonly AmbientSurfaceRow[] = [
  // ── the Date slice (lowerDateCall): Date.now/Date.UTC and the composed
  // new Date(...).getTime()/.toISOString() forms — the worked-example
  // "stdlib.date." family of the ask-5 spec.
  {
    id: "stdlib.date.now",
    kind: "stdlib",
    name: "Date.now",
    fns: ["date.now"],
    note: "the live clock; the zero-argument new Date() compositions read it too",
  },
  {
    id: "stdlib.date.UTC",
    kind: "stdlib",
    name: "Date.UTC",
    fns: ["date.utc"],
    note: "the lowered call form takes 1 to 7 number arguments",
  },
  {
    id: "stdlib.date.getTime",
    kind: "stdlib",
    name: "Date.prototype.getTime",
    fns: ["date.parseGetTime"],
    note: "the composed new Date(dateString).getTime() form; new Date().getTime() is stdlib.date.now's surface",
  },
  {
    id: "stdlib.date.toISOString",
    kind: "stdlib",
    name: "Date.prototype.toISOString",
    fns: ["date.toISOString"],
    note: "the composed new Date(ms?).toISOString() form",
  },
  // ── crypto.randomFill (lowerCryptoModuleCall's dedicated arm): the only
  // CSPRNG member with no lowering-table row, because the fill writes into
  // a caller-owned buffer and hands control to a deferred callback rather
  // than returning a value. Its own id, not an alias of randomBytes: a
  // profile that permits randomBytes has said nothing about randomFill,
  // and folding them would let one declaration open both.
  {
    id: "node-builtin.crypto.randomFill",
    kind: "node-builtin",
    name: "crypto.randomFill",
    fns: ["crypto.randomFillDeferred"],
    note: "the CSPRNG fill of a caller-owned buffer; the callback form is the only spelling that lowers",
  },
  // ── perf_hooks (lowerPerfHooksCall): the monotonic clock.
  {
    id: "node-builtin.perf_hooks.performance.now",
    kind: "node-builtin",
    name: "perf_hooks.performance.now",
    fns: ["perf.now"],
    note: "the global performance object and the performance.now.bind(performance) function value reach the same clock",
  },
  // ── the process global's ambient reads and authority calls
  // (lowerProcessProperty/lowerProcessMethodCall — process is a
  // provenance-checked global here, not an importable module).
  {
    id: "node-builtin.process.env",
    kind: "node-builtin",
    name: "process.env",
    fns: ["process.envGet", "process.envSet", "process.envUnset", "process.envPairs"],
    note: "reads, writes, deletes, and enumeration of the process environment (the process global)",
  },
  { id: "node-builtin.process.argv", kind: "node-builtin", name: "process.argv", fns: ["process.argv"] },
  { id: "node-builtin.process.cwd", kind: "node-builtin", name: "process.cwd", fns: ["process.cwd"] },
  { id: "node-builtin.process.chdir", kind: "node-builtin", name: "process.chdir", fns: ["process.chdir"] },
  { id: "node-builtin.process.pid", kind: "node-builtin", name: "process.pid", fns: ["process.pid"] },
  { id: "node-builtin.process.getuid", kind: "node-builtin", name: "process.getuid", fns: ["process.getuid"] },
  { id: "node-builtin.process.getgid", kind: "node-builtin", name: "process.getgid", fns: ["process.getgid"] },
  { id: "node-builtin.process.execPath", kind: "node-builtin", name: "process.execPath", fns: ["process.execPath"] },
  { id: "node-builtin.process.uptime", kind: "node-builtin", name: "process.uptime", fns: ["process.uptime"] },
  {
    id: "node-builtin.process.memoryUsage.rss",
    kind: "node-builtin",
    name: "process.memoryUsage.rss",
    fns: ["process.rss"],
    note: "the single-value form only — the memoryUsage() RECORD is refused by name (four of its five fields are V8 heap statistics)",
  },
  {
    id: "node-builtin.process.availableMemory",
    kind: "node-builtin",
    name: "process.availableMemory",
    fns: ["process.availableMemory"],
  },
  {
    id: "node-builtin.process.constrainedMemory",
    kind: "node-builtin",
    name: "process.constrainedMemory",
    fns: ["process.constrainedMemory"],
  },
  {
    id: "node-builtin.process.resourceUsage",
    kind: "node-builtin",
    name: "process.resourceUsage",
    fns: ["process.rusage"],
    note: "getrusage's 16 fields — every field read samples live machine state",
  },
  {
    id: "node-builtin.process.cpuUsage",
    kind: "node-builtin",
    name: "process.cpuUsage",
    fns: ["process.cpuUser", "process.cpuSystem", "process.cpuUserDiff", "process.cpuSystemDiff", "process.cpuPrevValidate"],
    note: "the plain-sample and previous-value diff forms are one surface",
  },
  {
    id: "node-builtin.process.threadCpuUsage",
    kind: "node-builtin",
    name: "process.threadCpuUsage",
    fns: ["process.threadCpuUser", "process.threadCpuSystem", "process.threadCpuUserDiff", "process.threadCpuSystemDiff"],
    note: "the plain-sample and previous-value diff forms are one surface",
  },
  {
    id: "node-builtin.process.isTTY",
    kind: "node-builtin",
    name: "process.isTTY",
    fns: ["process.isTTY"],
    note: "the isTTY read on process.stdin/stdout/stderr — one surface across the three streams",
  },
  {
    id: "node-builtin.process.columns",
    kind: "node-builtin",
    name: "process.columns",
    fns: ["process.columns"],
    note: "the columns read on the process stdio streams (terminal geometry)",
  },
  {
    id: "node-builtin.process.kill",
    kind: "node-builtin",
    name: "process.kill",
    fns: ["process.kill", "process.killNum"],
    note: "the signal-name and signal-number forms are one surface",
  },
  { id: "node-builtin.process.umask", kind: "node-builtin", name: "process.umask", fns: ["process.umask"] },
  {
    id: "node-builtin.process.exit",
    kind: "node-builtin",
    name: "process.exit",
    fns: ["process.exit", "process.exiting"],
    note: "process.exit and the process._exiting flag read are one surface",
  },
  // ── the tls CA store (lowerTlsCaCall / lowerTlsRootCertificates): the
  // host's trust anchors, read and replaced. Dedicated paths, and
  // rootCertificates is a VALUE read with no call form at all, so none of
  // the three can hang off a lowering-table row. Split three ways rather
  // than folded into one "CA store" surface: a library author who denies
  // REPLACING the trust anchors is making a different decision from one
  // who denies reading them, and each Node spelling is the name they will
  // reach for when writing the fence.
  {
    id: "node-builtin.tls.getCACertificates",
    kind: "node-builtin",
    name: "tls.getCACertificates",
    fns: ["tlsca.get"],
    note: "the per-type cached PEM bundle: 'default' and 'extra' additionally read NODE_EXTRA_CA_CERTS, 'system' the platform store",
  },
  {
    id: "node-builtin.tls.rootCertificates",
    kind: "node-builtin",
    name: "tls.rootCertificates",
    fns: ["tlsca.root"],
    note: "the value read; answers the same bundled array as getCACertificates('bundled'), but fenced under its own id — the spelling an author writes",
  },
  {
    id: "node-builtin.tls.setDefaultCACertificates",
    kind: "node-builtin",
    name: "tls.setDefaultCACertificates",
    fns: ["tlsca.set"],
    note: "replaces the default set and the client trust anchors for the rest of the process",
  },
];

/** The win32-target overrides of the bare modules' constants: path's
 * constants ARE the path/win32 namespace's, and os.EOL is CRLF (Node's
 * `isWindows ? '\r\n' : '\n'`). */
const WIN32_TARGET_CONSTS: Record<string, Record<string, string | number | boolean | undefined> | undefined> = {
  path: BUILTIN_MODULE_CONSTS["path/win32"],
  os: { EOL: "\r\n" },
};

/** url's win32-target table: fileURLToPath is receiver-form-special-cased
 * either way, and pathToFileURL swaps to its win32 IR flavor (the same
 * runtime call, but in the may-throw seed — Node's win32 arm raises UNC
 * TypeErrors where the posix arm never throws). */
const URL_WIN32_MODULE_FNS: Record<string, BuiltinModuleFn | undefined> = {
  fileURLToPath: { fn: "url.fileURLToPathStr", params: [STRING], result: STRING },
  pathToFileURL: { fn: "url.pathToFileURLWin32", params: [STRING], result: URL_T },
};

/** BUILTIN_MODULE_FNS with the platform-conditional modules bound per
 * TARGET: a win32 triple compiles Node-on-Windows semantics — `path` is
 * path.win32 and url's bridge takes the win32 flavors. Fence wording is
 * unaffected — callers keep naming the module the source spelled. */
export function builtinModuleFnsOf(L: Lowerer, module: string): Record<string, BuiltinModuleFn | undefined> | undefined {
  if (L.targetPlatform === "win32") {
    if (module === "path") return BUILTIN_MODULE_FNS["path/win32"];
    if (module === "url") return URL_WIN32_MODULE_FNS;
  }
  return ownEntry(BUILTIN_MODULE_FNS, module);
}

/** Own-property lookup — lowerer.ts's own(), duplicated locally because
 * lowerer.ts already imports surfaces.ts (a value import back would
 * cycle). The tables here are plain object literals keyed by USER-written
 * module/member names, so a bare index would also find Object.prototype
 * members ("toString", "constructor", "__proto__"). */
function ownEntry<T>(table: Record<string, T | undefined>, key: string): T | undefined {
  return Object.hasOwn(table, key) ? table[key] : undefined;
}

/** One MEMBER's table entry, own-property-safe (`path.toString` must not
 * answer Object.prototype.toString as a BuiltinModuleFn). */
export function builtinModuleFnOf(L: Lowerer, module: string, member: string): BuiltinModuleFn | undefined {
  const mod = builtinModuleFnsOf(L, module);
  return mod ? ownEntry(mod, member) : undefined;
}

/** Is this member allowed to have a VALUE form? Own-property-safe for the
 * same reason builtinModuleFnOf is: a member named `toString` must not
 * answer Object.prototype's. Membership only says the row is a faithful
 * description of the call -- lower-fnvalue.ts's gate still has to agree
 * with the checker before anything is minted. */
export function builtinMemberFnValueAllowed(module: string, member: string): boolean {
  const set = ownEntry(BUILTIN_MEMBER_FN_VALUES, module);
  return set !== undefined && set.has(member);
}

/** One member's fence hint, own-property-safe (a collision would print an
 * inherited function into the diagnostic text). */
export function builtinFenceHintOf(module: string, member: string): string | undefined {
  const mod = ownEntry(BUILTIN_MODULE_FENCE_HINTS, module);
  return mod ? ownEntry(mod, member) : undefined;
}

/** BUILTIN_MODULE_CONSTS with the win32-target overrides applied — the
 * constants twin of builtinModuleFnsOf. */
export function builtinModuleConstOf(L: Lowerer, module: string, member: string): string | number | boolean | undefined {
  if (L.targetPlatform === "win32") {
    const mod = ownEntry(WIN32_TARGET_CONSTS, module);
    const w = mod ? ownEntry(mod, member) : undefined;
    if (w !== undefined) return w;
  }
  const mod = ownEntry(BUILTIN_MODULE_CONSTS, module);
  return mod ? ownEntry(mod, member) : undefined;
}

/** The IR literal of a builtin-module constant — one place so both value
 * paths (named-import bindings and namespace member reads) emit the same
 * kinds. */
export function builtinConstLit(value: string | number | boolean, loc: { file: string; start: number; end: number }): IrExpr {
  if (typeof value === "string") return { kind: "strLit", value, type: STRING, loc };
  if (typeof value === "number") return { kind: "numLit", value, type: F64, loc };
  return { kind: "boolLit", value, type: BOOL, loc };
}

/** node:module's builtinModules, BAKED — Node v24's exact list (verbatim
 * order: the bare names, then the node:-prefix-only tails), pinned to
 * the compat target rather than read from the COMPILING host's Node so
 * emitted programs are host-independent (the cache-identity contract).
 * Node ships one frozen singleton; each read here mints a fresh string
 * array — a divergence only mutation could observe, and mutating Node's
 * frozen array throws anyway. */
export const NODE_BUILTIN_MODULES_V24: readonly string[] = [
  "_http_agent", "_http_client", "_http_common", "_http_incoming",
  "_http_outgoing", "_http_server", "_stream_duplex", "_stream_passthrough",
  "_stream_readable", "_stream_transform", "_stream_wrap", "_stream_writable",
  "_tls_common", "_tls_wrap", "assert", "assert/strict", "async_hooks",
  "buffer", "child_process", "cluster", "console", "constants", "crypto",
  "dgram", "diagnostics_channel", "dns", "dns/promises", "domain", "events",
  "fs", "fs/promises", "http", "http2", "https", "inspector",
  "inspector/promises", "module", "net", "os", "path", "path/posix",
  "path/win32", "perf_hooks", "process", "punycode", "querystring",
  "readline", "readline/promises", "repl", "stream", "stream/consumers",
  "stream/promises", "stream/web", "string_decoder", "sys", "timers",
  "timers/promises", "tls", "trace_events", "tty", "url", "util",
  "util/types", "v8", "vm", "wasi", "worker_threads", "zlib",
  "node:sea", "node:sqlite", "node:test", "node:test/reporters",
];

/** The array-literal read of module.builtinModules — both value paths
 * (the named-import binding and the namespace member read) mint the
 * same fresh string[]. */
export function builtinModulesArrayLit(loc: { file: string; start: number; end: number }): IrExpr {
  return {
    kind: "arrayLit",
    elems: NODE_BUILTIN_MODULES_V24.map(
      (m): IrExpr => ({ kind: "strLit", value: m, type: STRING, loc }),
    ),
    type: arrayOf(STRING),
    loc,
  };
}

/** Member-specific hints for RECOGNIZED builtin modules whose member has
 * no lowering. deflateSync/inflateSync lower now (Buffers are real);
 * the rest of the zlib surface points at the lowered pair. */
export const ZLIB_HINT =
  "deflateSync/inflateSync and the gzip twins (gzipSync, gunzipSync, unzipSync) are the lowered zlib surface";

/** The loose-equality quartet's shared hint: == coercion has no lowering
 * anywhere in this compiler, and Node itself points at the strict forms. */
const ASSERT_LOOSE_HINT =
  "loose == equality has no lowering — the strict forms compare with " +
  "Object.is/structural equality like Node's assert/strict module, where " +
  "equal IS strictEqual";

const ASSERT_MODULE_HINTS: Record<string, string | undefined> = {
  equal: ASSERT_LOOSE_HINT,
  notEqual: ASSERT_LOOSE_HINT,
  deepEqual: ASSERT_LOOSE_HINT,
  notDeepEqual: ASSERT_LOOSE_HINT,
  ifError:
    "test explicitly instead: assert.strictEqual(err, null) / " +
    "assert.strictEqual(err, undefined)",
  rejects:
    "await the promise inside assert.throws's callback story instead: " +
    "try { await p; assert.fail(\"expected rejection\") } catch { ... }",
  doesNotReject: "await the promise directly — an unexpected rejection already fails the test",
  doesNotThrow: "call the function directly — an unexpected throw already fails the test",
  AssertionError:
    "the class itself has no lowering — catch and test err.name === " +
    '"AssertionError" or err.code === "ERR_ASSERTION"',
};

export const BUILTIN_MODULE_FENCE_HINTS: Record<string, Record<string, string | undefined> | undefined> = {
  assert: ASSERT_MODULE_HINTS,
  // The strict module's equal/notEqual/deepEqual/notDeepEqual ARE the
  // strict comparisons (aliased in the spoke) — only the members with no
  // lowering in either module fence here.
  "assert/strict": {
    ifError: ASSERT_MODULE_HINTS["ifError"],
    rejects: ASSERT_MODULE_HINTS["rejects"],
    doesNotReject: ASSERT_MODULE_HINTS["doesNotReject"],
    doesNotThrow: ASSERT_MODULE_HINTS["doesNotThrow"],
    AssertionError: ASSERT_MODULE_HINTS["AssertionError"],
  },
  util: {
    promisify:
      "the one lowered shape is a const binding over child_process.execFile: " +
      "const execFileAsync = promisify(execFile), then call execFileAsync directly",
    // child_process.execFile itself exists to be promisified — the same
    // story from the other end.
  },
  "stream/consumers": {
    arrayBuffer:
      "no free-standing ArrayBuffer value exists here (typed arrays own their storage) — " +
      "buffer(stream) collects the same bytes as a Buffer",
    blob:
      "Blob values have no representation in a compiled binary — " +
      "buffer(stream) collects the same bytes as a Buffer, text(stream) the decoded text",
  },
  module: {
    createRequire:
      "the lowered shape is a const binding over createRequire(import.meta.url) (or __filename) " +
      "whose require calls take STATIC string literals — builtins, relative .json documents, " +
      "and installed npm packages (under --dynamic) resolve at build time; " +
      "dynamic specifiers cannot exist in a compiled binary's fixed module graph",
    isBuiltin:
      "builtinModules.includes(name) answers the same question over the baked list " +
      "(strip a node: prefix first; the prefix-only builtins appear with it, as node:test)",
    syncBuiltinESMExports:
      "a compiled program has no live builtin ESM namespace bindings to synchronize — " +
      "nothing a compiled surface can mutate makes the call observable; remove it",
  },
  child_process: {
    // fork() is not a missing FUNCTION, it is the entry point to an IPC
    // CHANNEL, and naming it that way is the point: `send`,
    // `on("message")`, `removeListener` and `disconnect` are the same
    // subsystem, and a build that lowered `send` without a working
    // `on("message")` would deadlock every request/response program that
    // uses it — strictly worse than refusing the pair.
    //
    // What the channel needs, so the size is on the record rather than
    // rediscovered: a libuv-compatible IPC pipe handed to a REAL Node
    // child (a named pipe plus the NODE_CHANNEL_FD handshake on Windows,
    // an inherited fd on POSIX — the child speaks the protocol only if
    // the channel is created exactly the way libuv creates it); the wire
    // framing for BOTH serialization modes, where 'advanced' is V8's
    // versioned ValueSerializer format and not JSON; an emitter-shaped
    // 'message' event wired into the event loop; and send() backpressure.
    // Each of those is a place where a near-miss is a silent wrong answer
    // rather than a failure.
    fork:
      "fork() opens a Node IPC channel, which has no lowering — and neither do its " +
      "other halves (ChildProcess.send, on(\"message\"), removeListener, disconnect), " +
      "because they are one subsystem: a channel that could send but not receive would " +
      "deadlock rather than fail. The lowered process surface is spawn, spawnSync, " +
      "execSync/execFileSync and promisify(execFile) — a child that talks over its " +
      "STDIO, or over a socket the parent also opens, compiles today",
    execFile:
      "the callback form has no lowering — promisify it: " +
      "const execFileAsync = promisify(execFile) (from node:util), or use execFileSync",
  },
  crypto: {
    createHash:
      "the lowered algorithms are sha256, sha512, sha1 and md5 — every other name " +
      "has no lowering; the handle itself is an ordinary value (update/digest are its lowered members)",
    hash:
      "the one-shot digest has no lowering — the composed chain " +
      'createHash("sha256").update(data).digest("hex") is the lowered hashing surface',
    createHmac:
      "the lowered algorithms are sha256, sha512, sha1 and md5, keyed by a string or a Buffer — " +
      "a KeyObject key needs the secret-key surface, which has no lowering",
    ...Object.fromEntries(
      [
        "generateKeyPair", "generateKeyPairSync", "generateKey", "generateKeySync",
        "createPrivateKey", "createPublicKey",
        "createSign", "createVerify", "sign", "verify",
        "createDiffieHellman", "createDiffieHellmanGroup", "getDiffieHellman",
        "createECDH", "diffieHellman",
        "publicEncrypt", "publicDecrypt", "privateEncrypt", "privateDecrypt",
      ].map((m) => [
        m,
        "asymmetric-key operations need a public-key stack (bignum, RSA/EC/EdDSA math) and a " +
          "KeyObject value model — neither exists in the static runtime, so no faithful lowering " +
          "can be small; the lowered crypto surface is hashing, randomness, and the introspection statics",
      ]),
    ),
    ...Object.fromEntries(
      ["getCipherInfo"].map((m) => [
        m,
        "the cipher introspection record has no lowering — the ciphers themselves do: " +
          "aes-256-gcm, aes-256-cbc and aes-256-ctr through createCipheriv/createDecipheriv",
      ]),
    ),
    ...Object.fromEntries(
      // hkdfSync came out of this list when its sha256 form landed; the
      // CALLBACK form (hkdf) stays, and so does scrypt.
      ["scrypt", "scryptSync", "hkdf"].map((m) => [
        m,
        "this key-derivation function has no lowering yet — PBKDF2 and HKDF with sha256 are the " +
          "derived surfaces (hkdfSync, not the callback form), alongside hashing, randomness, " +
          "and the introspection statics",
      ]),
    ),
    setFips:
      "a compiled binary has no FIPS provider to enable, and Node itself throws on setFips(true) " +
      "in a non-FIPS build — getFips() answers 0 here",
    webcrypto:
      "the WebCrypto object has no lowering — the lowered crypto surface is randomUUID, " +
      "randomBytes, and the createHash chain",
  },
  zlib: {
    brotliCompressSync: ZLIB_HINT,
    brotliDecompressSync: ZLIB_HINT,
  },
  http2: {
    connect:
      "HTTP/2 client sessions have no lowering — the lowered http2 surface is the SERVER side: " +
      "createSecureServer({ allowHTTP1: true, cert, key }), which serves HTTP/1.1 only " +
      "(ALPN never offers h2 — h2-capable clients negotiate down); an HTTP/1.1 client is https.request",
    createServer:
      "cleartext (h2c) servers have no lowering — the lowered http2 surface is " +
      "createSecureServer({ allowHTTP1: true, cert, key }), which serves HTTP/1.1 over TLS " +
      "(plain HTTP/1.1 is http.createServer)",
  },
  tls: {
    createSecureContext:
      "the lowered form is createSecureContext({ cert, key }) — an opaque SecureContext handle " +
      "for SNI callbacks (http2.createSecureServer accepts SNICallback); other options fence by name",
    connect:
      "the lowered TLS client is https.request({ hostname, port, path, method, ca?, rejectUnauthorized? }); " +
      "raw tls.connect sockets have no lowering yet",
  },
};

/** The MEMBER chokepoint of the lib fence: called from the property-read
   * and method-call fallbacks after every lowering has passed. When the
   * accessed member is stdlib-declared, the use is standard-library surface
   * with no lowering — report SC2020 naming `<container>.<member>` (the
   * receiver's global name when it IS a stdlib global like Math or Promise,
   * its widened type text otherwise). Returns silently for non-stdlib
   * members so the caller's generic rejection applies. */
  export function stdlibMemberFence(L: Lowerer, access: ts.PropertyAccessExpression): void {
    const sym = L.checker.getSymbolAtLocation(access.name);
    if (!sym || !L.isStdlibSymbol(sym)) return;
    const member = access.name.text;
    const recv = access.expression;
    // A CHECKED-DYNAMIC receiver whose checker type is a concrete stdlib
    // class mapped to dyn (the http Agent handle): its members dispatch
    // at runtime through the dyn/handle machinery — the keyed-read claim
    // below this fence answers, member-or-refusal ladder, so no compile
    // fence belongs here.
    if (L.mapTypeOf(L.typeOf(recv))?.kind === "dyn") return;
    // Name the container the way the source reads: the global's name when
    // the receiver IS a stdlib global (Math, process), the dotted path for
    // a member of one (process.stdout — its TYPE text would be the useless
    // 'WriteStream & { fd: 1; }'), the receiver's widened type text
    // otherwise.
    const globalPathOf = (e: ts.Expression): string | null => {
      if (ts.isIdentifier(e) && L.isStdlibSymbol(L.checker.getSymbolAtLocation(e))) {
        return e.text;
      }
      if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression)) {
        const base = globalPathOf(e.expression);
        if (base !== null) return `${base}.${e.name.text}`;
      }
      return null;
    };
    const container =
      globalPathOf(recv) ??
      L.checker.typeToString(L.checker.getBaseTypeOfLiteralType(L.typeOf(recv)));
    let hint: string | undefined;
    const recvIr = L.mapTypeOf(L.typeOf(recv));
    if (recvIr?.kind === "promise" && (member === "then" || member === "catch" || member === "finally")) {
      hint =
        "'await' is the supported way to chain (p.then(f) with one fulfillment handler, p.catch " +
        "with an INLINE handler, and p.finally(cb) compile) — try { await p } catch (e) is the general form";
    } else if (recvIr?.kind === "f64" && member === "toString") {
      hint = "radix-free conversion is a template literal away: `${x}`; toString(radix) runs under --dynamic";
    } else if (container === "Math" && (member === "min" || member === "max")) {
      hint =
        `Math.${member} lowers with any number of plain arguments or ONE number[] spread — ` +
        `mixed spread/positional lists don't: spread a single array (Math.${member}(...xs))`;
    } else if (
      recvIr?.kind === "array" &&
      member === "index" &&
      (container === "RegExpExecArray" || container === "RegExpMatchArray")
    ) {
      hint =
        "'.index' is supported on the const binding of a for-of over a DIRECT matchAll call " +
        "(for (const m of s.matchAll(re)) { ... m.index ... }); stored rows are honest " +
        "string[] slices without it";
    } else if (
      recvIr?.kind === "array" &&
      member === "groups" &&
      (container === "RegExpExecArray" || container === "RegExpMatchArray")
    ) {
      hint =
        "'.groups' lowers when the match's regex is STATICALLY known — a regex literal, or a " +
        "const initialized with one (the group-name table is built at compile time) — and the " +
        "read is not an optional-chain step: narrow the match instead (if (m) { m.groups } or " +
        "m!.groups)";
    } else if (recvIr?.kind === "array" && member === "flat") {
      hint =
        "flat has no lowering (flatMap does) — flatten into an accumulator instead: " +
        "for (const x of xs) for (const y of x) out.push(y)";
    // NO `.stack` ARM ANY MORE, and its absence is deliberate rather than an
    // oversight. The read LOWERS (lowerErrorCodeProperty's `.stack` arm: the
    // header line a zero-frame capture produces, which is what node itself
    // answers under `Error.stackTraceLimit = 0`), on every Error-rooted
    // receiver including %DOMException, so this branch could only fire where
    // the read did NOT lower — and no program was found that reaches it:
    // a write takes SC1090 at the assignment ("assignment to non-variables"),
    // an optional chain lowers, and a non-stdlib `stack` field is an ordinary
    // field. Dead machinery that prints a sentence about a capability the
    // compiler now has is worse than no hint at all.
    } else if (container === "process.stdin" || (container === "process" && member === "stdin")) {
      hint =
        "isTTY, destroy(), on/once of the data/end/error events, and " +
        "`for await (const chunk of process.stdin)` are the supported stdin surface " +
        '(or read everything at once: readFileSync(0, "utf8") from node:fs)';
    } else if (
      (container === "process" && (member === "stdout" || member === "stderr")) ||
      container === "process.stdout" ||
      container === "process.stderr"
    ) {
      // @types/node territory: the fallback declarations don't have these
      // members at all (a type error), so this fence only fires with the
      // project's real Node types adopted.
      hint =
        "console.log is the supported way to write a line to stdout; " +
        "the stdout/stderr stream objects have no lowering";
    } else if (container === "console") {
      hint =
        "console.log/info/debug (stdout) and console.error/warn (stderr) are the supported " +
        "console surface (arguments render with Node's console semantics: strings verbatim, " +
        "everything else through the static util.inspect)";
    } else if (member === "prototype") {
      hint =
        "prototype objects are not values here (method lookup is static) — call the method on an instance instead";
    } else if (
      recvIr?.kind === "func" &&
      (member === "call" || member === "apply" || member === "bind")
    ) {
      hint =
        "call the function directly — plain and arrow functions here never read `this`, so " +
        "f.call(thisArg, ...args) is f(...args), and bind's partial application is an arrow: (...rest) => f(a, ...rest)";
    } else if (
      recvIr?.kind === "string" &&
      (member === "match" || member === "matchAll" || member === "search")
    ) {
      hint =
        "the regex-LITERAL argument forms lower (s.match(/re/)); a string pattern constructs " +
        "a RegExp at runtime, which has no lowering";
    } else if (container === "ArrayBuffer" || container.startsWith("ArrayBuffer<")) {
      hint =
        "resize/transfer/maxByteLength need the buffer to exist as a runtime value, and no " +
        "free-standing ArrayBuffer value does — typed arrays own fixed-length storage " +
        "(new Uint8Array(n)); allocate a new view and copy instead";
    } else if (container === "SharedArrayBuffer" || container.startsWith("SharedArrayBuffer<")) {
      hint =
        "no shared-memory threads exist in a compiled program — Uint8Array is the byte storage " +
        "(a fixed-length allocation: grow has nothing to share it with)";
    } else if (
      container === "Intl" || container.startsWith("Intl.") ||
      ["NumberFormat", "DateTimeFormat", "DurationFormat", "PluralRules", "Collator", "Locale",
        "RelativeTimeFormat", "ListFormat", "Segmenter", "DisplayNames"].includes(container) ||
      member === "toLocaleString" || member === "toLocaleDateString" ||
      member === "toLocaleTimeString" || member === "toLocaleLowerCase" ||
      member === "toLocaleUpperCase"
    ) {
      hint =
        "locale- and ICU-backed behavior lives outside the static runtime (the localeCompare " +
        "stance: code-unit order, no collation/locale data) — what lowers: the composed " +
        'new Intl.NumberFormat("en-US").format(x) and x.toLocaleString("en-US") with default ' +
        "options; format with template literals, toFixed, and toString otherwise";
    } else if (container === "Object" && member === "assign") {
      hint =
        "spread instead: { ...a, ...b } builds the merged record; what lowers: the empty-target " +
        "literal-source shape (Object.assign({}, { ... }) IS the source literal) and merges INTO " +
        "an index-signature record whose value slot every source value enters — " +
        "other aliased targets are real mutation, and a function target (Object.assign(fn, { prop })) " +
        "is a function-with-properties value the model cannot represent: bind the property separately";
    } else if (container === "Object" && member === "defineProperty") {
      hint = definePropertyHint(L, access);
    }
    L.noLowering(`${container}.${member}`, access, hint, sym);
  }

/** Why THIS `Object.defineProperty` did not lower.
   *
   * There IS a defineProperty lowering (lower-calls.ts's hidden symbol
   * slot), so the bare "no lowering yet" line is the one fence in this
   * family that reads as a whole missing feature when it is a shape miss —
   * and it hides which argument is the miss. Measured on protobufjs's
   * static-module output: 44 of the 45 refusals in the QR-path closure are
   * `Object.defineProperty(<function-constructor>.prototype, "_field",
   * { get: util.oneOfGetter(...), set: util.oneOfSetter(...) })`, the oneof
   * accessors. Replacing those 44 calls with a bare read of the SAME
   * receiver leaves the total trap count unchanged and moves all 44 onto
   * the `.prototype` fence one for one: the receiver refuses before the
   * descriptor is even looked at, so a descriptor-side lowering would
   * uncover the receiver at the same statement and buy nothing. Say which
   * one refuses, so a reader budgets the right work.
   *
   * Text only — the diagnostic code, the site and the count are unchanged. */
  function definePropertyHint(L: Lowerer, access: ts.PropertyAccessExpression): string | undefined {
    const LOWERED_SHAPE =
      "what lowers is a hidden per-instance DATA slot: Object.defineProperty(<a bare " +
      "identifier typed as a program class>, <a module-level `const k = Symbol('...')`>, " +
      "{ value, enumerable: false, configurable: false, writable: false })";
    const call = access.parent;
    if (!ts.isCallExpression(call) || call.expression !== access || call.arguments.length !== 3) {
      // `Object.defineProperty` as a VALUE, or at another arity: the
      // shape question does not arise.
      return undefined;
    }
    const recv = call.arguments[0]!;
    if (ts.isPropertyAccessExpression(recv) && recv.name.text === "prototype") {
      return (
        "the RECEIVER is a prototype object, and prototype objects are not values here " +
        "(method lookup is static) — there is no object for the property to live on, so this " +
        "refuses at the receiver whatever the descriptor says; " + LOWERED_SHAPE
      );
    }
    // A STATIC receiver is the same refusal one argument wider, and it has
    // to be said BEFORE the descriptor is looked at or the hint blames the
    // wrong argument. zapo's one surviving site is exactly this shape:
    //
    //     Object.defineProperty(client, exposeAs, {   // exposeAs: string
    //       get: () => registry.instances.get(exposeAs),
    //       enumerable: true, configurable: false })
    //
    // (src/client/plugins/install.ts:114). Its descriptor IS an accessor,
    // so the branch below used to answer "the DESCRIPTOR is an accessor"
    // and a reader would budget accessor work -- but the dyn accessor half
    // already ships (2 925 of zapo's 2 927 defineProperty sites lower
    // through it) and none of it can reach this call: a compiled class
    // instance is a C struct with one field per DECLARED member and no key
    // table, so a property named by a run-time string has nowhere to live.
    // Same shape as the `.prototype` branch above, and the same lesson
    // estado-accessor.md paid for once already.
    const recvIr = L.mapTypeOf(L.typeOf(recv));
    // An INDEX-SIGNATURE record is the one static receiver that DOES carry
    // a run-time key table (the overflow map), so its wall is the
    // descriptor, not the receiver: what it cannot carry is per-key
    // ATTRIBUTES. Say so rather than sweeping it in below.
    const overflowKeys =
      recvIr?.kind === "record" && L.shapes.get(recvIr.shapeId)?.indexValue !== undefined;
    // A CLASS receiver is no longer the receiver's wall. A compiled
    // instance carries a per-instance property table for exactly the
    // classes some `Object.defineProperty(<an instance>, <a string key>,
    // ...)` site in the program names, so zapo's install.ts:114 lowers \u2014
    // and a site that still refuses is refusing at one of the
    // recognizer's CLAUSES, not at the receiver. Naming the clause is the
    // whole job of this hint: telling a reader "no key table" when there
    // is one would budget the wrong work again, which is the mistake
    // estado-accessor.md paid for from the other side.
    if (recvIr?.kind === "object") {
      const why = definePropTableDecline(L, call);
      return (
        `the RECEIVER is a compiled '${recvIr.className}' instance, and a property named by a ` +
        "RUN-TIME string DOES have somewhere to live on one \u2014 the per-instance property table. " +
        "What refuses here is the SHAPE: " + why + ". What lowers is " +
        "Object.defineProperty(<an expression typed as a program class with no subclass>, " +
        "<a STRING-typed key>, <an OBJECT LITERAL descriptor whose get/set halves are ARROW " +
        "functions>) in STATEMENT position; the symbol-keyed form beside it is a hidden " +
        "per-instance DATA slot: Object.defineProperty(<a bare identifier typed as a program " +
        "class>, <a module-level `const k = Symbol('...')`>, { value, enumerable: false, " +
        "configurable: false, writable: false })"
      );
    }
    if (recvIr != null && !overflowKeys && recvIr.kind !== "dyn" && recvIr.kind !== "func") {
      const what =
        recvIr.kind === "record"
          ? "a record of a fixed shape"
          : `a '${recvIr.kind}' value`;
      return (
        "the RECEIVER is " + what + ", whose property set is FIXED at compile time (a C struct, " +
        "one field per declared member, no key table) \u2014 a property named by a string, and " +
        "above all by a run-time string, has nowhere to live, so this refuses at the receiver " +
        "whatever the descriptor says. A program CLASS is the receiver kind that DOES carry a " +
        "run-time property table; a record shape does not; " + LOWERED_SHAPE
      );
    }
    if (overflowKeys) {
      return (
        "the RECEIVER is a record with an index signature, so a run-time key DOES have somewhere " +
        "to live (the overflow map) \u2014 what it has nowhere to live is the descriptor's " +
        "ATTRIBUTES: overflow entries carry no writable/enumerable/configurable bits and no " +
        "accessor slot, and defineProperty defaults all three flags to FALSE, so nothing but the " +
        "fully-open data descriptor could be honoured. Write the key: o[k] = v IS " +
        "{ value: v, writable: true, enumerable: true, configurable: true } on a shape with no " +
        "prototype chain and no attributes"
      );
    }

    const desc = call.arguments[2]!;
    const accessorKey = ts.isObjectLiteralExpression(desc) &&
      desc.properties.some((p) => {
        if (ts.isSpreadAssignment(p)) return false;
        const nm = ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) ? p.name.text : null;
        return nm === "get" || nm === "set";
      });
    if (accessorKey) {
      return (
        "the DESCRIPTOR is an accessor (get/set), not data: a getter is a control transfer on " +
        "every read of the property and a setter one on every write, and a static shape carries " +
        "no slot for either; " + LOWERED_SHAPE
      );
    }
    return LOWERED_SHAPE;
  }

/** True iff the accessed member is declared by the standard library —
   * the same technique as isConsoleLog: trust declarations, not names. */
  export function isStdlibMember(L: Lowerer, access: ts.PropertyAccessExpression): boolean {
    const direct = L.checker.getSymbolAtLocation(access.name);
    if (direct) return L.isStdlibSymbol(direct);
    // An IMPLICIT-ANY instance body (the checker sees an `any` receiver —
    // no member symbol resolves) or an ALIASED-TYPEOF narrow (the checker
    // sees the un-narrowed union — `val.length` on String|Number has no
    // property symbol): typeOf answers the bound/narrowed type — resolve
    // the member from it, the same provenance answer the checker would
    // give on a typed receiver (`path.startsWith` with path bound string
    // IS String.prototype.startsWith).
    if (L.implicitParamTypes !== null || L.aliasNarrowTypes.size > 0) {
      const viaType = L.checker.getPropertyOfType(L.typeOf(access.expression), access.name.text);
      return L.isStdlibSymbol(viaType ?? undefined);
    }
    return false;
  }

/** The provenance check the CHILD receiver lowerings use: a stdlib
   * member, OR a member the user's own child-shaped interface declares
   * (the NgrokChildProcess idiom — mapType's duck rule admits an
   * interface only when EVERY member names the lowered ChildProcess
   * surface, so accepting its members here cannot widen the surface;
   * the receiver-kind gate already proved the type maps to child). */
  export function isChildSurfaceMember(L: Lowerer, access: ts.PropertyAccessExpression): boolean {
    if (isStdlibMember(L, access)) return true;
    const sym = L.checker.getSymbolAtLocation(access.name);
    const decl = sym ? L.checker.declarationsOf(sym)[0] : undefined;
    const iface = decl?.parent;
    if (!decl || !iface || !ts.isInterfaceDeclaration(iface)) return false;
    if (L.isStdlibFile(decl.getSourceFile())) return false;
    return L.mapTypeOf(L.checker.getTypeAtLocation(iface.name))?.kind === "child";
  }

/** A declaration that DEFINES A VALUE the program itself writes: a
   * function body, a class, a non-`declare` variable. What it is not: an
   * `interface`, a `type`, a `declare module` augmentation — the
   * TYPE-space merges that are the whole reason isStdlibSymbol answers
   * `some` rather than `[0]`.
   *
   * The distinction is the one that keeps a user's own `function
   * encodeURI(s) { ... }` from being read as the library's. */
  function isUserValueDeclaration(d: ts.Node): boolean {
    if (ts.isFunctionDeclaration(d)) return d.body !== undefined;
    if (ts.isClassDeclaration(d)) return true;
    if (ts.isVariableDeclaration(d)) {
      const stmt: ts.Node | undefined = d.parent?.parent;
      if (stmt !== undefined && ts.isVariableStatement(stmt)) {
        return !(stmt.modifiers ?? []).some((m) => m.kind === ts.SyntaxKind.DeclareKeyword);
      }
      return true;
    }
    return false;
  }

  /** True iff some declaration of the symbol lives in the standard library
   * (shipped ambient or default lib — the provenance half of every
   * supported-surface check) AND THE PROGRAM DOES NOT DEFINE THE NAME
   * ITSELF.
   *
   * `some`, not `[0]`, for the first half: divergence overrides merge with
   * lib interfaces, so a member can carry declarations from both.
   *
   * The second half is not caution — it is a family of SILENT WRONG
   * ANSWERS this test shipped. The sentence that stood here said "a user's
   * own declaration is in neither, so shadowing never matches", and it is
   * false for the case that matters most: at the TOP LEVEL OF A SCRIPT (a
   * file with no import or export), a `function isNaN(n) { ... }` does not
   * shadow the ambient `declare function isNaN` — TypeScript MERGES the
   * two into ONE symbol carrying both declarations, and `some` said yes.
   * Node runs the program's function; this compiler ran the library's.
   * Measured on main, six global names answered wrong that way, `isNaN`,
   * `isFinite`, `parseInt`, `parseFloat`, `decodeURIComponent` and
   * `structuredClone` among them:
   *
   *     function isNaN(n: number): boolean { return n === 42 }
   *     console.log(isNaN(42))     // Node: true      main: false
   *
   * A program that DEFINES a name defines it; that is the whole rule. A
   * declaration-only merge (`interface`, `type`, `declare module`, a
   * `declare` variable — the divergence-override and ambient-augmentation
   * spellings) adds no value and keeps the library's provenance, so every
   * type-space merge this test was written for still matches. */
  export function isStdlibSymbol(L: Lowerer, symbol: ts.Symbol | undefined): boolean {
    if (!symbol) return false;
    // ONE isStdlibFile call per declaration, which is what the `.some`
    // this replaced cost: the kind test only runs for a declaration that
    // is already known not to be the library's. This sits on a hot path
    // (83 call sites, one of them the identifier chokepoint), so the
    // second half is deliberately free for every symbol the library
    // wholly owns.
    let sawLib = false;
    for (const d of L.checker.declarationsOf(symbol)) {
      if (L.isStdlibFile(d.getSourceFile())) sawLib = true;
      else if (isUserValueDeclaration(d)) return false;
    }
    return sawLib;
  }

/** The canonical stdlib-global name `expr` denotes, or null. Three
   * spellings reach the same global (Node's own aliasing):
   *   - the bare identifier (`process`), name + provenance checked;
   *   - the `global` identifier — Node's alias of globalThis — and
   *     `globalThis` itself both canonicalize to "globalThis";
   *   - a property read off globalThis (`globalThis.process`,
   *     `global.process`) — `declare var` globals ARE properties of
   *     `typeof globalThis`, same symbol either way;
   *   - a local alias binding (`const process = globalThis.process`, the
   *     tamper-guard prologue) registered in stdlibGlobalAliases. */
  export function stdlibGlobalNameOf(L: Lowerer, expr: ts.Expression): string | null {
    if (ts.isParenthesizedExpression(expr)) return stdlibGlobalNameOf(L, expr.expression);
    // A CAST over the receiver changes only the STATIC view — the object
    // is still the one global. This is how a program names a global the
    // ambient types do not declare the way it wants to read it:
    // `(globalThis as typeof globalThis & { WebSocket?: Ctor }).WebSocket`
    // is the canonical spelling (lower-ws.ts peels it for its own gate for
    // exactly this reason), and zapo's transport reaches `process` through
    // the same one. What keeps the peel honest is the MEMBER check below,
    // untouched: the name must still resolve to a symbol the standard
    // library declares, so a cast that INVENTS a member resolves to no
    // global and keeps its fence.
    if (ts.isAsExpression(expr) || ts.isSatisfiesExpression(expr) || ts.isNonNullExpression(expr)) {
      return stdlibGlobalNameOf(L, expr.expression);
    }
    if (ts.isIdentifier(expr)) {
      // `globalThis` itself: a reserved intrinsic — tsc rejects user
      // bindings of the name, and its special symbol carries no ordinary
      // declarations for the provenance check to see.
      if (expr.text === "globalThis") return "globalThis";
      const symbol = L.checker.getSymbolAtLocation(expr);
      if (!symbol) return null;
      const alias = L.stdlibGlobalAliases.get(symbol);
      if (alias !== undefined) return alias;
      // An IMPORTED binding of a builtin module's re-exported global
      // (`import { Buffer } from "node:buffer"` — Node's module spelling
      // of the same object) resolves through the alias to the fallback
      // file's own export, so provenance and name check out exactly like
      // the bare-global spelling. A user module re-exporting its own
      // `Buffer` resolves to a user-file declaration and still misses.
      const resolved = symbol.flags & ts.SymbolFlags.Alias ? L.checker.getAliasedSymbol(symbol) : symbol;
      if (!L.isStdlibSymbol(resolved)) return null;
      return resolved.name === "global" ? "globalThis" : resolved.name;
    }
    if (ts.isPropertyAccessExpression(expr) && !expr.questionDotToken) {
      if (stdlibGlobalNameOf(L, expr.expression) !== "globalThis") return null;
      const symbol = L.checker.getSymbolAtLocation(expr.name);
      if (!symbol || !L.isStdlibSymbol(symbol)) return null;
      return symbol.name === "global" ? "globalThis" : symbol.name;
    }
    return null;
  }

/** True iff `expr` denotes THE standard-library global `name` — name AND
   * provenance, because neither alone suffices: several globals share
   * member names (Math.log must never lower as console.log), and a user
   * binding shadowing a global's name has a different, non-stdlib symbol.
   * All of stdlibGlobalNameOf's spellings answer (globalThis.process is
   * process; `const process = globalThis.process` aliases through). */
  export function isStdlibGlobal(L: Lowerer, expr: ts.Expression, name: string): boolean {
    return stdlibGlobalNameOf(L, expr) === name;
  }

/** The member name of a `<global>.<member>` access whose receiver is THE
   * standard-library global `name` (console, JSON, process, Math). Null for
   * anything else, so property-lowering chains keep trying other
   * receivers. */
  export function stdlibGlobalMember(L: Lowerer, access: ts.PropertyAccessExpression, name: string): string | null {
    if (L.chainBlocked(access)) return null;
    return L.isStdlibGlobal(access.expression, name) ? access.name.text : null;
  }

/** `const process = globalThis.process` (and any `const x = <stdlib
   * global>` snapshot — the suite harness's tamper-guard prologue): the
   * binding is pure alias plumbing. Nothing in a compiled program can
   * reassign a stdlib global, so the snapshot IS the global: the symbol
   * registers in stdlibGlobalAliases (every receiver check resolves
   * through it — see stdlibGlobalNameOf) and the declaration emits
   * nothing. Only the globals with lowered member surfaces alias this
   * way; aliasing, say, `Math` would change nothing (its members lower
   * by receiver too). Returns true when recognized. */
  export function stdlibGlobalAliasDecl(L: Lowerer, nameNode: ts.Node, init: ts.Expression | undefined): boolean {
    if (!init || !ts.isIdentifier(nameNode)) return false;
    // `const process = require('node:process')`: Node's process MODULE is
    // the global process object (module.exports === globalThis.process),
    // so the binding aliases the global exactly like `const process =
    // globalThis.process`. Preflight admits exactly this shape
    // (processModuleAliasRequire7); commander's lib/command.js opens with
    // it.
    const requireSpec = requireSpecOf(init);
    const name =
      requireSpec === "process" || requireSpec === "node:process"
        ? "process"
        : stdlibGlobalNameOf(L, init);
    if (name === null) return false;
    // Only alias OBJECT-shaped globals whose members lower by receiver
    // identity (process, console, globalThis itself, and perf_hooks'
    // performance — the mockable-clock idiom snapshots it). Function-valued
    // globals (setTimeout) taken as values are a different story — the
    // ordinary value paths (and their fences) apply.
    if (name !== "process" && name !== "console" && name !== "globalThis" && name !== "performance") return false;
    const symbol = L.checker.getSymbolAtLocation(nameNode);
    if (!symbol) return false;
    L.stdlibGlobalAliases.set(symbol, name);
    return true;
  }

/** True iff the symbol is declared ONLY by the adopted @types/node
   * surface (no es-lib or shipped-ambient declaration merges in) — chooses
   * the SC2020 fence's wording: "typed by @types/node", not "standard
   * library". */
  export function nodeTypesOnlySymbol(L: Lowerer, sym: ts.Symbol | null | undefined): boolean {
    const decls = sym ? L.checker.declarationsOf(sym) : undefined;
    if (!decls || decls.length === 0) return false;
    let viaNode = false;
    for (const d of decls) {
      const sf = d.getSourceFile();
      if (sf.isDeclarationFile && isNodeTypesPath(sf.fileName)) viaNode = true;
      else if (L.isStdlibFile(sf)) return false;
    }
    return viaNode;
  }

/** `Object.getOwnPropertyNames` — and its twin `Object.keys` — taken as a
   * VALUE rather than called. The diffieHellman lift, one surface over.
   *
   * A builtin has no closure representation: it lowers to a libCall at its
   * CALL sites, so the bare member read fences. The bundler preamble needs
   * the value itself. esbuild's `__commonJS` is
   *
   *     var o = Object.getOwnPropertyNames,
   *       r = (e, t) => function () { return t || (0, e[o(e)[0]])(...), ... };
   *
   * — the builtin bound once at module scope and read from inside the
   * memoizing thunk. Fencing the BINDING costs more than the read: the
   * declaration is poisoned, so `o` gets no module global, which leaves it
   * an %init-body local, and the thunk (a MONOMORPHIZED instance that takes
   * no captures) then fences a SECOND time on a capture with nothing to
   * thread. Measured on the `modtable` pilot: the lift alone takes two
   * fences to one, and the matching global registration
   * (objectStaticFnValueDeclType, read by collectGlobals) takes one to
   * zero. The control is the same program with a plain function value in
   * that position — no second fence there, which is what proves the second
   * fence is this construct's and not the object model's.
   *
   * The lift is a real function over the SAME lowering the call form uses
   * on a checked-dynamic receiver — `dyn.objKeys` for `keys`,
   * dynOwnNamesHelper for `getOwnPropertyNames`. Nothing new is claimed:
   * any argument this closure receives answers exactly what it would have
   * answered spelled at the call site.
   *
   * `values` and `entries` are deliberately NOT here, and that is a
   * measurement rather than a scoping choice: they are declared GENERIC, so
   * a bare read of them refuses at the generic-method-as-value rule long
   * before this chokepoint and lifting them would only register storage
   * nothing can fill. Their value position is that rule's to open.
   *
   * Memoized per program. Null when the access is not this pair — the
   * caller keeps its fence. */
  export function objectStaticFnValueOf(L: Lowerer, access: ts.PropertyAccessExpression): IrExpr | null {
    if (!isObjectOwnKeysFnValue(L, access)) return null;
    const loc = locOf(access);
    const ownNames = L.stdlibGlobalMember(access, "Object") === "getOwnPropertyNames";
    const name = ownNames ? dynOwnNamesHelper(L, loc) : "%object.keys.value";
    if (!ownNames && !L.liftedFns.some((f) => f.name === name)) {
      const argId = "o.0";
      L.liftedFns.push({
        name,
        params: [{ localId: argId, name: "o", type: DYN }],
        returnType: DYN,
        locals: [{ id: argId, name: "o", type: DYN, mutable: false }],
        body: [
          {
            kind: "return",
            value: {
              kind: "libCall",
              fn: "dyn.objKeys",
              args: [{ kind: "varRef", localId: argId, type: DYN, loc }],
              type: DYN,
              loc,
            },
            loc,
          },
        ],
        loc,
      });
    }
    if (process.env["SCRIPTC_OBJFNVALUE_WHY"] !== undefined) {
      console.error(`[objfnvalue] lift ${loc.file}:${loc.start} ${name}`);
    }
    return { kind: "closure", fnName: name, captures: [], type: OBJECT_OWN_KEYS_FN_VALUE_T, loc };
  }

/** True iff the ONLY consumer of this expression's value is JS ToBoolean:
   * a `?:` / `if` / `while` / `do` / `for` condition, or a `!` operand
   * (`!x` is itself a boolean, so wherever IT goes is already answered).
   *
   * `&&` and `||` are deliberately absent. They yield an OPERAND, not a
   * boolean — `Number.isInteger || function (v) { ... }` puts the read's
   * VALUE in the result and then calls it — so an operand of theirs is a
   * value position and keeps whatever fence it had. */
  function boolOnlyConsumer(node: ts.Expression): boolean {
    let cur: ts.Node = node;
    for (;;) {
      const parent: ts.Node | undefined = cur.parent;
      if (parent === undefined) return false;
      if (ts.isParenthesizedExpression(parent)) { cur = parent; continue; }
      if (ts.isConditionalExpression(parent)) return parent.condition === cur;
      if (ts.isIfStatement(parent) || ts.isWhileStatement(parent) || ts.isDoStatement(parent)) {
        return parent.expression === cur;
      }
      if (ts.isForStatement(parent)) return parent.condition === cur;
      if (ts.isPrefixUnaryExpression(parent)) {
        return parent.operator === ts.SyntaxKind.ExclamationToken && parent.operand === cur;
      }
      return false;
    }
  }

/** A stdlib global's declared METHOD read in a position whose only
   * consumer is ToBoolean — the CAPABILITY TEST, which is a different
   * construct from the function value it reads. protobufjs's util opens
   * with two of them in one statement:
   *
   *     t.emptyArray = Object.freeze ? Object.freeze([]) : [],
   *     t.emptyObject = Object.freeze ? Object.freeze({}) : {}
   *
   * (the `Object.freeze(...)` CALLS in the same statement are lower-calls'
   * and already compile — only the bare reads fenced).
   *
   * The answer is the constant `true`, and that is a theorem in three
   * parts rather than a guess:
   *
   *  1. WHAT IS READ. The member must be declared by the standard library
   *     — EVERY declaration, not merely one, so a program's own global
   *     augmentation cannot smuggle a name in — it must be NON-optional,
   *     and its type must carry CALL SIGNATURES. That combination is
   *     exactly the declaration that says "this function is always
   *     defined"; tsc asserts the same thing itself, and reports TS2774
   *     on `if (fn)` for this precise reason. Two kinds are excluded on
   *     purpose because their truthiness is a RUNTIME fact and no
   *     declaration settles it: OPTIONAL members (`process.send` is
   *     absent in a process nobody forked) and DATA members
   *     (`process.exitCode`, `Math.PI`, a zero or an empty string).
   *     Constructor-only globals go with them — `globalThis.WebSocket`
   *     has construct signatures and no call signature, and whether the
   *     host provides it is the very thing the test is asking.
   *  2. WHAT IS DONE WITH IT. boolOnlyConsumer: nothing calls the value,
   *     stores it, passes it, or compares it. So no representation for a
   *     stdlib function value is claimed here, and the identity-token
   *     trap — a value that answers a truthiness test and then turns into
   *     the wrong thing when something CALLS it — cannot be reached.
   *  3. WHY TRUE. ToBoolean of every function object is `true`. The one
   *     exception in the language, an [[IsHTMLDDA]] object
   *     (`document.all`), is a host object of the DOM and is not a member
   *     of any stdlib global.
   *
   * The RECEIVER is a stdlib global, which is why the read can vanish
   * outright: there is no subexpression to evaluate for effect first.
   *
   * Deliberately NOT a function-VALUE lift for `freeze`. The CALL form
   * (lower-calls) admits `Object.freeze(x)` only where it can prove x is
   * FRESH, because this tier carries no frozen bit and a freeze whose
   * frozen-ness is observable would be a lie; a lifted closure has no
   * call site to prove freshness at, so its body could only be identity —
   * and then `var f = Object.freeze; f(aliased)` would silently answer
   * where `Object.freeze(aliased)` loudly refuses. The value position of
   * `freeze` stays fenced; only the existence question is answered.
   *
   * ONE EXCEPTION, AND IT IS THE POINT OF `EXISTENCE_REFUSED` BELOW. Part 1
   * of the theorem is a statement about the DECLARATION — "the standard
   * library says this function is always defined" — and the declaration is
   * a statement about NODE. It is not a statement about the runtime this
   * compiler is building for. Where the two disagree, answering `true` is
   * the worst of the three possible answers: the program is told the
   * capability exists, takes the arm that uses it, and that arm REFUSES,
   * so the fallback the library wrote for exactly this case is dropped on
   * the floor and the whole construct becomes an unconditional throw.
   * That is what happened to every protobufjs `CustomError`. */
  /** Stdlib members whose CALL this compiler refuses, so the capability
   * test above must answer `false` and let the program's own fallback run.
   *
   * A member belongs here only when all three hold, and each entry names
   * its evidence:
   *   1. the call form has no lowering (an SC2020/SC1090 refusal),
   *   2. the read appears in a feature detect whose OTHER arm is a real
   *      fallback the library ships,
   *   3. taking that fallback is a behaviour this compiler can produce.
   *
   * `Error.captureStackTrace` — V8's own stack API, declared by
   * @types/node and by no other lib file, and refused by this compiler
   * ("'Error.captureStackTrace' is typed by @types/node but has no scriptc
   * lowering yet", SC2020). protobufjs's `util.newError` spells
   *
   *     Error.captureStackTrace
   *       ? Error.captureStackTrace(this, t)
   *       : Object.defineProperty(this, "stack", { value: (new Error).stack || "" })
   *
   * — the library's own sanctioned path for an engine without the V8 API,
   * and one this compiler compiles. Answering `true` folded the detect,
   * selected the refusing arm, and dropped the else arm, so EVERY
   * construction of a protobufjs custom error threw. Answering `false`
   * runs the fallback and the error constructs.
   *
   * The price, stated plainly: Node HAS the API and answers `true`, so
   * this is a DIVERGENCE, not a match — `err.stack` is scriptc's stack
   * string rather than V8's frame list. It is the same string the else arm
   * would produce under any non-V8 engine, which is the case the library
   * wrote it for, and protobufjs only ever displays it. Everything else
   * about the error — `message`, `name`, `toString()`, `instanceof` — is
   * byte-identical to Node, and that is measurable (block/rank123,
   * repro/cst.js). A refusal here is not the safer answer: it is a throw
   * where Node returns an object. */
  const EXISTENCE_REFUSED: ReadonlySet<string> = new Set(["Error.captureStackTrace"]);

  export function stdlibExistenceTestOf(L: Lowerer, access: ts.PropertyAccessExpression): IrExpr | null {
    if (L.chainBlocked(access)) return null;
    const globalName = stdlibGlobalNameOf(L, access.expression);
    if (globalName === null) return null;
    if (!boolOnlyConsumer(access)) return null;
    const propSym =
      L.checker.getSymbolAtLocation(access.name) ??
      L.checker.getPropertyOfType(L.typeOf(access.expression), access.name.text);
    if (!propSym) return null;
    if ((propSym.flags & ts.SymbolFlags.Optional) !== 0) return null;
    const decls = L.checker.declarationsOf(propSym);
    if (decls.length === 0 || !decls.every((d) => L.isStdlibFile(d.getSourceFile()))) return null;
    if (L.checker.getCallSignatures(L.checker.getTypeOfSymbol(propSym)).length === 0) return null;
    // Every gate above has passed, so this IS a capability test over a
    // declared stdlib method. The only remaining question is whether THIS
    // compiler provides the capability; where it does not, the truthful
    // answer about the runtime being built is `false`.
    const refused = EXISTENCE_REFUSED.has(`${globalName}.${access.name.text}`);
    if (process.env["SCRIPTC_EXISTTEST_WHY"] !== undefined) {
      const loc = locOf(access);
      console.error(`[existtest] ${loc.file}:${loc.start} ${globalName}.${access.name.text} -> ${!refused}`);
    }
    return { kind: "boolLit", value: !refused, type: BOOL, loc: locOf(access) };
  }

/** A property read on `globalThis` naming a global THIS HOST DOES NOT
   * HAVE, at a site whose declared type already admits `undefined`.
   *
   * `(globalThis as { gc?: () => void }).gc` is the canonical spelling —
   * the `--expose-gc` probe every benchmark carries, and the first thing
   * zapo's messaging bench asks its host. In JavaScript, reading an ABSENT
   * property of the global object is not an error and not a special case:
   * it answers `undefined`, in every host, and Node started WITHOUT
   * `--expose-gc` answers exactly that. So does a compiled binary, which
   * has no gc to expose. The fold is therefore the general rule, not a
   * bench-shaped exception — what needs care is PROVING the global is
   * absent, because answering `undefined` for one this compiler does
   * provide would be a silent wrong answer standing where a fence used
   * to be.
   *
   * Two facts must both hold, and NEITHER is the program's cast:
   *
   *  1. The ambient global object DECLARES the name and admits `undefined`
   *     in its type. The receiver's real type is read off the PEELED
   *     identifier, never off the `as` (a cast changes only the static
   *     view; the object is still the one global). A name nothing declares
   *     does NOT qualify — see the counterexample block in the body. In the
   *     pinned real-types world (tests/fixtures/node-types: @types/node
   *     24.13.3 + undici-types 7.18.2) exactly ONE global is declared this
   *     way, and the command that says so is
   *
   *       rg -n '^declare var .*\| *undefined' node_modules/@types/node
   *       globals.d.ts:74:declare var gc: NodeJS.GCFunction | undefined;
   *
   *     and the fallback declares its twin, deliberately and for this
   *     reason. A cast cannot manufacture either fact: `(globalThis as
   *     { crypto?: Crypto }).crypto` still sees `var crypto` on the
   *     receiver, non-optional, and keeps its fence — right, because this
   *     compiler HAS crypto.
   *  2. The site can represent the answer: the read's mapped type carries
   *     an `undefined` arm. A program that declared the member
   *     non-optional asked for a value and gets its fence, not a lie.
   *
   * WEBSOCKET IS EXCLUDED BY NAME, belt and braces. It is the one global
   * with a structural lowering above this one (lowerWebSocketGlobal) that
   * can DECLINE — on a construct signature it cannot build — and a decline
   * there means "fence", never "undefined". Guard 1 already refuses it
   * (undici declares it non-optional, and the fallback does not declare it
   * at all), so the name check is redundant today; it is kept because the
   * cost of it becoming load-bearing again is a silent wrong answer. The
   * chain position is the guard for every other provided global: each is
   * claimed above, so a declared-optional global with a lowering never
   * reaches here.
   *
   * This is exactly the residue stdlibExistenceTestOf declines. That rule
   * answers the EXISTENCE question (`Object.freeze ? ... : ...`) for
   * NON-optional stdlib methods and returns null on Optional; this one
   * answers the VALUE question for the optional half. */
  export function absentGlobalMemberValue(L: Lowerer, access: ts.PropertyAccessExpression): IrExpr | null {
    if (access.questionDotToken) return null;
    if (L.chainBlocked(access)) return null;
    const name = access.name.text;
    if (name === "WebSocket") return null;
    let recv: ts.Expression = access.expression;
    for (;;) {
      if (ts.isParenthesizedExpression(recv)) { recv = recv.expression; continue; }
      if (ts.isAsExpression(recv) || ts.isSatisfiesExpression(recv)) { recv = recv.expression; continue; }
      if (ts.isNonNullExpression(recv)) { recv = recv.expression; continue; }
      break;
    }
    if (stdlibGlobalNameOf(L, recv) !== "globalThis") return null;
    const why = (step: string): null => {
      if (process.env["SCRIPTC_ABSENTGLOBAL_WHY"] !== undefined) {
        const l = locOf(access);
        console.error(`[absentglobal] decline=${step} globalThis.${name} at ${l.file}:${l.start}`);
      }
      return null;
    };
    const gp = L.checker.getPropertyOfType(L.typeOf(recv), name);
    // NO DECLARATION IS NOT EVIDENCE OF ABSENCE, and this arm was written
    // the other way round first. It folded any undeclared name, on the
    // reasoning that a name nothing declares is a name Node does not have.
    // That reasoning fails in BOTH worlds. The shipped fallback's whole job
    // is to declare what scriptc SUPPORTS, so silence there means
    // "unsupported"; and the pinned @types/node 24.13.3 does not declare
    // URLPattern, navigator, Navigator, Float16Array, DisposableStack,
    // Storage or localStorage, every one of which is a real global in the
    // v25.9.0 oracle — a declaration set always lags the runtime it
    // models. Compiled in a fallback-world project, that version answered
    // `undefined` for twenty-four globals Node really has —
    //
    //   navigator Navigator URLPattern Blob File FormData BroadcastChannel
    //   TransformStream ReadableStream WritableStream CompressionStream
    //   DecompressionStream DisposableStack AsyncDisposableStack
    //   SuppressedError WebAssembly Storage Performance PerformanceObserver
    //   CloseEvent ErrorEvent Request Response Headers
    //
    // — on both backends, clean, at exit 0, where Node prints "function"
    // or "object" (lab probe gprobe3.ts). So the evidence has to be a
    // DECLARATION THAT SAYS SO: the ambient global object must declare the
    // name AND admit `undefined` in its type. Both worlds carry exactly one
    // such global and it is the same one — @types/node's `declare var gc:
    // NodeJS.GCFunction | undefined` and the fallback's twin of it.
    if (gp === undefined) return why("undeclared");
    const decls = L.checker.declarationsOf(gp);
    if (decls.length === 0 || !decls.every((d) => L.isStdlibFile(d.getSourceFile()))) return why("provenance");
    const gt = L.checker.getTypeOfSymbol(gp);
    const admitsUndefined = (t: ts.Type): boolean =>
      (t.flags & ts.TypeFlags.Undefined) !== 0 ||
      (t.isUnionType() && t.getTypes().some((a) => (a.flags & ts.TypeFlags.Undefined) !== 0));
    if (!admitsUndefined(gt)) return why("declared-present");
    const t = L.mapTypeOf(L.typeOf(access));
    const loc = locOf(access);
    const undef: IrExpr = { kind: "unitLit", unit: "undefined", type: UNDEFINED_T, loc };
    if (process.env["SCRIPTC_ABSENTGLOBAL_WHY"] !== undefined) {
      console.error(`[absentglobal] globalThis.${name} site=${t?.kind ?? "unmapped"} at ${loc.file}:${loc.start}`);
    }
    if (t?.kind === "undefinedT") return undef;
    // A JavaScript source has no static slot to satisfy: values there ride
    // the checked-dynamic tree, so the answer is the value itself. This arm
    // is not a convenience — it is a WRONG ANSWER closed. `globalThis.gc`
    // in a .js file reached the identity-token rule below (a stdlib global
    // taken as a value becomes the interned string "[builtin gc]") and
    // printed `string` / `false` where Node prints `undefined` / `true`,
    // at exit 0. The token means "the one global object named X"; for a
    // global this host does not have there is no object to name.
    if (isJsSourceFile(access.getSourceFile())) return undef;
    // Guard 1 passed — the ambient global object says this name may be
    // absent — but the SITE cannot hold the answer. The read is a probe
    // for a global this host does not have, written with the member
    // declared non-optional, so `undefined` has nowhere to go.
    //
    // That fence is raised HERE rather than left to the chain, because
    // the chain's next step lowers the RECEIVER and fences on it: it
    // reported "'globalThis' ... has no scriptc lowering yet", blaming a
    // global that is perfectly fine for a member that is not, and its
    // hint was the generic limitations URL. The advice below is the
    // difference between .probe/g3.ts (this fence) and .probe/g1.ts
    // (which compiles and prints Node's answer) — one character.
    //
    // TypeScript sources only: a JavaScript source took the value arm
    // above, and the identity-token rule below this chain is still the
    // right owner of everything else there.
    const memberFence = (detail: string): never =>
      L.noLowering(
        `globalThis.${name}`,
        access,
        `${detail}. The RECEIVER is not the blocker — this compiler has globalThis; the member is what has no value here. Reading a global this host does not have folds to \`undefined\` (Node's own answer for an absent property of the global object) exactly when the declaration admits it: spell the member optional — \`(globalThis as { ${name}?: T }).${name}\` — and the read compiles`,
        L.checker.getSymbolAtLocation(access.name),
      );
    if (t?.kind !== "union") {
      if (t !== null) {
        memberFence(
          `'${name}' is declared non-optional at this site, so the read must produce a value and there is none`,
        );
      }
      return why("site-kind");
    }
    const tag = L.armTag(t.unionId, UNDEFINED_T);
    if (tag < 0) {
      memberFence(
        `'${name}' is declared here as a union with no \`undefined\` arm, so the read must produce a value and there is none`,
      );
    }
    return { kind: "unionWrap", unionId: t.unionId, tag, value: undef, type: t, loc };
  }

/** `Object.getOwnPropertyNames` over a CHECKED-DYNAMIC receiver, as a
   * memoized lifted function — the honest twin of `dyn.objKeys`.
   *
   * The two walks coincide for a plain object (no non-enumerable own
   * members, no symbol keys) and that is what the record path relies on,
   * but they DO NOT coincide for the index-keyed kinds: JS arrays and
   * strings carry `length` as an own property, so Node answers
   * `["0","1","length"]` where `Object.keys` answers `["0","1"]`. A dyn
   * receiver's kind is a runtime fact, so the test is a runtime test —
   * `dyn.objKeys` first, then append `"length"` when the receiver turns
   * out to be one of those two kinds. Typed arrays are correctly NOT in
   * the list: their `length` is an accessor on `%TypedArray%.prototype`,
   * so Node answers the indices alone, which is what the walk already
   * gives.
   *
   * (Function receivers keep the walk's answer and stay divergent from
   * Node's `["length","name","prototype"]` — untouched here, and the same
   * in the call form.) */
  export function dynOwnNamesHelper(L: Lowerer, loc: SrcLoc): string {
    const name = "%object.ownNames";
    if (L.liftedFns.some((f) => f.name === name)) return name;
    const argId = "o.0";
    const outId = "names.0";
    const oRef: IrExpr = { kind: "varRef", localId: argId, type: DYN, loc };
    const outRef: IrExpr = { kind: "varRef", localId: outId, type: DYN, loc };
    // `names[names.length] = "length"` — the dyn index write appends.
    const appendLength: IrStmt = {
      kind: "exprStmt",
      expr: {
        kind: "libCall",
        fn: "dyn.keySet",
        args: [
          outRef,
          { kind: "toString", operand: { kind: "libCall", fn: "dyn.arrLen", args: [outRef], type: F64, loc }, type: STRING, loc },
          { kind: "dynFrom", value: { kind: "strLit", value: "length", type: STRING, loc }, type: DYN, loc },
        ],
        type: VOID,
        loc,
      },
      loc,
    };
    const kindGuard = (test: "array" | "string"): IrStmt => ({
      kind: "if",
      cond: { kind: "dynTest", test, value: oRef, type: BOOL, loc },
      then: [appendLength],
      else_: null,
      loc,
    });
    L.liftedFns.push({
      name,
      params: [{ localId: argId, name: "o", type: DYN }],
      returnType: DYN,
      locals: [
        { id: argId, name: "o", type: DYN, mutable: false },
        { id: outId, name: "names", type: DYN, mutable: false },
      ],
      body: [
        // …and the one receiver for which "keys plus length" is not the
        // own-NAMES list: an object carrying NON-ENUMERABLE own
        // properties. Those are exactly the names the two functions
        // disagree about, they never enter the keys walk, and JS orders
        // own keys by creation — which the separate table does not
        // record. The runtime refuses by name rather than answering a
        // list that is silently short (scr_dyn_own_names_fence); every
        // other receiver pays one NULL test.
        {
          kind: "exprStmt",
          expr: { kind: "libCall", fn: "dyn.ownNamesFence", args: [oRef], type: VOID, loc },
          loc,
        },
        {
          kind: "varDecl",
          localId: outId,
          init: { kind: "libCall", fn: "dyn.objKeys", args: [oRef], type: DYN, loc },
          loc,
        },
        // …and the one own name the keys walk cannot produce, because
        // nothing stores it: a function's MINTED prototype object is
        // born carrying `constructor` (an own NON-enumerable data
        // property in Node, whose value this tier answers out of the
        // constructor registry so the prototype does not retain the
        // function). `Object.hasOwn(F.prototype, "constructor")` has
        // said true here for a while; the own-names list said `[]`
        // where v25.9.0 says `["constructor"]`, which is the silently
        // SHORT answer the fence above exists to prevent. Prepended
        // rather than appended: own string keys list in CREATION order
        // and a prototype is born with this one. A no-op for every
        // other receiver.
        {
          kind: "exprStmt",
          expr: { kind: "libCall", fn: "dyn.ownNamesCtor", args: [outRef, oRef], type: VOID, loc },
          loc,
        },
        kindGuard("array"),
        kindGuard("string"),
        { kind: "return", value: outRef, loc },
      ],
      loc,
    });
    return name;
  }

/** The lift's function type: the runtime walk takes a checked-dynamic
   * receiver and answers a checked-dynamic list. */
  export const OBJECT_OWN_KEYS_FN_VALUE_T: IrType = funcOf([DYN], DYN);

/** True for `Object.getOwnPropertyNames` / `Object.keys` read as a VALUE.
   * Shared by the expression lift and by collectGlobals, which needs the
   * same answer BEFORE any statement lowers. */
  function isObjectOwnKeysFnValue(L: Lowerer, access: ts.PropertyAccessExpression): boolean {
    if (access.questionDotToken) return false;
    // STATIC builds only. The lift's body is the checked-dynamic walk, and
    // under --dynamic a JS value is an island HANDLE, not a dyn node — the
    // walk would answer the empty list for it. The call form self-gates the
    // same way (its dyn arm dispatches on the LOWERED receiver kind, which
    // is jsval there); the lift has no receiver to probe, so it says so.
    if (L.dynamic) return false;
    // JAVASCRIPT sources only. The walk answers a checked-dynamic list,
    // which is what a JS consumer of this value already holds everywhere
    // else; in TypeScript the checker promises `string[]` and handing back
    // a dyn would be a representation nothing annotated asked for. TS keeps
    // the SC2020 fence, which stays true there.
    if (!isJsSourceFile(access.getSourceFile())) return false;
    // The CALL form is lower-calls' — including the arities and receivers
    // it declines, which must keep their own fences rather than becoming
    // an arity error against a lifted closure.
    const parent = access.parent;
    if (parent && ts.isCallExpression(parent) && parent.expression === access) return false;
    const member = L.stdlibGlobalMember(access, "Object");
    return member === "getOwnPropertyNames" || member === "keys";
  }

/** The module-global slot type for a JS file-scope declaration whose
   * initializer IS that lift (`var o = Object.getOwnPropertyNames` — the
   * whole of esbuild's `__commonJS` preamble). Null for everything else,
   * so the JS-unmappable skip keeps its default. */
  export function objectStaticFnValueDeclType(L: Lowerer, init: ts.Expression | undefined): IrType | null {
    if (init === undefined) return null;
    let inner: ts.Expression = init;
    while (ts.isParenthesizedExpression(inner)) inner = inner.expression;
    if (!ts.isPropertyAccessExpression(inner)) return null;
    return isObjectOwnKeysFnValue(L, inner) ? OBJECT_OWN_KEYS_FN_VALUE_T : null;
  }

/** The module-global slot type for a FILE-SCOPE declaration whose
   * initializer is the bare `crypto.diffieHellman` builtin reference
   * (`const dh = diffieHellman` -- 2717's shape, and the callback-probe
   * binding in zapo's X25519 module). The declaration's own type is the
   * DECLARED one, and under real @types/node that is an OVERLOAD SET (the
   * synchronous options form plus the callback form), which maps nowhere;
   * the VALUE maps, because diffieHellmanFnValue lifts it to a real
   * closure. Exactly the objectStaticFnValueDeclType story one surface
   * over, and it must be spelled here as well as in lowerVarDecl because
   * the file-scope slot is chosen by collectGlobals before any initializer
   * is lowered.
   *
   * The shipped FALLBACK declarations spell diffieHellman with ONE
   * signature, so under them the declared type already mapped and nothing
   * here fires: this function is reachable only in the real-@types/node
   * world, which is the world the corpus was never in and zapo always is.
   *
   * Kept in step with diffieHellmanFnValue's own `fnT` by construction:
   * both intern the same two-field options record and return u8 bytes. */
  export function diffieHellmanFnValueDeclType(L: Lowerer, init: ts.Expression | undefined): IrType | null {
    if (init === undefined) return null;
    let inner: ts.Expression = init;
    while (ts.isParenthesizedExpression(inner)) inner = inner.expression;
    if (!ts.isIdentifier(inner)) return null;
    const bi = L.builtinImportOf(inner);
    if (!bi || bi.module !== "crypto" || bi.member !== "diffieHellman") return null;
    // Only where the DECLARED type has no home. Under the shipped fallback
    // the single-signature declaration maps, and the slot it produces is
    // the one this file-scope binding has always had -- overriding it here
    // would swap an interned shape for an identically-spelled one and count
    // as a change in a world this fix is not about. The fallback arm of the
    // corpus sweep is the measurement; this is the construction.
    if (L.mapTypeOf(L.typeOf(inner))) return null;
    const optsShape = L.shapes.intern([
      { name: "privateKey", type: KEYOBJ },
      { name: "publicKey", type: KEYOBJ },
    ]);
    return funcOf([{ kind: "record", shapeId: optsShape }], BYTES_U8);
  }

/** `String.prototype.charCodeAt` — a STRING method taken as a VALUE — as a
   * memoized lifted function. The `objectStaticFnValueOf` lift, one surface
   * over, and deliberately NOT the identity-token generalisation.
   *
   * protobufjs's `longbits.js` opens its module body with
   *
   *     var charCodeAt = String.prototype.charCodeAt;
   *     LongBits.fromHash = function (hash) {
   *       return new LongBits(charCodeAt.call(hash, 0) | charCodeAt.call(hash, 1) << 8 | ..., ...);
   *     };
   *
   * — the intrinsic bound once and reached through `Function.prototype
   * .call`. An opaque token would answer the READ and then make every
   * `.call` a "not a function" the trap census cannot see; the honest
   * answer is a real function whose body IS the lowering the call form
   * uses. `charCodeAt.call(hash, 0)` then lands on the arm that already
   * exists (lower-calls' `bindThisClosure` over a compiled function value
   * of matching arity), which opens the ambient-receiver window for the
   * call's extent — and the window is exactly where the body reads its
   * receiver from.
   *
   * A detached method is NOT bound to the receiver it was read through:
   * `String.prototype.charCodeAt` and `"x".charCodeAt` are the same
   * function object in Node, and neither remembers a `this`. So the lift
   * takes no captures and the receiver comes from `dyn.this`, resolved per
   * call exactly as the spec's step 1 and 2 say:
   *
   *   * RequireObjectCoercible — a nullish receiver throws Node's own
   *     TypeError ("String.prototype.<m> called on null or undefined"),
   *     verbatim, rather than coercing to "undefined"/"null". Skipping this
   *     is the whole difference between a lift and a silent wrong answer:
   *     `charCodeAt.call(undefined, 0)` would otherwise answer 117.
   *   * ToString with the object protocol (`dyn.toStringCoerce`), so
   *     `charCodeAt.call(42, 0)` is `"42".charCodeAt(0)` = 52, Node's
   *     answer, and a `toString` that throws propagates.
   *
   * Everything downstream of the receiver is the CALL form, unchanged: the
   * body is one `strIntrinsic`, over the same per-method signature the
   * validator enforces at every ordinary `s.<m>(...)` site. That is what
   * the arity/type gate below buys — the lift is built ONLY when the
   * checker's own mapped signature for the member is exactly
   * `STR_INTRINSIC_SIGS`'s, so no member can be lifted into a shape the
   * intrinsic does not implement (`split`'s `string | RegExp` separator,
   * `slice`'s omitted-argument defaults, an `at` that is island-only) and
   * every one of those keeps its loud fence.
   *
   * One divergence, stated: the closure is a fresh allocation per read, so
   * `String.prototype.charCodeAt === String.prototype.charCodeAt` is false
   * where Node says true. The `objectStaticFnValueOf` lift has the same
   * property; no lowered function value in this compiler has JS's identity.
   *
   * Memoized per program, per member spelling AND arity. Null when the
   * access is not this shape — the caller keeps its fence. */
  export function stringMethodFnValueOf(L: Lowerer, access: ts.PropertyAccessExpression): IrExpr | null {
    const plan = stringMethodFnValuePlan(L, access);
    if (plan === null) return null;
    const member = access.name.text;
    const loc = locOf(access);
    const name = `%string.${member}.${plan.params.length}.value`;
    const irParams: IrParam[] = plan.params.map((t, i) => ({ localId: `p.${i}`, name: `p${i}`, type: t }));
    if (!L.liftedFns.some((f) => f.name === name)) {
      const thisId = "recv.0";
      const strId = "s.0";
      const thisRef: IrExpr = { kind: "varRef", localId: thisId, type: DYN, loc };
      L.liftedFns.push({
        name,
        params: irParams,
        returnType: plan.ret,
        locals: [
          { id: thisId, name: "recv", type: DYN, mutable: false },
          { id: strId, name: "s", type: STRING, mutable: false },
          ...irParams.map((p) => ({ id: p.localId, name: p.name, type: p.type, mutable: false })),
        ],
        body: [
          {
            kind: "varDecl",
            localId: thisId,
            init: { kind: "libCall", fn: "dyn.this", args: [], type: DYN, loc },
            loc,
          },
          {
            kind: "if",
            cond: { kind: "dynTest", test: "nullish", value: thisRef, type: BOOL, loc },
            then: [
              {
                kind: "exprStmt",
                expr: {
                  kind: "libCall",
                  fn: "error.nodeThrow",
                  args: [
                    { kind: "numLit", value: 1, type: F64, loc },
                    { kind: "strLit", value: "", type: STRING, loc },
                    {
                      kind: "strLit",
                      value: `String.prototype.${member} called on null or undefined`,
                      type: STRING,
                      loc,
                    },
                  ],
                  type: VOID,
                  loc,
                },
                loc,
              },
            ],
            else_: null,
            loc,
          },
          {
            kind: "varDecl",
            localId: strId,
            init: { kind: "libCall", fn: "dyn.toStringCoerce", args: [thisRef], type: STRING, loc },
            loc,
          },
          {
            kind: "return",
            value: {
              kind: "strIntrinsic",
              method: plan.method,
              receiver: { kind: "varRef", localId: strId, type: STRING, loc },
              args: irParams.map((p) => ({ kind: "varRef" as const, localId: p.localId, type: p.type, loc })),
              type: plan.ret,
              loc,
            },
            loc,
          },
        ],
        loc,
      });
    }
    if (process.env["SCRIPTC_STRFNVALUE_WHY"] !== undefined) {
      console.error(`[strfnvalue] lift ${loc.file}:${loc.start} ${name}`);
    }
    return { kind: "closure", fnName: name, captures: [], type: funcOf(plan.params, plan.ret), loc };
  }

/** The gate for that lift: the member, the arity and the exact parameter
   * and result types the lifted body will hand the string intrinsic. Null
   * for everything else. */
  function stringMethodFnValuePlan(
    L: Lowerer,
    access: ts.PropertyAccessExpression,
  ): { method: IrStrIntrinsicMethod; params: IrType[]; ret: IrType } | null {
    if (L.chainBlocked(access)) return null;
    // STATIC builds only. Under --dynamic a JS value is an island HANDLE
    // and the engine keeps its own `this`; the ambient-receiver window
    // this body reads is the static world's, so it would answer a receiver
    // no island call ever pushed. The island's own string surface owns
    // that build's value position.
    if (L.dynamic) return null;
    // JAVASCRIPT sources only, and the reason is the receiver. The body's
    // whole content is "read the ambient receiver", and that window is a
    // JavaScript-only mechanism: in TypeScript a plain function's `this`
    // does not compile (SC1080), and `Function.prototype.call/bind` over a
    // compiled function value is JS-gated for exactly that reason
    // (bindThisClosure's caller). A TS consumer therefore has no way to
    // bind one, so the fence there stays true.
    if (!isJsSourceFile(access.getSourceFile())) return null;
    // The CALL form is lower-containers' (lowerStringMethodCall) —
    // including the arities and receivers it declines, which must keep
    // their own fences rather than becoming an arity error against a
    // lifted closure.
    const parent = access.parent;
    if (parent && ts.isCallExpression(parent) && parent.expression === access) return null;
    if (L.mapTypeOf(L.typeOf(access.expression))?.kind !== "string") return null;
    if (!L.isStdlibMember(access)) return null;
    // Reading a method DISCARDS the receiver's value, so the receiver's
    // evaluation must be discardable — the same restriction the tuple
    // `.length` fold takes. `String.prototype.charCodeAt` and
    // `s.charCodeAt` are roots this holds for; `f().charCodeAt` is not,
    // and keeps the fence rather than losing the call.
    let root: ts.Expression = access.expression;
    while (ts.isPropertyAccessExpression(root)) root = root.expression;
    if (!ts.isIdentifier(root) && root.kind !== ts.SyntaxKind.ThisKeyword && !ts.isStringLiteralLike(root)) return null;
    const entry = ownEntry(STR_METHODS, access.name.text);
    if (entry === undefined) return null;
    const sig = STR_INTRINSIC_SIGS[entry.method];
    // The checker's own mapped signature must BE the intrinsic's. This is
    // what keeps the lift honest for the members it does fire on and loud
    // for the rest: an optional parameter the intrinsic has no default
    // for, a union parameter (`split`'s `string | RegExp`), an
    // island-surface result — each fails one of these and keeps the fence.
    const ft = L.mapTypeOf(L.typeOf(access));
    if (ft === null || ft === undefined || ft.kind !== "func" || ft.rest === true) return null;
    if (ft.params.length < sig.minArgs || ft.params.length > sig.argTypes.length) return null;
    if (!ft.params.every((t, i) => typeEquals(t, sig.argTypes[i]!))) return null;
    if (!typeEquals(ft.ret, sig.result)) return null;
    return { method: entry.method, params: ft.params.slice(), ret: ft.ret };
  }
