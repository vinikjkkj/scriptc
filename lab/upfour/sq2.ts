import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(":memory:");
db.exec("CREATE TABLE t (a INTEGER)");
const stmts = Array.from({ length: 2 }, (_v, i) => db.prepare(`INSERT INTO t VALUES (${i})`));
console.log(stmts.length);
