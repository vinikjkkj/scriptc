class Cfg { flags: string[]; constructor() { this.flags = ["a"]; } }
function pass(x: any): any { return x; }
const r = pass(new Cfg());
const h = r.flags;
r.flags.push("b");
console.log(h.length, h.join(","));
