// TextEncoder.prototype.encodeInto — the IN-PLACE encoder, and the two
// halves of its answer.
//
// zapo-js 1.8.2's binary encoder writes every string through it
// (transport/binary/encoder.ts:74), into a SUBARRAY of its growable
// buffer, and keeps only `written`. Both halves are interesting:
//
//   written  stops on a CHARACTER boundary. A destination one byte short
//            of the last character writes that character not at all — it
//            never writes a partial UTF-8 sequence — so the boundary
//            cases below are the specification, not edge decoration.
//   read     counts UTF-16 CODE UNITS consumed, which is 2 for every
//            astral character and 1 for everything else. It is NOT the
//            byte count and it is NOT the character count.
//
// Every row is measured against Node: run this file with node and diff.

const enc = new TextEncoder();

function show(label: string, src: string, cap: number): void {
    const dest = new Uint8Array(cap);
    const r = enc.encodeInto(src, dest);
    const bytes: string[] = [];
    for (let i = 0; i < dest.length; i++) bytes.push(String(dest[i]));
    console.log(label + " cap=" + String(cap) + " read=" + String(r.read) + " written=" + String(r.written) + " [" + bytes.join(",") + "]");
}

// ASCII: one byte, one code unit, and a destination of length 0.
show("empty/0", "", 0);
show("empty/5", "", 5);
show("ascii", "abc", 0);
show("ascii", "abc", 2);
show("ascii", "abc", 3);
show("ascii", "abc", 10);

// A two-byte character that does not fit: cap=2 has room for the byte
// count but not for a whole character, so written stays 1.
show("two-byte", "aéb", 1);
show("two-byte", "aéb", 2);
show("two-byte", "aéb", 3);
show("two-byte", "aéb", 4);

// A three-byte character: nothing at all until all three fit.
show("three-byte", "€", 0);
show("three-byte", "€", 1);
show("three-byte", "€", 2);
show("three-byte", "€", 3);

// An ASTRAL character — four bytes, TWO code units. This is the row that
// separates `read` from every other count in the answer.
show("astral", "\u{1F600}", 0);
show("astral", "\u{1F600}", 3);
show("astral", "\u{1F600}", 4);
show("astral straddling", "a\u{1F600}b", 1);
show("astral straddling", "a\u{1F600}b", 4);
show("astral straddling", "a\u{1F600}b", 5);
show("astral straddling", "a\u{1F600}b", 6);
show("two astrals", "\u{1F600}\u{1F600}", 5);
show("two astrals", "\u{1F600}\u{1F600}", 8);

// The replacement character costs three bytes and one code unit, which is
// also what an unpaired surrogate costs after substitution.
show("replacement", "x�y", 4);
show("replacement", "x�y", 5);

// The zapo shape: a subarray VIEW, written through to its backing store.
const buf = new Uint8Array(8);
const at = 3;
const wrote = enc.encodeInto("hié", buf.subarray(at)).written;
const back: string[] = [];
for (let i = 0; i < buf.length; i++) back.push(String(buf[i]));
console.log("through a subarray: wrote=" + String(wrote) + " [" + back.join(",") + "]");

// A destructuring consumer, and a stored encoder rather than a fresh one.
const { read, written } = enc.encodeInto("ok€", new Uint8Array(4));
console.log("destructured: read=" + String(read) + " written=" + String(written));

// A composed receiver — the encoder object between construction and call
// never exists.
console.log("composed: " + String(new TextEncoder().encodeInto("z", new Uint8Array(1)).written));

export {};
