// Object(b) is a Boolean wrapper: toString/valueOf only (plus Object.prototype's); Number's and String's names are absent.
const t: any = Object(true);
const f: any = Object(false);
const names = ["toString", "valueOf", "toLocaleString", "hasOwnProperty", "isPrototypeOf", "toFixed", "toUpperCase", "length", "nope"];
const both: any[] = [];
both.push(t);
both.push(f);
for (const b of both) {
  const row: string[] = [];
  for (const k of names) row.push(k + ":" + typeof b[k] + (k in b ? "+" : "-"));
  console.log(row.join(" "));
}
console.log(typeof t.toString, typeof t.valueOf, t.toString(), f.toString(), t.valueOf(), f.valueOf());
