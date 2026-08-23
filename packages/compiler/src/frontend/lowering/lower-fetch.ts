/* The static `fetch` surface: the call, the Response handle, and the
 * Headers view (scr_fetch_static.c).
 *
 * Until this file existed, every `fetch(...)` in a static build was its own
 * SC2012 — the ambient global lives behind requireDynamicApi — and the two
 * types the call answers had no static representation either. The refusal
 * moved rather than shrank if either half landed alone: map the types and
 * it reappears at the call; lower the call and it reappears at the
 * Response the call answers. They land together.
 *
 * `RequestInit` and `Request` are NOT mapped, and that is deliberate: an
 * options record carrying `typeof fetch` (zapo's
 * `WaFetchVersionOptions`) still refuses through them. Mapping the two
 * types would let the record compile and would then surface the rest of
 * that function as NEW refusals at sites that do not exist today —
 * `options.fetch ?? fetch` needs a builtin to have a first-class closure
 * form, and `(init as { dispatcher?: unknown }).dispatcher = ...` is the
 * assignment-target family. The whole group has to land at once, for the
 * reason lower-abort.ts's header gives about the same shape of family:
 * lower the visible members alone and the hidden ones surface, so it gets
 * worse before it gets better.
 *
 * WHAT IS LOWERED
 *   fetch(url)                       a string OR a URL value (not a
 *                                    `string | URL` UNION — that union has
 *                                    no static representation yet, SC2001)
 *   fetch(url, <object literal>)     method / headers / body / signal
 *   response.ok / .status / .statusText / .url / .redirected / .bodyUsed
 *   response.headers                 the Headers view
 *   response.text() / .json() / .arrayBuffer() / .bytes()
 *   headers.get(name) / .has(name)
 *
 * WHAT IS NOT, and why each is a refusal rather than an invention:
 *   - a NON-LITERAL init. The options-record stance (lower-builtins.ts's
 *     fs.createReadStream comment): the runtime call has one fixed shape
 *     whose absent members are sentinels, so the compiler has to know
 *     every key the program wrote. Handed an opaque init it would have to
 *     ignore the keys it cannot see, and an ignored `signal` is a fetch
 *     that never aborts — silently.
 *   - `response.body`. It is a ReadableStream in Node, this slice has no
 *     stream body, and answering `null` (the shape a bodyless response
 *     really has) for a response that HAS one would be a wrong value.
 *   - `new Response(...)` / `new Headers(...)` / `Request`. Nothing in
 *     reach constructs one, and a constructor that silently dropped its
 *     init would be worse than the fence.
 *   - `headers.forEach` / `entries` / `keys` / `values` / `getSetCookie`.
 *     Not needed by anything reachable, and each is its own iteration
 *     protocol.
 *   - `typeof fetch` AS A TYPE. `fetch` as a VALUE now lowers -- see
 *     lower-fnvalue.ts, which mints the interned zero-capture closure
 *     `String`/`Number`/`Boolean` already had -- but its value form is
 *     `(input: string) => Promise<Response>`, arity ONE, because `init`
 *     has no static representation. The TYPE is not mapped to that
 *     narrower signature: doing so would let zapo's
 *     `WaFetchVersionOptions` record compile and would then turn every
 *     two-argument call through the field into a NEW refusal inside a
 *     body that produces none today. So zapo's own
 *     `options.fetch ?? fetch` still does not compile, and it is the
 *     record's `typeof fetch` that stops it, not the value form.
 */
import * as ts from "../ts7/adapter.js";
import type { Lowerer } from "./lowerer.js";
import { locOf } from "../program.js";
import {
  arrayOf,
  BOOL,
  BYTES_U8,
  DYN,
  F64,
  HEADERS_T,
  IrExpr,
  IrType,
  NULL_T,
  REQUESTINIT_T,
  RESPONSE_T,
  SrcLoc,
  STRING,
} from "../../ir/nodes.js";
import { fenceOrDropOptionKey } from "./surfaces.js";

const RESPONSE_HINT =
  "ok, status, statusText, url, redirected, bodyUsed, headers, and " +
  "text()/json()/arrayBuffer()/bytes() are the supported Response members";
const HEADERS_HINT = "get(name) and has(name) are the supported Headers members";

/** fetch's documented `init` keys (the WHATWG Request class's own member
 * list, which is what undici's RequestInit spells). A documented key this
 * slice does not lower fences BY NAME; an undocumented one drops exactly
 * as Node drops it. */
