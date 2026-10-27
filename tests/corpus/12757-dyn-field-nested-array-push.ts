class Inner { tags: string[]; constructor() { this.tags = ["t"]; } }
class Cfg { meta: Inner; constructor() { this.meta = new Inner(); } }
function pass(x: any): any { return x; }
const r = pass(new Cfg());
r.meta.tags.push("u");
console.log(r.meta.tags.length, r.meta.tags.join(","));
