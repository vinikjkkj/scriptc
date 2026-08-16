// The UNIT arm of the same read. `content?:` puts an `undefined` arm in the
// union, and the read only reaches this lowering because the checker's picture
// (`any`) is wider than the value's — so the undefined arm is exactly the one
// sound narrowing proves away.
//
// It does NOT answer a made-up number and it does NOT keep the compile fence:
// it takes the stranded-arm stance the union re-tag helper already draws, and
// throws the CATCHABLE TypeError Node throws, word for word. This fixture
// exists to pin that wording, and to prove the throw is catchable by ordinary
// `try/catch` — the compiled program has to agree with Node on the message,
// not merely on "it failed".
interface Frame {
  readonly tag: string;
  readonly body?: Uint8Array | string | readonly Frame[];
}

function firstChildBodyLength(f: Frame): string {
  if (!Array.isArray(f.body)) return "not-a-list";
  for (const child of f.body) {
    try {
      return "len=" + String(child.body.length);
    } catch (e) {
      return "threw: " + (e as Error).message;
    }
  }
  return "empty";
}

console.log(firstChildBodyLength({ tag: "a", body: [{ tag: "b", body: "xy" }] }));
console.log(firstChildBodyLength({ tag: "a", body: [{ tag: "b", body: [{ tag: "c" }] }] }));
console.log(firstChildBodyLength({ tag: "a", body: [{ tag: "b" }] }));
console.log(firstChildBodyLength({ tag: "a", body: "z" }));
console.log(firstChildBodyLength({ tag: "a", body: [] }));