const FETCH_INIT_DOCUMENTED_OPTIONS: ReadonlySet<string> = new Set([
  "body", "cache", "credentials", "duplex", "headers", "integrity",
  "keepalive", "method", "mode", "priority", "redirect", "referrer",
  "referrerPolicy", "signal", "window", "dispatcher",
]);

const INIT_HINT = "method, headers, body and signal are the lowered fetch init options";

const INIT_POINTED_HINTS: Record<string, string | undefined> = {
  redirect:
    "this fetch always follows redirects (fetch's 20-hop default); " +
    "'manual' and 'error' would need the hop to stop mid-flight",
  cache: "there is no HTTP cache in this runtime, so every mode but the default would be a lie",
  credentials: "no cookie jar exists here, so 'include' could not include anything",
  keepalive: "there is no connection pool: every request dials its own socket",
  // MEASURED against Node v25.9.0, not assumed: a plain object with a
  // `dispatch` method really is honoured — `fetch(url, { dispatcher })`
  // calls it with (opts, handler) and waits for the handler's callbacks.
  // So there is nothing to drop quietly here; honouring it would mean
  // driving undici's handler protocol from a compiled program.
  //
  // The hint used to send the reader to NODE_USE_ENV_PROXY. That is true
  // of the ISLAND fetch (scr_fetch.c reads it, matching undici's
  // EnvHttpProxyAgent) and FALSE of this one: scr_fetch_static.c dials
  // the origin itself and has no proxy path at all — a fact this file's
  // header already states one line further down about CONNECT. Pointing
  // at an environment variable that changes nothing is worse than saying
  // there is no proxy support, so it says that.
  dispatcher:
    "undici's dispatcher is an engine object driving a callback protocol " +
    "(dispatch(opts, handler)), and Node really does call it — there is no static " +
    "representation for one; this build's fetch dials the origin directly and has " +
    "no proxy path, environment-configured or otherwise",
};

/** The URL argument. `string` passes through; a `URL` value serializes
 * through url.href, which is exactly what fetch does with one. */
function urlArg(L: Lowerer, node: ts.Expression, loc: SrcLoc): IrExpr {
  const lowered = L.lowerExpr(node);
  if (lowered.type.kind === "string") return lowered;
  if (lowered.type.kind === "url") {
    return { kind: "libCall", fn: "url.href", args: [lowered], type: STRING, loc };
  }
  L.badType(node, L.typeOf(node));
}

interface Init {
  method: IrExpr | null;
  /** True when `body` was WRITTEN as a string rather than as bytes —
   * fetch's content-type derivation reads the BodyInit's kind, which the
   * encoded bytes no longer carry. */
  bodyText: boolean;
  /** A flat [name, value, ...] string array (the object-literal form) or
   * a dyn (the `Record<string, string>` VALUE form) — never both. */
  headerPairs: IrExpr | null;
  headerDyn: IrExpr | null;
  body: IrExpr | null;
  signal: IrExpr | null;
}

/** The `headers` value. Two shapes reach the wire:
 *
 *   an OBJECT LITERAL   flattened here into [name, value, ...] so the
 *                       keys are compile-time known and a dashed key
 *                       ("content-type") needs no quoting story.
 *   anything else       coerced to a checked-dynamic value and walked at
 *                       runtime (scr_fetch_headers_from_dyn). This is the
 *                       `Record<string, string>` VARIABLE form, which is
 *                       what real code writes when it merges defaults.
 *
 * A `Headers` value is refused rather than accepted: this slice cannot
 * build one, so the only Headers in reach is a RESPONSE's, and forwarding
 * a response's headers into a request is a mistake worth naming. */
