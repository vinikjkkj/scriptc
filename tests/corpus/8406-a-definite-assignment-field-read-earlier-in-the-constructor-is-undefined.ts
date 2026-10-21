class K {
  v!: number; s!: string; w = 0;
  constructor() { this.peek(); this.v = 5; this.s = "x"; this.peek(); }
  peek() { console.log(this.v, this.s); }
}
new K();
class B0 { constructor() { this.hook(); } hook() { console.log("base hook"); } }
class D0 extends B0 {
  n!: number;
  constructor() { super(); this.n = 7; console.log(this.n); }
  hook() { console.log("derived hook sees", this.n); }
}
new D0();
class Fast { x!: number; y!: string; constructor(n: number) { this.x = n; this.y = "k" + n; } sum() { return this.x + this.y.length; } }
console.log(new Fast(4).sum());
class Late {
  a!: number; b!: number;
  constructor() { this.a = 1; this.show(); this.b = 2; this.show(); }
  show() { console.log(this.a, this.b); }
}
new Late();
