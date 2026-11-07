// A replacement function with no annotations (debug's DEBUG_* camel-casing) answers `any`: Node applies ToString to whatever
// it returns, so a string, a number, undefined and null all land in the text as String() spells them. The capture
// parameters are strings that the untyped signature receives as dyn.
const keys = ["debug_show_hidden", "debug_max_array_length", "debug_depth", "debug_x_y_z"];
console.log(keys.map((key) => key.substring(6).toLowerCase().replace(/_([a-z])/g, (_, k) => k.toUpperCase())).join(","));
console.log("a1b22c333".replace(/\d+/g, (m) => Number(m) * 2));
console.log("xyz".replace(/y/g, (m) => undefined), "xyz".replace(/y/g, (m) => null), "xyz".replace(/[xz]/g, (m) => m === "x" ? 1.5 : true));
console.log("k=v;a=b".replace(/(\w)=(\w)/g, (all, l, r) => r + ":" + l));
const lens = "one two three".replace(/\w+/g, (w) => w.length);
console.log(lens, lens.length);