function headersValue(L: Lowerer, node: ts.Expression, into: Init, loc: SrcLoc): void {
  if (ts.isObjectLiteralExpression(node)) {
    const parts: IrExpr[] = [];
    for (const p of node.properties) {
      if (!ts.isPropertyAssignment(p)) {
        L.noLowering("a spread or shorthand key in a fetch headers literal", p,
          "{ 'name': value } entries are the lowered form");
      }
      const name = p.name;
      let key: IrExpr;
      if (ts.isIdentifier(name)) {
        key = { kind: "strLit", value: name.text, type: STRING, loc: locOf(name) };
      } else if (ts.isStringLiteralLike(name)) {
        key = { kind: "strLit", value: name.text, type: STRING, loc: locOf(name) };
      } else {
        L.noLowering("a computed key in a fetch headers literal", p,
          "the header name must be written, so the request head is known at compile time");
      }
      const v = L.lowerExpr(p.initializer);
      if (v.type.kind !== "string") L.badType(p.initializer, L.typeOf(p.initializer));
      parts.push(key, v);
    }
    into.headerPairs = { kind: "arrayLit", elems: parts, type: arrayOf(STRING), loc };
    return;
  }
  const lowered = L.lowerExpr(node);
  if (lowered.type.kind === "headers") {
    L.noLowering("a Response's Headers as a fetch request's headers", node,
      "spell the request's headers as a record — a response header list carries " +
      "hop-by-hop fields (content-length, content-encoding) that must not be resent");
  }
  if (lowered.type.kind === "dyn") {
    into.headerDyn = lowered;
    return;
  }
  // The static→dyn deep copy coerceToExpected applies at any 'unknown'
  // slot: the runtime walks the copy's own keys, so nothing aliases the
  // caller's record and a later write to it cannot change a request
  // already on the wire.
  if (!L.dynConvertible(lowered.type)) L.badType(node, L.typeOf(node));
  into.headerDyn = { kind: "dynFrom", value: lowered, type: DYN, loc };
}

/** The init OBJECT LITERAL, walked key by key. */
function initLiteral(L: Lowerer, node: ts.Expression, loc: SrcLoc): Init {
  const into: Init = { method: null, bodyText: false, headerPairs: null, headerDyn: null, body: null, signal: null };
  if (!ts.isObjectLiteralExpression(node)) {
    L.noLowering("fetch with a computed init argument", node,
      "an object literal is the lowered form: the request has one fixed shape and " +
      "an option this compiler cannot see would be an option silently dropped");
  }
  for (const p of node.properties) {
    if (!ts.isPropertyAssignment(p) || !ts.isIdentifier(p.name)) {
      if (ts.isShorthandPropertyAssignment(p) && ts.isIdentifier(p.name)) {
        // `{ signal }` — the shorthand is the same entry with the same name.
        const key = p.name.text;
        const value = p.name;
        applyKey(L, p, key, value, into, loc);
        continue;
      }
      L.noLowering("a spread or computed key in a fetch init literal", p,
        "{ method, headers, body, signal } entries are the lowered form");
    }
    applyKey(L, p, p.name.text, p.initializer, into, loc);
  }
  return into;
}

function applyKey(
  L: Lowerer,
  prop: ts.ObjectLiteralElementLike,
  key: string,
  value: ts.Expression,
  into: Init,
  loc: SrcLoc,
): void {
  switch (key) {
    case "method": {
      const v = L.lowerExpr(value);
      if (v.type.kind !== "string") L.badType(value, L.typeOf(value));
      into.method = v;
      return;
    }
    case "headers":
      headersValue(L, value, into, loc);
      return;
    case "body": {
      const v = L.lowerExpr(value);
      if (v.type.kind === "string") {
        // utf8 — fetch's encoding for a string body, and the same
        // conversion `Buffer.from(s)` makes, so it reuses that row rather
        // than minting a second one.
        const enc: IrExpr = { kind: "strLit", value: "utf8", type: STRING, loc };
        into.body = { kind: "libCall", fn: "buffer.fromStr", args: [v, enc], type: BYTES_U8, loc };
        into.bodyText = true;
        return;
      }
      if (v.type.kind === "bytes") {
        into.body = v;
        return;
      }
      L.noLowering("a fetch body that is not a string or a Uint8Array", value,
        "string and Uint8Array/Buffer bodies are lowered; FormData, URLSearchParams and " +
        "streams each need a body representation this slice does not have");
    }
    case "signal": {
      const v = L.lowerExpr(value);
      if (v.type.kind !== "abortSignal") L.badType(value, L.typeOf(value));
      into.signal = v;
      return;
    }
    default:
      fenceOrDropOptionKey(L, prop, key, "fetch init", FETCH_INIT_DOCUMENTED_OPTIONS, INIT_HINT, INIT_POINTED_HINTS);
  }
}

/** The two arguments every fetch entry point takes ahead of the optional
 * body and signal. Factored out because THREE spellings now build them —
 * the call with a literal init, the call with no init, and the
 * `RequestInit` VALUE constructor — and a fourth copy of the "GET" default
 * or of the header-fold choice is exactly how two spellings of one request
 * start diverging. */
