// Twenty absent-until-written fields on one class (the cold block holds sixteen): the first sixteen live in the overflow array, the rest stay ordinary, and every one
// reads, writes and lists exactly.
class Wide {
  constructor(a, b, c, d) { this.a = a; this.b = b; this.c = c; this.d = d; }
  sum() { return this.a + this.b + this.c + this.d; }
  set(i, v) {
    switch (i) {
      case 0: this.f0 = v; break; case 1: this.f1 = v; break; case 2: this.f2 = v; break; case 3: this.f3 = v; break;
      case 4: this.f4 = v; break; case 5: this.f5 = v; break; case 6: this.f6 = v; break; case 7: this.f7 = v; break;
      case 8: this.f8 = v; break; case 9: this.f9 = v; break; case 10: this.f10 = v; break; case 11: this.f11 = v; break;
      case 12: this.f12 = v; break; case 13: this.f13 = v; break; case 14: this.f14 = v; break; case 15: this.f15 = v; break;
      case 16: this.f16 = v; break; case 17: this.f17 = v; break; case 18: this.f18 = v; break; default: this.f19 = v; break;
    }
  }
  dump() {
    return [this.f0, this.f1, this.f2, this.f3, this.f4, this.f5, this.f6, this.f7, this.f8, this.f9, this.f10, this.f11, this.f12, this.f13, this.f14, this.f15, this.f16, this.f17, this.f18, this.f19].join(",");
  }
}
Wide.prototype.f0 = "p0";
Wide.prototype.f1 = "p1";
Wide.prototype.f2 = "p2";
Wide.prototype.f3 = "p3";
Wide.prototype.f4 = "p4";
Wide.prototype.f5 = "p5";
Wide.prototype.f6 = "p6";
Wide.prototype.f7 = "p7";
Wide.prototype.f8 = "p8";
Wide.prototype.f9 = "p9";
Wide.prototype.f10 = "p10";
Wide.prototype.f11 = "p11";
Wide.prototype.f12 = "p12";
Wide.prototype.f13 = "p13";
Wide.prototype.f14 = "p14";
Wide.prototype.f15 = "p15";
Wide.prototype.f16 = "p16";
Wide.prototype.f17 = "p17";
Wide.prototype.f18 = "p18";
Wide.prototype.f19 = "p19";
const w = new Wide(1, 2, 3, 4);
console.log(w.dump());
for (let i = 0; i < 20; i += 3) w.set(i, "v" + i);
console.log(w.dump(), Object.keys(w).join(","));
w.set(19, undefined);
w.set(0, 0);
console.log(w.dump(), Object.keys(w).join(","), w.sum());
const w2 = new Wide(4, 3, 2, 1);
w2.set(16, "late");
w2.set(15, "edge");
console.log(w2.dump(), Object.keys(w2).join(","), w.f3, w2.f3);
