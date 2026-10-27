class Cfg { flags: string[]; constructor() { this.flags = ["a", "b", "c"]; } }
function pass(x: any): any { return x; }
const r = pass(new Cfg());
const last = r.flags.pop();
console.log(last, r.flags.length, r.flags.join(","));