function initHead(init: Init, loc: SrcLoc): { method: IrExpr; headers: IrExpr } {
  const method: IrExpr = init.method ?? { kind: "strLit", value: "GET", type: STRING, loc };
  // The header list is built by the runtime in both arms so the names are
  // folded in exactly one place: a literal's written names go through
  // _normalize, a record VALUE through _from_dyn.
  const headers: IrExpr =
    init.headerPairs !== null
      ? { kind: "libCall", fn: "fetch.headersNorm", args: [init.headerPairs], type: arrayOf(STRING), loc }
      : init.headerDyn !== null
        ? { kind: "libCall", fn: "fetch.headersFromDyn", args: [init.headerDyn], type: arrayOf(STRING), loc }
        : { kind: "arrayLit", elems: [], type: arrayOf(STRING), loc };
  return { method, headers };
}

/** An object literal in a `RequestInit` SLOT — `const init: RequestInit =
 * { … }`, an argument at a `RequestInit` parameter, a field of that type.
 * Null for every other literal, so lowerObjectLiteral keeps its record
 * path.
 *
 * The value is the SAME walk the call-site literal takes (initLiteral), so
 * `fetch(url, { … })` and `const i: RequestInit = { … }; fetch(url, i)`
 * cannot describe two different requests — one walk, one set of key
 * fences, one folded form. What is stored is that folded form, which is
 * why no member of the result can be read back: see requestInitMemberFence.
 *
 * The contextual type may be `RequestInit | undefined` (an optional
 * parameter's slot), which is the union the arm below accepts as well. */
export function lowerRequestInitLiteral(
  L: Lowerer,
  expr: ts.ObjectLiteralExpression,
  ctxType: ts.Type | undefined,
): IrExpr | null {
  if (L.dynamic || ctxType === undefined) return null;
  const mapped = L.mapTypeOf(ctxType);
  if (mapped === null) return null;
  const isInit =
    mapped.kind === "requestInit" ||
    (mapped.kind === "union" &&
      (L.unions.get(mapped.unionId)?.arms ?? []).some((a) => a.kind === "requestInit"));
  if (!isInit) return null;
  const loc = locOf(expr);
  const init = initLiteral(L, expr, loc);
  const { method, headers } = initHead(init, loc);
  const hasBody = init.body !== null;
  const hasSignal = init.signal !== null;
  const fn = hasBody
    ? hasSignal
      ? "fetch.initNewBodySignal"
      : "fetch.initNewBody"
    : hasSignal
      ? "fetch.initNewSignal"
      : "fetch.initNew";
  const args: IrExpr[] = [method, headers];
  if (hasBody) args.push(init.body!, { kind: "boolLit", value: init.bodyText, type: BOOL, loc });
  if (hasSignal) args.push(init.signal!);
  return { kind: "libCall", fn, args, type: REQUESTINIT_T, loc };
}

/** Every member of a `RequestInit` value is a refusal, and this is the
 * one place that says so.
 *
 * It is NOT an omission. What the value holds is the FOLDED request head —
 * header names already lowercased and flattened into the wire list, a
 * string body already utf8-encoded — so `init.headers` would answer a
 * string array where the program wrote a record, and `init.body` a byte
 * array where it wrote a string. A read that answers something other than
 * what was written is the failure this whole slice is built to avoid, so
 * the read refuses and names the member.
 *
 * A WRITE lands here too, and `dispatcher` is the one that matters:
 * `(init as { dispatcher?: unknown }).dispatcher = d` is how a program
 * configures an undici proxy, Node v25.9.0 really does call that object's
 * `dispatch(opts, handler)` — measured, not assumed — and there is no
 * static representation for an engine object implementing undici's handler
 * protocol. Dropping the key would be a proxy silently ignored. */
export function requestInitMemberFence(L: Lowerer, node: ts.Node, name: string): never {
  const pointed = INIT_POINTED_HINTS[name];
  L.noLowering(
    `RequestInit.${name}`,
    node,
    pointed ??
      "a RequestInit value carries the FOLDED request head (lowercased header pairs, an " +
      "encoded body), not the members as they were written, so no member of one reads back; " +
      "write the options at the fetch call site instead",
  );
}

