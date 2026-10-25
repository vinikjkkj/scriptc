// The override returns nothing (a JS body with no return value) where the
// base declares unknown. Calls through the base type answer undefined, and a
// static written through the class name is read back.
import Redis, { Commander, Sock } from "./lib.js";
import Cmd from "./cmd.js";

Redis.Cluster = 5;
const r = new Redis();
const b: Commander = r;
const c = new Cmd("get");
const viaBase = b.sendCommand(c);
console.log(Redis.Cluster, c.name, viaBase === undefined ? "u" : "d", r.sendCommand(c, new Sock()) === undefined ? "u" : "d");
