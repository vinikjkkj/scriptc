// deepStrictEqual compares [[Prototype]]s by IDENTITY -- that is what makes
// `deepStrictEqual(new A(1), {a: 1})` throw even when the own members match,
// and scr_assert.c asks it as `a->v.obj.proto != b->v.obj.proto`.
//
// The own-key mask let the record->dyn walker DEMOTE a member the source
// only inherited instead of writing it as an own key, and a record had
// nowhere to demote it INTO, so the walker SYNTHESISED a prototype object
// per crossing. Two crossed values of one shape then compared NOT-EQUAL
// where Node -- and a record with no mask -- both say EQUAL. It was loud,
// which is why it shipped; the cheap repair (compare the two prototypes
// structurally when both are anonymous) was refused, because it turns that
// loud failure into a SILENT PASS for two constructors whose prototypes
// happen to hold equal values.
//
// The record carries the SOURCE's own prototype now
// (IrRecordShape.srcproto), so the crossing LINKS one object instead of
// minting one, and identity is restored rather than approximated.
//
// Every line below is Node's answer, and the four together are the test:
// equal values equal, unequal values unequal, a crossed value still not
// equal to a plain literal of its own keys (its prototype differs), and a
// pair of literals unaffected either way.
import * as assert from "node:assert";
import { decode } from "./msg.js";

interface IMsg {
  conversation: string | null;
  albumMessage: string | null;
  label: string;
}

function dse(tag: string, x: unknown, y: unknown): void {
  try {
    assert.deepStrictEqual(x, y);
    console.log(tag + " EQUAL");
  } catch {
    console.log(tag + " NOT-EQUAL");
  }
}

const a = decode("hi") as IMsg;
const b = decode("hi") as IMsg;
const c = decode("bye") as IMsg;
const lit = { conversation: "hi", albumMessage: null, label: "dflt" };

dse("two-crossed-same", a, b);
dse("two-crossed-differ", a, c);
dse("crossed-vs-literal", a, lit);
dse("two-literals", lit, { conversation: "hi", albumMessage: null, label: "dflt" });

// ...and the own-key set the mask exists for is untouched by any of it
console.log(JSON.stringify(Object.keys(a as unknown as Record<string, unknown>)));
console.log(JSON.stringify(a));
console.log(String(a.albumMessage), String(a.label), String(a.conversation));
