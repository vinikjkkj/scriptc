// Index reads of an astral character are its two UTF-16 units; comparing a
// unit with a non-surrogate literal is exact, and the out-of-range read is
// undefined, which equals no string.
const g: string = "\u{1F600}";
console.log(g[0] === "\uD83D", g[0] !== "\uD83D", g[1] === "a", g[1] !== "a");
console.log(g[2] === "", g[2] !== "", g[0] !== "");
