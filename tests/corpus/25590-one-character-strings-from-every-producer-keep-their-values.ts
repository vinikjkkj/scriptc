// A one-character string is the same value whichever way it is made: indexing, splitting, joining, String.fromCharCode, a concat with the empty string,
// a template, a slice, JSON.parse and Array.from. Equality, length, Map keys and set membership never see a difference.
const N = 2000;
const made: string[] = [];
const src = "a?b".repeat(10);
for (let i = 0; i < N; i++) {
  made.push(String.fromCharCode(63));
  made.push("" + "?");
  made.push(["?"].join(","));
  made.push(src.slice(1, 2));
  made.push(src[1]!);
  made.push(`${"?"}`);
  made.push(JSON.parse('"?"') as string);
}
made.push(...("?".repeat(N)).split(""));
made.push(...Array.from("?".repeat(N)));
const distinct = new Set(made);
const counts = new Map<string, number>();
for (const s of made) counts.set(s, (counts.get(s) ?? 0) + 1);
console.log(made.length, distinct.size, counts.get("?"), made.every((s) => s === "?" && s.length === 1 && s.charCodeAt(0) === 63));
const mixed: string[] = [];
for (let c = 32; c < 127; c++) { mixed.push(String.fromCharCode(c)); mixed.push("" + String.fromCharCode(c)); mixed.push([String.fromCharCode(c)].join("")); }
console.log(mixed.length, new Set(mixed).size, mixed.join("").length, mixed.slice(0, 6).join("|"));
const u = ["é", "é", "" + "é", "日"];
console.log(u.map((s) => s.length).join(","), new Set(u).size, u[0] === u[1], u[2] === u[0]);
console.log("x" + "" === "x", ("" + "q").length, ("q" + "").toUpperCase());
