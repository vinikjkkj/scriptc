class Cfg { nums: number[]; constructor() { this.nums = [1, 2]; } }
function pass(x: any): any { return x; }
const r = pass(new Cfg());
r.nums.push(3);
console.log(r.nums.length, r.nums.join(","));
