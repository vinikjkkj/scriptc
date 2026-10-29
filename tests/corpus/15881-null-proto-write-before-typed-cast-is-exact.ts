// A null-prototype object whose members are ALL written before it is cast into a
// typed record is not refused: the record reads present members and Node agrees.
function parse(s: string): number { return s.length; }
const d = Object.create(null);
d.parse = parse;
const B: { parse: typeof parse } = d;
console.log(B.parse("abcd"), Object.keys(B).join(","));
