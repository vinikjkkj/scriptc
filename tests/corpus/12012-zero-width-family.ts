const names = ["\u200B", "\u200C", "\u200D", "\u2060", "\u00AD"];
for (const n of names) console.log(n.length, n.charCodeAt(0));
const lit = "​q" + "\u2060";
console.log(lit.length, lit.charCodeAt(0), lit.charCodeAt(1), lit.charCodeAt(2));
const lead = "\u200Dlead";
console.log(lead.length, lead.charCodeAt(0), lead.slice(1));
