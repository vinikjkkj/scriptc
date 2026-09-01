// An optional chain whose CHECKER result is `any`, and the parsers that read
// one. Both refused, and the second refusal blamed the wrong expression.
//
// `Array.isArray(x)` is declared `arg is any[]`, so narrowing a union whose
// array arm is `readonly BinaryNode[]` produces `any[]`: `find()` then
// answers `any` and every `?.` off it is checker-typed `any` — while the
// compiler's own types stay right (the emitted C binds the find's result as
// the `T | undefined` union it is). finishOptionalChain read the CHECKER's
// type for the chain RESULT, got dyn, and dyn is not a union with an
// undefined arm, so the chain fenced SC1090.
//
// Downstream of that, `Number.parseInt(error?.attrs.code ?? '', 10)` — zapo's
// WaWamUploader retry predicate — reported SC2012 on parseInt, which lowers
// that argument perfectly well: the argument's own refusal poisoned the
// probe and the parser fenced in its place. ECMA 19.2.5 step 1 is
// `inputString = ToString(string)`, so the dyn argument coerces and runs the
// same parser the string arm runs; the radix cases below are what makes that
// checkable rather than plausible.

interface BinaryNode {
  readonly tag: string;
  readonly attrs: Readonly<Record<string, string>>;
  readonly content?: Uint8Array | string | readonly BinaryNode[];
}

const withError: BinaryNode = {
  tag: "iq",
  attrs: { id: "a" },
  content: [
    { tag: "other", attrs: { k: "v" } },
    { tag: "error", attrs: { code: "503", text: "busy" } },
  ],
};
const withoutError: BinaryNode = { tag: "iq", attrs: { id: "b" }, content: [{ tag: "other", attrs: {} }] };
const emptyContent: BinaryNode = { tag: "iq", attrs: { id: "c" }, content: [] };

// 1. the chain's short-circuit and its present arm, through an index read
function attrOf(node: BinaryNode, tag: string, key: string): string {
  if (!Array.isArray(node.content)) return "no-content";
  const found = node.content.find((child) => child.tag === tag);
  return String(found?.attrs[key]);
}
console.log("a1 " + attrOf(withError, "error", "code"));
console.log("a2 " + attrOf(withError, "error", "nosuchkey"));
console.log("a3 " + attrOf(withoutError, "error", "code"));
console.log("a4 " + attrOf(emptyContent, "error", "code"));

// 2. a DECLARED field off the chain, not an index-signature read
function tagOf(node: BinaryNode, tag: string): string {
  if (!Array.isArray(node.content)) return "no-content";
  const found = node.content.find((child) => child.tag === tag);
  return String(found?.tag);
}
console.log("a5 " + tagOf(withError, "error"));
console.log("a6 " + tagOf(withoutError, "error"));

// 3. `??` over the chain
function codeOr(node: BinaryNode, tag: string, fallback: string): string {
  if (!Array.isArray(node.content)) return "no-content";
  const found = node.content.find((child) => child.tag === tag);
  return String(found?.attrs.code ?? fallback);
}
console.log("a7 " + codeOr(withError, "error", "none"));
console.log("a8 " + codeOr(withoutError, "error", "none"));

// 4. typeof over both arms
function typeOfCode(node: BinaryNode, tag: string): string {
  if (!Array.isArray(node.content)) return "no-content";
  const found = node.content.find((child) => child.tag === tag);
  return typeof found?.attrs.code;
}
console.log("a9 " + typeOfCode(withError, "error"));
console.log("a10 " + typeOfCode(withoutError, "error"));
console.log("a11 " + typeOfCode(withError, "nosuchtag"));

// 5. the consumer's own predicate, end to end
function isRetryable(result: BinaryNode): boolean {
  if (!Array.isArray(result.content)) return false;
  const error = result.content.find((child) => child.tag === "error");
  const code = Number.parseInt(error?.attrs.code ?? "", 10);
  return Number.isFinite(code) && code >= 500;
}
console.log("b1 " + String(isRetryable(withError)));
console.log("b2 " + String(isRetryable(withoutError)));
console.log("b3 " + String(isRetryable({ tag: "iq", attrs: {}, content: "text" })));
console.log("b4 " + String(isRetryable({ tag: "iq", attrs: {}, content: [{ tag: "error", attrs: { code: "404" } }] })));
console.log("b5 " + String(isRetryable({ tag: "iq", attrs: {}, content: [{ tag: "error", attrs: { code: "abc" } }] })));
console.log("b6 " + String(isRetryable({ tag: "iq", attrs: {}, content: [{ tag: "error", attrs: {} }] })));
console.log("b7 " + String(isRetryable({ tag: "iq", attrs: {}, content: [{ tag: "error", attrs: { code: "  700  " } }] })));
console.log("b8 " + String(isRetryable({ tag: "iq", attrs: {}, content: [{ tag: "error", attrs: { code: "0x1f4" } }] })));
console.log("b9 " + String(isRetryable({ tag: "iq", attrs: {}, content: [{ tag: "error", attrs: { code: "503abc" } }] })));
console.log("b10 " + String(isRetryable({ tag: "iq", attrs: {}, content: [{ tag: "error", attrs: { code: "+501" } }] })));
console.log("b11 " + String(isRetryable({ tag: "iq", attrs: {}, content: [{ tag: "error", attrs: { code: "5e2" } }] })));

// 6. the radices that disagree, with the GLOBAL parseInt spelling as the
// control — the two roads to one parser must print the same bytes.
function parses(node: BinaryNode): string {
  if (!Array.isArray(node.content)) return "no-content";
  const found = node.content.find((child) => child.tag === "error");
  const s = found?.attrs.code ?? "";
  return (
    String(Number.parseInt(s, 10)) +
    "/" +
    String(Number.parseInt(s, 16)) +
    "/" +
    String(Number.parseInt(s, 8)) +
    "/" +
    String(parseInt(String(s), 10))
  );
}
console.log("c1 " + parses(withError));
console.log("c2 " + parses(withoutError));
console.log("c3 " + parses({ tag: "iq", attrs: {}, content: [{ tag: "error", attrs: { code: "19" } }] }));

// 7. Number.parseFloat over the same shape
function floats(node: BinaryNode): string {
  if (!Array.isArray(node.content)) return "no-content";
  const found = node.content.find((child) => child.tag === "error");
  return String(Number.parseFloat(found?.attrs.code ?? ""));
}
console.log("d1 " + floats(withError));
console.log("d2 " + floats(withoutError));
console.log("d3 " + floats({ tag: "iq", attrs: {}, content: [{ tag: "error", attrs: { code: "3.25rem" } }] }));
