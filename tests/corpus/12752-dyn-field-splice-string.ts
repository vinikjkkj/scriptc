class Cfg { flags: string[]; constructor() { this.flags = ["a", "b", "c"]; } }
function pass(x: any): any { return x; }
const r = pass(new Cfg());
r.flags.splice(1, 1, "x", "y");
console.log(r.flags.length, r.flags.join(","));
