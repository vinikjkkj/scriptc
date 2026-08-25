// @dynamic
// A module graph whose only builtin edge is node:net — the shape of every
// TCP database driver (it requires net and never requires http). The island
// ships node:net; the emitted main has to REGISTER the bridge cc.ts linked.
import { isip, family } from "netonly";

console.log(`isIP: ${isip("1.2.3.4")}`);
console.log(`isIP6: ${isip("::1")}`);
console.log(`isIP-bad: ${isip("nope")}`);
console.log(`family: ${family("10.0.0.1")} ${family("fe80::1")} ${family("x")}`);
