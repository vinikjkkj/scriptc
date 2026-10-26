// the mysql2 parser_cache sameList shape: an Entry keeps dateStringsKey(...) (string[] | boolean) in a field, and matches() compares it element by element against a string[] key
function sameList(a, b) {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; ++i) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}
function dateStringsKey(dateStrings) {
  if (Array.isArray(dateStrings)) {
    return dateStrings.map((s) => String(s));
  }
  return Boolean(dateStrings);
}
class Entry {
  constructor(options, config) {
    this.dateStrings = dateStringsKey(options.dateStrings || config.dateStrings);
  }
  matches(options, config) {
    const dateStrings = dateStringsKey(options.dateStrings || config.dateStrings);
    if (Array.isArray(dateStrings) && !sameList(this.dateStrings, dateStrings)) {
      return false;
    }
    return true;
  }
}
const cfg = { dateStrings: false };
const entries = [
  new Entry({ dateStrings: ['a', 'b'] }, cfg),
  new Entry({ dateStrings: true }, cfg),
  new Entry({ dateStrings: ['x'] }, cfg),
];
const probes = [
  { dateStrings: ['a', 'b'] },
  { dateStrings: ['a', 'c'] },
  { dateStrings: true },
  { dateStrings: ['x'] },
];
for (const e of entries) {
  for (const p of probes) {
    console.log(e.matches(p, cfg));
  }
}
