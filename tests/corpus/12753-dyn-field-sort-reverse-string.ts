class Cfg { flags: string[]; constructor() { this.flags = ["c", "a", "b"]; } }
function pass(x: any): any { return x; }
const r = pass(new Cfg());
r.flags.sort();
console.log(r.flags.join(","));
r.flags.reverse();
console.log(r.flags.join(","));
