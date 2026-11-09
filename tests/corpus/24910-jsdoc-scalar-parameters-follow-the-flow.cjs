// Node never enforces JSDoc: a JSDoc scalar claim keeps its representation only where the whole program proves it. Escaping functions and functions a
// non-conforming argument reaches take the representation of what actually arrives, and nothing throws where Node runs.

// 1: the function escapes (it is stored on another function), undefined arrives through the slot and through a direct call
/** @param {string} namespaces */
function enable(namespaces) {
  return namespaces === undefined ? "none" : "ns:" + namespaces;
}
function host() {}
host.enable = enable;
console.log(host.enable(process.env.SCRIPTC_24910_NONE), host.enable("a"), enable(process.env.SCRIPTC_24910_NONE));

// 2: does not escape, every call conforms: the claim is the representation
/** @param {string} s @param {number} n */
function repeat(s, n) {
  return s + n;
}
console.log(repeat("a", 1), repeat("b", 2));

// 3: does not escape, undefined is the only extra (an omitted argument, a string | undefined argument)
/** @param {string} label */
function tag(label) {
  return typeof label === "string" ? "<" + label + ">" : "<?>";
}
console.log(tag("x"), tag(process.env.SCRIPTC_24910_NONE), tag());

// 4: does not escape, a number and a boolean arrive at a {string} claim
/** @param {string} v */
function show(v) {
  return typeof v + ":" + v;
}
console.log(show("s"), show(7), show(true));

// 5: a function stored in a record slot returns undefined where its JSDoc claims a string
/** @return {string} */
function load() {
  return process.env.SCRIPTC_24910_NONE;
}
const holder = { load, tag: (x) => x };
console.log(typeof holder.load(), holder.load() === undefined);
