// A record's OWN KEY SET, on every surface that asks and every boundary the
// value can reach - for the constructions where the compiler and Node agree.
//
// `{a?: T}` and `{a: T | undefined}` intern to ONE record shape (the field
// is an undefined-armed union either way, and IrRecordShape.fields carries
// no optionality mark), so an omitted key and a key holding `undefined` have
// exactly ONE representation and the compiler must answer them the same. It
// answers ABSENT - the omission is the common construction, and it is the
// answer the record's own Object.keys has always given (tests/corpus/3713).
//
// That stance is only defensible while the ABSENT half is right everywhere,
// which is what this program is. Every line here is Node v25.9.0's answer:
//
//   * the control, every key written        - nothing may ever filter these
//   * keys simply not written               - Node has no such property
//   * presence decided at RUN TIME by a conditional spread, both ways
//
// crossed with five boundaries (the record's own type; a parameter; a
// return; an array element; a record field) and seven surfaces (keys,
// getOwnPropertyNames, hasOwn, `in`, for-in, JSON, Object.assign).
//
// The construction this file does NOT contain is the one the stance costs:
// a field written `b: undefined` BY HAND. Node keeps that key and this
// compiler drops it, on keys / getOwnPropertyNames / hasOwn / `in` / for-in,
// at the record's own type as much as across a widening boundary - measured
// at 50 divergent cells of a 240-cell population, every one of them SILENT.
// Closing it needs a per-instance "was written" bit, which is a
// representation change and not a fence; see estado-perinstance.md. It is
// left out here rather than pinned, because a corpus program is compared
// against Node byte for byte and this one has to stay green.

interface W {
  a?: number;
  b?: number;
  c?: number;
}

function keysOf(o: object): string {
  return Object.keys(o).join(",");
}

function namesOf(o: object): string {
  return Object.getOwnPropertyNames(o).join(",");
}

function ownsOf(o: object): string {
  return `${Object.hasOwn(o, "a")}/${Object.hasOwn(o, "b")}/${Object.hasOwn(o, "c")}`;
}

function inOf(o: object): string {
  return `${"a" in o}/${"b" in o}/${"c" in o}`;
}

function forInOf(o: object): string {
  let acc = "";
  for (const k in o) {
    acc += k + ",";
  }
  return acc;
}

function jsonOf(o: object): string {
  return JSON.stringify(o);
}

function assignOf(o: object): string {
  return JSON.stringify(Object.assign({}, o));
}

// The five boundaries. `direct` is not a boundary at all - the value is read
// at its own record type - and it is the row the widened ones are measured
// against: a record and its widened copy have to answer identically.
function viaParam(o: object): object {
  return o;
}

function viaRet(w: W): object {
  return w;
}

function report(label: string, w: W): void {
  const direct: W = w;
  const param: object = viaParam(w);
  const ret: object = viaRet(w);
  const elem: object = ([w] as object[])[0]!;
  const field: object = ({ v: w } as { v: object }).v;

  console.log(`${label} direct   ${keysOf(direct)} | ${namesOf(direct)} | ${ownsOf(direct)} | ${inOf(direct)} | ${forInOf(direct)} | ${jsonOf(direct)} | ${assignOf(direct)}`);
  console.log(`${label} param    ${keysOf(param)} | ${namesOf(param)} | ${ownsOf(param)} | ${inOf(param)} | ${forInOf(param)} | ${jsonOf(param)} | ${assignOf(param)}`);
  console.log(`${label} ret      ${keysOf(ret)} | ${namesOf(ret)} | ${ownsOf(ret)} | ${inOf(ret)} | ${forInOf(ret)} | ${jsonOf(ret)} | ${assignOf(ret)}`);
  console.log(`${label} elem     ${keysOf(elem)} | ${namesOf(elem)} | ${ownsOf(elem)} | ${inOf(elem)} | ${forInOf(elem)} | ${jsonOf(elem)} | ${assignOf(elem)}`);
  console.log(`${label} field    ${keysOf(field)} | ${namesOf(field)} | ${ownsOf(field)} | ${inOf(field)} | ${forInOf(field)} | ${jsonOf(field)} | ${assignOf(field)}`);
}

// The control. A required-looking, fully written record must never have a
// key filtered off it by any rule about undefined, on any surface.
const allPresent: W = { a: 1, b: 2, c: 3 };
report("all  ", allPresent);

// One key written, two omitted: Node has neither of the other two.
const onlyA: W = { a: 1 };
report("onlyA", onlyA);

// The middle key omitted, so a rule that only looks at the last field
// cannot pass this.
const noB: W = { a: 1, c: 3 };
report("noB  ", noB);

// Nothing written at all.
const empty: W = {};
report("empty", empty);

// Presence decided at RUN TIME. The conditional spread's empty arm holds
// the same interned undefined arm an omitted field does, so these two rows
// are the omission rule reached through a value the compiler cannot fold.
const yes = process.argv.length > 0;
const no = process.argv.length < 0;
const spreadYes: W = { a: 1, ...(yes ? { b: 2 } : {}) };
const spreadNo: W = { a: 1, ...(no ? { b: 2 } : {}) };
report("cond+", spreadYes);
report("cond-", spreadNo);

// A key GROWN after construction is present from that point on, and the
// widened copies taken afterwards have to see it.
const grown: W = { a: 1 };
grown.c = 3;
report("grown", grown);
