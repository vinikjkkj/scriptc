const s = "\uFEFF";
console.log(s.length, s.charCodeAt(0));
const t = "\uFEFFa";
console.log(t.length, t.charCodeAt(0), t.charCodeAt(1), t.slice(1));
