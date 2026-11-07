// A function whose JSDoc scalar claim the body contradicts yields the number OR undefined. A binding or a passthrough return takes that; a checker-typed
// slot cannot carry Node's undefined, so each flow below is refused at build time instead of trapping at run time.
/** @return {Number} */
function parse(str) { if (str.length > 3) return; return 2; }
/** @param {number} n */
function takesNumber(n) { return n + 1; }
class Holder {
  constructor() {
    this.fromCtor = parse("toolong");
  }
}
class Field { x = parse("toolong"); }
const arr = [parse("toolong")];
const rec = { k: parse("toolong") };
const arrow = () => parse("toolong");
takesNumber(parse("toolong"));
const r = parse("toolong");
takesNumber(r);
console.log(new Holder(), new Field(), arr, rec, arrow());
