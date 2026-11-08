// A class instance handed out as an interface of dozens of command methods (ioredis' redis.pipeline(): ChainableCommander, whose commands the
// implementation installs on its prototype in a loop). Calling the interface's methods, chaining the returned interface value and reading
// the results must answer what Node answers.
import { Redis } from "expclass";
const r = new Redis({ host: "h" });
const p = r.pipeline();
p.cmd3("a").cmd7("b");
p.get("c");
const again = p.cmd69("d");
console.log(p.exec().join(","), r.calls, again === p);
const q = r.pipeline();
console.log(q.exec().length, q.cmd0("z").exec().join(","));
