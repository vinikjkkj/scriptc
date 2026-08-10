// Reading a property whose arms answer a JOIN that one of them only
// reaches through a re-tag: the `null`-typed field.
//
// A standalone `null` has no lone-unit representation, so a `null`-typed
// field is compiled as the unit-only `null | undefined` union. That makes
// `{ socket: Sock; frame: null } | { socket: null; frame: Bytes }` a pair
// whose `socket` answers join to `Sock | null | undefined` — and the arm
// answering `null | undefined` reaches that join by a RE-TAG, not by
// wrapping a bare payload the way the joined keyed read can emit inline.
//
// The read lifts into a function instead: one tag test per arm, the
// narrowed payload's field, and the planned conversion into the join. The
// tag test is what makes it safe — no arm's payload is peeked before its
// tag is compared.
//
// Everything below is behaviour Node and scriptc AGREE on.

class Sock {
  readonly id: string;
  constructor(id: string) {
    this.id = id;
  }
}

type Resume =
  | { readonly socket: Sock; readonly frame: null }
  | { readonly socket: null; readonly frame: Uint8Array };

function resume(ok: boolean): Resume {
  return ok
    ? { socket: new Sock("s1"), frame: null }
    : { socket: null, frame: new Uint8Array([1, 2, 3]) };
}

// --- the guard the shape exists for

function connect(ok: boolean): string {
  const r = resume(ok);
  if (r.socket) {
    return `socket:${r.socket.id}`;
  }
  return `frame:${r.frame.length}`;
}

console.log(connect(true));
console.log(connect(false));

// --- the consumers that fold on non-nullability, each against Node

console.log("nullish", resume(false).socket ?? "D", resume(true).socket === null);
console.log("or", resume(false).socket || "OR");
console.log("and", resume(true).socket && "AND");
console.log("eqnull", resume(false).socket === null, resume(true).socket === null);
console.log("nenull", resume(false).socket !== null, resume(true).socket !== null);
console.log("equndef", resume(false).socket === undefined);
console.log("frame-null", resume(true).frame === null, resume(false).frame === null);
console.log("log", resume(false).socket);

// --- the string-typed sibling: `{ lidJid: string } | { lidJid: null }`,
//     where the join is `string | null | undefined`

type Target =
  | { readonly lidJid: string; readonly pnJid: string | null }
  | { readonly lidJid: null; readonly pnJid: string };

function addr(t: Target): string {
  if (t.lidJid !== null) {
    return t.pnJid !== null ? `L${t.lidJid}+P${t.pnJid}` : `L${t.lidJid}+U`;
  }
  return `P${t.pnJid}`;
}

console.log(addr({ lidJid: "a@lid", pnJid: "b@pn" }));
console.log(addr({ lidJid: "a@lid", pnJid: null }));
console.log(addr({ lidJid: null, pnJid: "c@pn" }));

function target(lid: boolean): Target {
  return lid ? { lidJid: "y@lid", pnJid: null } : { lidJid: null, pnJid: "z@pn" };
}

console.log("t-nullish", addr(target(false)).length);
console.log("t-default", target(false).lidJid ?? "DFLT", target(true).lidJid ?? "DFLT");
console.log("t-or", target(false).lidJid || "ORD", target(true).lidJid || "ORD");
console.log("t-and", target(false).lidJid && "ANDD", target(true).lidJid && "ANDD");
console.log("t-log", target(false).lidJid, target(true).lidJid);

// --- the receiver evaluates exactly ONCE

let calls = 0;
function counted(ok: boolean): Resume {
  calls = calls + 1;
  return resume(ok);
}
console.log("once", counted(true).socket === null, calls);

// --- a number arm joins the same way

type Score =
  | { readonly n: number; readonly why: string }
  | { readonly n: null; readonly why: string };

function scored(s: Score): string {
  return `${s.n ?? "none"}/${s.why}`;
}
console.log(scored({ n: 7, why: "hit" }));
console.log(scored({ n: null, why: "miss" }));

console.log("done");
