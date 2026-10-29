// A PropertyList that names "__proto__": Node reads it by [[Get]] on an
// ordinary object and gets Object.prototype, which serializes as
// {"__proto__":null}. The allow-list is refused over anything that is not
// plain data, so the only value here is a static record.
type Pt = { x: number; y: string };
const pt: Pt = { x: 1, y: "z" };
console.log(JSON.stringify(pt, ["y", "x", "__proto__"]));
console.log(JSON.stringify(pt, ["__proto__"]));
console.log(JSON.stringify(pt, null, 3));
