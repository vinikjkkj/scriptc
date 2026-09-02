// `Date` is mapped as a TYPE with no values (ir/nodes.ts's `date` kind,
// packages/runtime/src/scr_date.c): the mapping exists so a record whose
// member is typed `Date` has a representation at all. Before it, the RECORD
// TYPE itself reported SC2009 — a type-level stop --best-effort cannot
// defer — and that was the last error between zapo voip's package entry and
// a binary. The shape below is `voip/call/call-state.ts`'s CallStateData.
//
// Nothing constructs a Date, so every line here is about the SLOT: an absent
// optional member reads `undefined`, the presence test answers presence and
// not the always-truthy constant an object kind would give, the other
// members keep their values across the Date-shaped hole, and a Date[] field
// and a Map holding the record both compile.
//
// `new Date()` as a value, `.getTime()`, `.toISOString()`, `String(d)` and
// `d === d` all still refuse by name; they belong in the diagnostics corpus,
// not here, because a refusal is not a program.
interface CallStateData {
  state: string;
  connectedAt?: Date;
  acceptedAt?: Date;
  endedAt?: Date;
  audioMuted: boolean;
  silenced?: boolean;
  durationSecs?: number;
}

interface Holder {
  id: string;
  data: CallStateData;
  stamps: Date[];
  latest?: Date;
}

const d: CallStateData = { state: "Active", audioMuted: false, silenced: true, durationSecs: 7 };
const h: Holder = { id: "c1", data: d, stamps: [] };
const byId = new Map<string, Holder>();
byId.set("c1", h);

console.log(d.state, d.audioMuted, d.silenced, d.durationSecs);
console.log(d.connectedAt === undefined, d.acceptedAt === undefined, d.endedAt === undefined);
// Presence, not the epoch: a Date object is truthy in Node even at ms 0, so
// this must read the SLOT and answer "absent".
console.log(d.connectedAt ? "yes" : "no", d.connectedAt ? 1 : 0);
console.log(h.stamps.length, h.latest === undefined);

const got = byId.get("c1");
console.log(byId.size, got === undefined ? "?" : got.id, got === undefined ? "?" : got.data.state);

// The hole does not move the neighbours: a second record with the optional
// members in a different declaration order still reads the same.
const e: CallStateData = { audioMuted: true, state: "Ended", endedAt: undefined };
console.log(e.state, e.audioMuted, e.silenced === undefined, e.endedAt === undefined);

function describe(s: CallStateData): string {
  return s.connectedAt === undefined ? s.state + "/pending" : s.state + "/connected";
}
console.log(describe(d), describe(e));
