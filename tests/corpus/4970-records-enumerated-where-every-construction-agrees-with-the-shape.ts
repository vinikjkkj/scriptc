// The NEGATIVE CONTROL for the key-enumeration refusal: every record here is
// built the way its shape enumerates, so every surface stays compiled and
// byte-exact against Node. The refusal that landed beside this fixture fires
// on the two constructions that cannot be Node-exact — a width copy that
// DROPS keys, and a construction spelled in an order the shape does not
// carry — and this file is the proof it fires on neither of these.
//
// It also pins the two shapes that LOOK at risk and are not:
//   * integer-like names, which JS enumerates first however they are spelled
//     (declaredOrder already runs OrdinaryOwnPropertyKeys), and
//   * a width-narrowed record that is only READ — the documented width-copy
//     stance keeps working, because reading declared fields never enumerates.

interface T {
    readonly b: number;
    readonly a: number;
    readonly c: number;
}

const t: T = { b: 1, a: 2, c: 3 };
console.log("K1 " + JSON.stringify(t));
console.log("K6 " + Object.keys(t).join(","));
console.log("K7 " + Object.values(t).map((v) => String(v)).join(","));
console.log("K8 " + JSON.stringify(Object.entries(t)));
let k5 = "";
for (const k in t) {
    k5 = k5 + k + ";";
}
console.log("K5 " + k5);
console.log("K10 " + JSON.stringify({ ...t }));
console.log("K12 " + JSON.stringify([t]));
console.log("K13 " + JSON.stringify({ w: t }));
console.log("K2 " + JSON.stringify(t));

// A second literal of the same shape, spelled the SAME way: one order, no
// risk, both enumerate.
const t2: T = { b: 9, a: 8, c: 7 };
console.log("t2 " + JSON.stringify(t2));

// INTEGER-LIKE names: written last, enumerated first, on both sides. The
// literal spelling and the shape's order disagree textually and agree in JS,
// which is exactly what the risk test has to tolerate.
interface N {
    readonly z: number;
    readonly "2": number;
    readonly "1": number;
}
const n: N = { z: 26, "2": 22, "1": 11 };
console.log("int " + JSON.stringify(n) + " keys=" + Object.keys(n).join(","));

// A WIDTH COPY that is only READ. The copy drops 'extra' exactly as
// documented; nothing enumerates the result, so nothing is refused and
// nothing is wrong.
interface Wide {
    readonly a: string;
    readonly b: string;
    readonly extra: string;
}
interface Narrow {
    readonly a: string;
    readonly b: string;
}
const wide: Wide = { a: "A", b: "B", extra: "X" };
const narrow: Narrow = wide;
console.log("read " + narrow.a + narrow.b);

// The same width copy through a spread, again read-only.
const narrow2: Narrow = { ...wide };
console.log("read2 " + narrow2.a + narrow2.b);

// A record built by a function that spells the shape's order: enumerating it
// is exact, so it compiles.
function mk(): T {
    return { b: 4, a: 5, c: 6 };
}
console.log("mk " + JSON.stringify(mk()) + " " + Object.keys(mk()).join(","));