/** A WRITE to a member of a RequestInit value, THROUGH an assertion or
 * not: `(init as { dispatcher?: unknown }).dispatcher = d`.
 *
 * The assertion is why this needs its own test. `typeOf` on the receiver
 * answers the ASSERTED shape — an ordinary record — so nothing downstream
 * can tell what is being written to, and the write falls all the way to
 * "assignment to non-variables", a message that names neither the value
 * nor the reason. Peeling the assertions is what lets the refusal say
 * `RequestInit.dispatcher` and carry the pointed hint. Returns null when
 * the receiver is not a RequestInit, so every other write keeps its own
 * path. */
export function requestInitWriteFence(
  L: Lowerer,
  target: ts.PropertyAccessExpression,
): null {
  let recv: ts.Expression = target.expression;
  for (;;) {
    if (ts.isParenthesizedExpression(recv)) { recv = recv.expression; continue; }
    if (ts.isAsExpression(recv)) { recv = recv.expression; continue; }
    break;
  }
  if (L.mapTypeOf(L.typeOf(recv))?.kind !== "requestInit") return null;
  requestInitMemberFence(L, target, target.name.text);
}

/** USER-code `fetch(url)` / `fetch(url, init)` in a STATIC build.
 * Provenance, not the name: a user's own `fetch` never matches. Null for
 * anything that is not THE ambient fetch, so lowerCall keeps trying — and
 * null under --dynamic, where lowerFetchCall (lower-island.ts) still owns
 * the site and the island still mints the Response. */
export function lowerStaticFetchCall(L: Lowerer, call: ts.CallExpression): IrExpr | null {
  if (L.dynamic) return null;
  const callee = call.expression;
  if (!ts.isIdentifier(callee) || callee.text !== "fetch") return null;
  if (L.chainBlocked(call)) return null;
  const symbol = L.resolveValueSymbol(callee);
  if (symbol === null || symbol === undefined || !L.isStdlibSymbol(symbol)) return null;
  const loc = locOf(call);
  if (call.arguments.length < 1 || call.arguments.length > 2) {
    L.noLowering(
      `fetch with ${call.arguments.length} argument${call.arguments.length === 1 ? "" : "s"}`,
      call,
      "fetch(url) and fetch(url, init) are the shapes",
    );
  }
  const url = urlArg(L, call.arguments[0]!, loc);
  // `fetch(url, initValue)` — the init held as a VALUE rather than written
  // at the call. One entry point, and it unpacks into the same transfer:
  // the two spellings cannot describe different requests.
  if (call.arguments.length === 2) {
    const argT = L.mapTypeOf(L.typeOf(call.arguments[1]!));
    if (argT !== null && argT.kind === "requestInit") {
      return {
        kind: "libCall",
        fn: "fetch.goInit",
        args: [url, L.lowerExpr(call.arguments[1]!)],
        type: { kind: "promise", inner: RESPONSE_T },
        loc,
      };
    }
  }
  const init =
    call.arguments.length === 2
      ? initLiteral(L, call.arguments[1]!, loc)
      : { method: null, bodyText: false, headerPairs: null, headerDyn: null, body: null, signal: null };

  const { method, headers } = initHead(init, loc);
  // Four entry points rather than sentinel arguments, the abort.abort /
  // abort.abortReason precedent: an omitted body is not an empty one (a
  // POST with `content-length: 0` is a different request from a GET), and
  // an omitted signal is not an unaborted one.
  const hasBody = init.body !== null;
  const hasSignal = init.signal !== null;
  const fn = hasBody
    ? hasSignal
      ? "fetch.goBodySignal"
      : "fetch.goBody"
    : hasSignal
      ? "fetch.goSignal"
      : "fetch.go";
  const args: IrExpr[] = [url, method, headers];
  if (hasBody) args.push(init.body!, { kind: "boolLit", value: init.bodyText, type: BOOL, loc });
  if (hasSignal) args.push(init.signal!);
  return { kind: "libCall", fn, args, type: { kind: "promise", inner: RESPONSE_T }, loc };
}

/** Property reads on a response / headers receiver. Null for every other
 * receiver, so the property chain keeps trying. */
