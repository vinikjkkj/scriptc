// `R?.("./cfg.json")` — the optional-call spelling of a createRequire
// require, and the last of the thirteen raw call-side guards.
//
// createRequireSpecOf opened with `if (call.questionDotToken) return null;`,
// so the guarded spelling never resolved a specifier at all. What the
// program then got was not a fence about optional chaining: the callee
// fell through to the ordinary identifier path and the diagnostic said
// "the reference to 'R' (a binding form with no lowering)", naming the
// binding the whole createRequire erasure exists to remove. A require
// binding is never nullish — the `?.` cannot short-circuit — so the value
// is the plain require's, and the .json document bakes exactly as 2631's
// does.
//
// The defensive spelling is real code: a module that may or may not be
// running under CommonJS writes `req?.("./x.json")` beside a `req` it
// built once, and the guard is a habit rather than a possibility.
import { createRequire } from "node:module";

const R = createRequire(import.meta.url);

// The optional call and the plain call, on the same document.
const guarded = R?.("./cfg.json") as {
  name: string;
  version: string;
  port: number;
  tags: string[];
  nested: { deep: boolean };
};
const plain = R("./cfg.json") as { name: string; port: number };

console.log("guarded:", guarded.name, guarded.version, guarded.port);
console.log("tags:", guarded.tags.join("+"), "deep:", guarded.nested.deep);
console.log("agrees:", guarded.name === plain.name, guarded.port === plain.port);

// The inline receiver spelling, guarded too.
const inline = createRequire(import.meta.url)?.("./cfg.json") as { port: number };
console.log("inline:", inline.port);

// A bare specifier nothing installed resolves still throws Node's
// catchable MODULE_NOT_FOUND through the guarded spelling — the
// optional-dependency try/require pattern, which is where `?.` shows up.
try {
  R?.("surely-not-installed-anywhere");
  console.log("SHOULD NOT PRINT");
} catch (e) {
  const err = e as NodeJS.ErrnoException;
  console.log("missing:", err.code, `${err.message}`.split("\n")[0]);
}
