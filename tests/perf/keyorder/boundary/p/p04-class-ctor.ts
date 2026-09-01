class C {
  b: number
  a: number
  constructor() { this.a = 2; this.b = 1 }
}
const c = new C()
console.log("keys=" + Object.keys(c).join(","))
