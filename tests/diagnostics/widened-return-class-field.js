// A class field initializer is a checker-typed number slot: a widened call cannot flow into it, so it is refused at build time.
/** @return {Number} */
function parse(str) { if (str.length > 3) return; return 2; }
class Field { x = parse("toolong"); y = parse("ok"); }
const f = new Field();
console.log(f.x, f.y);
