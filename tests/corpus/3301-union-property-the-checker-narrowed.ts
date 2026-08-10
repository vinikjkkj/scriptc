// Reading a property on a union-typed value, where the arms the CHECKER
// proved away are the reason the wide union cannot answer.
//
// A union receiver answers `r.f` when every arm has a same-typed `f`
// (the discriminant read) or when the arms' answers JOIN. Control-flow
// narrowing erases at lowering, so the value still carries every arm the
// binding was declared with — including the ones a guard just excluded.
// `isMedia(content)` leaves `content.media` unanswerable not because the
// media arms disagree but because the arms that are no longer possible
// have no `media` at all.
//
// So the read is tried on the wide union FIRST — nothing that compiles
// today changes — and only when that declines is the value re-tagged into
// the union the checker names at the site. The re-tag is a tag test per
// arm: the arms the checker kept re-wrap, the arms it proved away throw
// the catchable TypeError, and the read that follows switches on the tag.
// There is no unchecked peek anywhere on the path, which matters because
// a user type predicate can lie and this is what happens when it does.
//
// Everything below is behaviour Node and scriptc AGREE on.

interface Img {
  readonly kind: "img";
  readonly media: string;
  readonly width: number;
}
interface Vid {
  readonly kind: "vid";
  readonly media: string;
  readonly seconds: number;
}
interface Txt {
  readonly kind: "txt";
  readonly text: string;
}
type Content = Img | Vid | Txt;

function isMedia(c: Content): c is Img | Vid {
  return c.kind === "img" || c.kind === "vid";
}

// --- the read the narrowing enables: `media` exists on two arms of three

function describe(c: Content): string {
  if (isMedia(c)) {
    return `${c.kind}:${c.media}`;
  }
  return `txt:${c.text}`;
}

console.log(describe({ kind: "img", media: "a.png", width: 4 }));
console.log(describe({ kind: "vid", media: "b.mp4", seconds: 9 }));
console.log(describe({ kind: "txt", text: "hi" }));

// --- the discriminant read itself still answers on the WIDE union, so an
//     early return narrows without any re-tag at all

function tagOf(c: Content): string {
  if (c.kind === "txt") {
    return "none";
  }
  return c.kind;
}

console.log(tagOf({ kind: "img", media: "a.png", width: 4 }));
console.log(tagOf({ kind: "txt", text: "hi" }));

// --- narrowing by an early return, then a read of an arm-only property

function sizeOf(c: Content): number {
  if (c.kind === "txt") {
    return c.text.length;
  }
  if (c.kind === "img") {
    return c.width;
  }
  return c.seconds;
}

console.log(sizeOf({ kind: "img", media: "a.png", width: 4 }));
console.log(sizeOf({ kind: "vid", media: "b.mp4", seconds: 9 }));
console.log(sizeOf({ kind: "txt", text: "hi" }));

// --- the join, not the shared type: the narrowed arms answer DIFFERENT
//     types and the read surfaces as the union of them

interface NumBox {
  readonly kind: "num";
  readonly v: number;
  readonly n: number;
}
interface StrBox {
  readonly kind: "str";
  readonly v: string;
  readonly s: string;
}
interface NoBox {
  readonly kind: "no";
}
type Box = NumBox | StrBox | NoBox;

function isBoxed(b: Box): b is NumBox | StrBox {
  return b.kind !== "no";
}

function show(b: Box): void {
  if (isBoxed(b)) {
    console.log("boxed", b.v, b.v === 1, b.v === "one");
    return;
  }
  console.log("unboxed");
}

show({ kind: "num", v: 1, n: 1 });
show({ kind: "str", v: "one", s: "one" });
show({ kind: "no" });

// --- the receiver is evaluated exactly ONCE, re-tag included

let calls = 0;
function pick(c: Content): Content {
  calls = calls + 1;
  return c;
}

console.log(describe(pick({ kind: "img", media: "once.png", width: 1 })), calls);

// (A LYING predicate — one that returns a truth the value does not have
// — cannot be tested differentially: Node reads undefined off the object
// while scriptc throws the stranded arm's catchable TypeError. That is
// covered scriptc-only in tests/harness/dyncheck.test.ts.)

console.log("done");
