// The same literal text reached from several functions is one value everywhere; escapes, unicode, empty and long literals read back exactly.
const a = "shared literal";
function one(): string { return "shared literal"; }
function two(): string { return "shared literal"; }
function three(): string { return a; }
console.log(one() === two(), two() === three(), a === "shared literal", one() + "!" === "shared literal!");
function esc(): string { return "tab\there \"quoted\" back\\slash é中😀 line\nbreak"; }
console.log(esc(), esc().length, JSON.stringify(esc()));
function empty(): string { return ""; }
console.log(empty() === "", empty().length, [empty(), "x", ""].join("|"));
function longer(): string { return "0123456789".repeat(1) + "abcdefghijklmnopqrstuvwxyz".repeat(1) + "ABCDEFGHIJKLMNOPQRSTUVWXYZ"; }
console.log(longer().length, longer().slice(-5), longer().indexOf("xyz"));
const table: Record<string, number> = { alpha: 1, beta: 2, gamma: 3, "with space": 4, "ünï": 5 };
console.log(Object.keys(table).join(","), table["with space"], table["ünï"], table.alpha + table.beta + table.gamma);
function cold(): string { return "never reached " + one(); }
console.log(process.argv.length > 99 ? cold() : "cold branch not taken");
