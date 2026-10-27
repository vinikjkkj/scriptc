class Cfg { flags: string[]; constructor() { this.flags = ["a", "b", "c"]; } }
function pass(x: any): any { return x; }
const r = pass(new Cfg());
r.flags.length = 1;
console.log(r.flags.length, r.flags.join(","));