export function lowerFetchProperty(L: Lowerer, expr: ts.PropertyAccessExpression): IrExpr | null {
  const kind = L.mapTypeOf(L.typeOf(expr.expression))?.kind;
  if (kind === "requestInit") requestInitMemberFence(L, expr, expr.name.text);
  if (kind !== "response" && kind !== "headers") return null;
  if (!L.isStdlibMember(expr)) return null;
  const name = expr.name.text;
  const loc = locOf(expr);
  if (kind === "headers") {
    if (name === "get" || name === "has") {
      L.unsupported("SC1090", expr, `Headers.${name} as a value (call it directly)`);
    }
    L.noLowering(`Headers.${name}`, expr, HEADERS_HINT, L.checker.getSymbolAtLocation(expr.name));
  }
  const receiver = (): IrExpr => L.lowerExpr(expr.expression);
  switch (name) {
    case "ok":
      return { kind: "libCall", fn: "resp.ok", args: [receiver()], type: BOOL, loc };
    case "status":
      return { kind: "libCall", fn: "resp.status", args: [receiver()], type: F64, loc };
    case "statusText":
      return { kind: "libCall", fn: "resp.statusText", args: [receiver()], type: STRING, loc };
    case "url":
      return { kind: "libCall", fn: "resp.url", args: [receiver()], type: STRING, loc };
    case "redirected":
      return { kind: "libCall", fn: "resp.redirected", args: [receiver()], type: BOOL, loc };
    case "bodyUsed":
      return { kind: "libCall", fn: "resp.bodyUsed", args: [receiver()], type: BOOL, loc };
    case "headers":
      return { kind: "libCall", fn: "resp.headers", args: [receiver()], type: HEADERS_T, loc };
    case "body":
      // Node answers a ReadableStream (or null for a bodyless response).
      // This slice has neither, and `null` for a response that HAS a body
      // is the wrong VALUE rather than a missing feature.
      L.noLowering("Response.body", expr,
        "this build has no ReadableStream body — read the body with " +
        "text(), json(), arrayBuffer() or bytes()");
      break;
    case "text":
    case "json":
    case "arrayBuffer":
    case "bytes":
    case "clone":
    case "formData":
    case "blob":
      L.unsupported("SC1090", expr, `Response.${name} as a value (call it directly)`);
      break;
    default:
      break;
  }
  L.noLowering(`Response.${name}`, expr, RESPONSE_HINT, L.checker.getSymbolAtLocation(expr.name));
}

/** Method calls on a response / headers receiver. */
export function lowerFetchMethodCall(
  L: Lowerer,
  call: ts.CallExpression,
  access: ts.PropertyAccessExpression,
): IrExpr | null {
  if (L.chainBlocked(call, access)) return null;
  const kind = L.mapTypeOf(L.typeOf(access.expression))?.kind;
  if (kind !== "response" && kind !== "headers") return null;
  if (!L.isStdlibMember(access)) return null;
  const name = access.name.text;
  const loc = locOf(call);
  if (kind === "headers") {
    if (name === "get" || name === "has") {
      if (call.arguments.length !== 1) {
        L.noLowering(`Headers.${name} with ${call.arguments.length} arguments`, call,
          `${name}(name) is the shape`);
      }
      const receiver = L.lowerExpr(access.expression);
      const arg = L.lowerExpr(call.arguments[0]!);
      if (arg.type.kind !== "string") L.badType(call.arguments[0]!, L.typeOf(call.arguments[0]!));
      // get answers `string | null` — Node's absent arm is null, not "".
      if (name === "get") {
        const type: IrType = { kind: "union", unionId: L.unions.intern([STRING, NULL_T]) };
        return { kind: "libCall", fn: "headers.get", args: [receiver, arg], type, loc };
      }
      return { kind: "libCall", fn: "headers.has", args: [receiver, arg], type: BOOL, loc };
    }
    L.noLowering(`Headers.${name}`, call, HEADERS_HINT, L.checker.getSymbolAtLocation(access.name));
  }
  const body = (fn: "resp.text" | "resp.json" | "resp.arrayBuffer" | "resp.bytes", inner: IrType): IrExpr => {
    if (call.arguments.length !== 0) {
      L.noLowering(`Response.${name} with ${call.arguments.length} arguments`, call, `${name}() takes none`);
    }
    const receiver = L.lowerExpr(access.expression);
    return { kind: "libCall", fn, args: [receiver], type: { kind: "promise", inner }, loc };
  };
  switch (name) {
    case "text":
      return body("resp.text", STRING);
    case "json":
      // Node's `json()` answers the parsed document: `any` there, a
      // checked-dynamic value here, narrowed at the program's own read.
      return body("resp.json", DYN);
    case "arrayBuffer":
      return body("resp.arrayBuffer", BYTES_U8);
    case "bytes":
      return body("resp.bytes", BYTES_U8);
    default:
      break;
  }
  L.noLowering(`Response.${name}`, call, RESPONSE_HINT, L.checker.getSymbolAtLocation(access.name));
}
