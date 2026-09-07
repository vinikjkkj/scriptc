// An OBJECT pattern whose source is CHECKED-DYNAMIC in a TypeScript file --
// `const { code, message } = (error ?? {}) as { code?: unknown; message?:
// unknown }`, the backend-absence classifier in zapo-js 1.8.2's
// `crypto/nativeBackend.ts:73`.
//
// An object type whose every member is `unknown` maps to the dyn wholesale,
// so the initializer of such a site is ALREADY a dyn value: the `as` puts no
// check on it. The JS lane has read those the JS way since it was written --
// one dynKeyGet per bound name -- and TypeScript sources were fenced off it
// on the reasoning that "annotations exist there".
//
// The annotated fix that reasoning points at is a checked cast, and the cast
// is the one rewrite that does NOT preserve the semantics. Measured against
// Node v25.9.0: `const src = (error ?? {}) as { code?: unknown }; src.code`
// answers correctly for an object and TRAPS on a number (`expected object at
// $, got number`) where Node reads `undefined`, because the cast narrows the
// admitted receiver from "any JS value" to "an object". Destructuring is
// precisely the construct JS defines over EVERY non-nullish value, so the
// cast is the wrong shape for it -- and it is also unnecessary, because the
// dyn read answers what Node answers for every receiver kind.
//
// What this pins against Node:
//
//   * the members of an ordinary object, and an ABSENT member reading
//     `undefined`;
//   * NON-OBJECT receivers -- a number, a string, a bool, an array, a
//     function -- every one of which reads `undefined` for a named property
//     rather than throwing (the whole point: JS destructures any non-nullish
//     value, and the cast route did not);
//   * a real `Error` receiver, whose `message` reads through;
//   * a RENAMED element, a DEFAULTED one firing exactly on the undefined
//     read, and the default staying LAZY when the member is present;
//   * the source evaluating ONCE however many names the pattern binds;
//   * `isBackendAbsence` itself, whole, over the eight inputs its callers
//     can hand it.
//
// A binding the checker types CONCRETELY keeps the fence: binding it would
// coerce the dyn into that type, which is a dynCheck that traps where JS
// binds undefined. `{ code?: unknown }` binds dyn, so no check is inserted.

const ABSENCE_TOKENS = {
  napi: ["'@zapo-js/native'", "binding.js", "Cannot find native binding"],
  wasm: ["'@zapo-js/native'", "zapo_native_wasm.js"],
} as const;

type NativeBackendKind = keyof typeof ABSENCE_TOKENS;

function isBackendAbsence(backend: NativeBackendKind, error: unknown): boolean {
  if (error instanceof ReferenceError) {
    return error.message.includes("require is not defined");
  }
  const { code, message } = (error ?? {}) as {
    readonly code?: unknown;
    readonly message?: unknown;
  };
  if (typeof message !== "string") return false;
  const notFound = code === "MODULE_NOT_FOUND" || code === "ERR_MODULE_NOT_FOUND";
  if (!notFound && !message.includes("Cannot find native binding")) return false;
  return ABSENCE_TOKENS[backend].some((token) => message.includes(token));
}

console.log(isBackendAbsence("napi", new ReferenceError("require is not defined")));
console.log(isBackendAbsence("napi", new ReferenceError("something else")));
console.log(isBackendAbsence("napi", new Error("Cannot find module '@zapo-js/native'")));
console.log(isBackendAbsence("napi", { code: "MODULE_NOT_FOUND", message: "Cannot find module '@zapo-js/native'" }));
console.log(isBackendAbsence("napi", { code: "X", message: "Cannot find native binding for '@zapo-js/native'" }));
console.log(isBackendAbsence("wasm", { code: "ERR_MODULE_NOT_FOUND", message: "Cannot find module 'zapo_native_wasm.js'" }));
console.log(isBackendAbsence("wasm", { code: "ERR_MODULE_NOT_FOUND", message: "Cannot find module 'unrelated.js'" }));
console.log(isBackendAbsence("napi", 42));
console.log(isBackendAbsence("napi", "a string"));
console.log(isBackendAbsence("napi", true));
console.log(isBackendAbsence("napi", null));
console.log(isBackendAbsence("napi", undefined));

// The reads themselves, receiver kind by receiver kind. Every one of these
// is `undefined` in Node for a name the value does not carry, and the cast
// route trapped on the first four.
function readTwo(x: unknown): string {
  const { code, message } = x as { readonly code?: unknown; readonly message?: unknown };
  return String(code) + "/" + String(message);
}

console.log(readTwo(42));
console.log(readTwo("a string"));
console.log(readTwo(true));
console.log(readTwo([1, 2, 3]));
console.log(readTwo(readTwo));
console.log(readTwo({}));
console.log(readTwo({ code: "E", message: "m" }));
console.log(readTwo({ code: "E" }));
console.log(readTwo(new Error("boom")));
console.log(readTwo(new TypeError("bad type")));

// A rename, a default that fires on the undefined read, and a default that
// stays LAZY because the member is present.
let evals = 0;
function lazy(): string {
  evals++;
  return "dflt";
}

function readWithDefaults(x: unknown): string {
  const { code: renamed, message = lazy(), extra = lazy() } = x as {
    readonly code?: unknown;
    readonly message?: unknown;
    readonly extra?: unknown;
  };
  return String(renamed) + "/" + String(message) + "/" + String(extra);
}

console.log(readWithDefaults({ code: "C", message: "M", extra: "X" }));
console.log(evals);
console.log(readWithDefaults({ code: "C", message: "M" }));
console.log(evals);
console.log(readWithDefaults({ code: "C" }));
console.log(evals);
console.log(readWithDefaults(7));
console.log(evals);

// The source evaluates ONCE, before any name binds -- three names, one call.
const calls: string[] = [];
function source(tag: string): unknown {
  calls.push(tag);
  return { code: tag, message: "m-" + tag, extra: "e-" + tag };
}

function readThree(x: unknown): string {
  const { code, message, extra } = x as {
    readonly code?: unknown;
    readonly message?: unknown;
    readonly extra?: unknown;
  };
  return String(code) + "/" + String(message) + "/" + String(extra);
}

console.log(readThree(source("a")));
console.log(readThree(source("b")));
console.log(calls.join(","));

// A nullish source throws JS's TypeError -- the CLASS and the catchability
// are the pinned facts here; the message text is a documented divergence
// (Node names the property and the source expression, this runtime names the
// property alone), so only the name is printed.
function tryRead(x: unknown): string {
  try {
    const { code } = x as { readonly code?: unknown };
    return "read " + String(code);
  } catch (e) {
    return "threw " + (e as Error).name;
  }
}

console.log(tryRead({ code: 1 }));
console.log(tryRead(null));
console.log(tryRead(undefined));
