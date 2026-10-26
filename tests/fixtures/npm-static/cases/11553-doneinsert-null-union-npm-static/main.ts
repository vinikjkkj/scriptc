// The mysql2 query.js doneInsert shape as an npm-static package (`--npm-static doneq`).
// doneInsert is an implicit-any method: a call with the null literal binds its
// parameter to null | undefined, and its body reads a field of that parameter.
// Node throws only when that read is reached (the early-return path never
// reaches it); on base the read is refused with SC1090 ("reading 'serverStatus'
// on a union-typed value"), which is the query.js:124 site.
import { Query } from "doneq";

const q = new Query(null);
console.log(q.fromHeader({ serverStatus: 8 }), q.fromHeader({ serverStatus: 0 }));
const bad = new Query(new Error("x"));
console.log(bad.fail());
console.log(q.handlers.length, q.rows.length);
