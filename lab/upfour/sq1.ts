import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(":memory:");
db.exec("CREATE TABLE t (a INTEGER)");
const stmts = ["INSERT INTO t VALUES (1)", "INSERT INTO t VALUES (2)"].map((s) => db.prepare(s));
console.log(stmts.length);
