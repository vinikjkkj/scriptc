// Object("x") is a String wrapper: its reads and `in` see String.prototype (and Object.prototype), `length` and indices, as Node does.
const s: any = Object("héllo");
const names = ["toString", "valueOf", "toLocaleString", "hasOwnProperty", "isPrototypeOf", "propertyIsEnumerable", "toUpperCase", "toLowerCase",
  "trim", "padStart", "at", "includes", "indexOf", "slice", "charAt", "split", "replace", "localeCompare", "normalize", "codePointAt",
  "toFixed", "toPrecision", "nope", "length", "0", "4", "5", "-1", "01"];
const row: string[] = [];
for (const k of names) row.push(k + ":" + typeof s[k] + (k in s ? "+" : "-"));
console.log(row.join(" "));
console.log(typeof s.toString, typeof s.toUpperCase, typeof s.valueOf, typeof s.hasOwnProperty, typeof s.nope);
console.log(s.toUpperCase(), s.charAt(1), s.toString(), s.valueOf(), s.slice(1, 3), s.indexOf("l"), s.length, s[0], s[4], s[5]);
const t: any = Object("");
console.log(typeof t.trim, "length" in t, "0" in t, t.length);
const un: any = Object("abc");
un.toUpperCase = 5;
un.extra = 1;
console.log(typeof un.toUpperCase, un.toUpperCase, un.extra, "extra" in un, typeof un.trim, un.charAt(2));
