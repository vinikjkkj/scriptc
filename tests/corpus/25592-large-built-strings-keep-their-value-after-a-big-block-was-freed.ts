// A large JSON text is built and dropped, then strings of about a third of its size are built by concatenation: contents, lengths and equality are exact
// (the freed block is no longer lent to a much smaller string, which is invisible to the program).
const rows: Array<{ id: number; name: string; tags: string[] }> = [];
for (let i = 0; i < 900; i++) rows.push({ id: i, name: "row-" + i, tags: ["a", "b" + i, "c"] });
let sizes = 0;
for (let round = 0; round < 3; round++) {
  const big = JSON.stringify(rows);
  sizes += big.length;
  let sql = "SELECT user, server, device FROM t WHERE ";
  for (let i = 0; i < 300; i++) sql += (i === 0 ? "" : " OR ") + "(user = ? AND server = ? AND d = " + i + ")";
  const copy = sql + "";
  console.log(round, big.length, sql.length, copy === sql, sql.slice(-30), sql.indexOf("d = 299"));
}
const held: string[] = [];
for (let i = 0; i < 6; i++) {
  const j = JSON.stringify(rows.slice(0, 300 + i));
  let s = "";
  for (let k = 0; k < 150; k++) s += "INSERT INTO t VALUES (" + k + "," + i + ",'" + j.slice(k, k + 8) + "');";
  held.push(s);
}
console.log(sizes, held.map((s) => s.length).join(","), held[5]!.slice(0, 60), held[3]!.endsWith("');"));
