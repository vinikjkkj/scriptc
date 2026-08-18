// @dynamic
// The sibling of 4681, one module boundary away — and the case the first
// spelling of the name table got WRONG.
//
// A declared function IMPORTED from another module does not carry its own
// TS name in the IR: it carries the module qualifier too (`%m0.libFn`).
// A rule that declined every '%'-prefixed or dotted name — which is the
// right stance for a class member, whose accessor forms spell their JS
// name `get x` with a space — declined this as well, and `libFn` came out
// `[Function (anonymous)]` while `libArrow` beside it came out right.
//
// The qualifier is the COMPILER's and the tail is the PROGRAM's, so the
// tail is the answer. Nothing else about the shape changes.
//
// The layout is part of the answer too: node breaks an object across
// lines at a width, and one wrong name is long enough to move the whole
// literal onto four lines. This program prints on one line in node.
import { libFn, libArrow, libNamed } from "./helpers.ts";

function show(v: unknown): void { console.log(v); }

show({ a: libFn, b: libArrow, c: (n: number): number => n });
show({ d: libNamed });
show(libFn(1) + libArrow(2) + libNamed(3));
