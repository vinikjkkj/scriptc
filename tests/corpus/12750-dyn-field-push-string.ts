class Cfg { flags: string[]; constructor() { this.flags = ["a"]; } }
function pass(x: any): any { return x; }
const r = pass(new Cfg());
r.flags.push("b");
console.log(r.flags.length, r.flags.join(","));
