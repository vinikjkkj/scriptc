// npm-static: a base method calls this.end() with no argument; the subclass redeclares end(callback)
// and forwards to super.end(callback) (the mysql2 shape).
import v from "virt12501";
const c = new v.Conn(1);
console.log(c.shutdown());
const pc = new v.PoolConn(2);
console.log(pc.shutdown());
const base = new v.PoolConn(3);
console.log(base.query("select", (e: unknown) => console.log("cb", e)));
console.log(base.log.join(","));
