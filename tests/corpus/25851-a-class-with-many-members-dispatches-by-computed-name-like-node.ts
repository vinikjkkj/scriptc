// A class with many members, called and probed through `any` by computed names (the class member index), across a hierarchy.
let bad = 0;
let checks = 0;
function ck(ok: boolean, what: string): void {
  checks++;
  if (!ok) {
    bad++;
    console.log('BAD ' + what);
  }
}
class Big {
  base = 3;
  tag = 'big';
  m0(x: number): number { return x * 1 + this.base; }
  m1(x: number): number { return x * 2 + this.base; }
  m2(x: number): number { return x * 3 + this.base; }
  m3(x: number): number { return x * 4 + this.base; }
  m4(x: number): number { return x * 5 + this.base; }
  m5(x: number): number { return x * 6 + this.base; }
  m6(x: number): number { return x * 7 + this.base; }
  m7(x: number): number { return x * 8 + this.base; }
  m8(x: number): number { return x * 9 + this.base; }
  m9(x: number): number { return x * 10 + this.base; }
  m10(x: number): number { return x * 11 + this.base; }
  m11(x: number): number { return x * 12 + this.base; }
  m12(x: number): number { return x * 13 + this.base; }
  m13(x: number): number { return x * 14 + this.base; }
  m14(x: number): number { return x * 15 + this.base; }
  m15(x: number): number { return x * 16 + this.base; }
  m16(x: number): number { return x * 17 + this.base; }
  m17(x: number): number { return x * 18 + this.base; }
  m18(x: number): number { return x * 19 + this.base; }
  m19(x: number): number { return x * 20 + this.base; }
  m20(x: number): number { return x * 21 + this.base; }
  m21(x: number): number { return x * 22 + this.base; }
  m22(x: number): number { return x * 23 + this.base; }
  m23(x: number): number { return x * 24 + this.base; }
  m24(x: number): number { return x * 25 + this.base; }
  m25(x: number): number { return x * 26 + this.base; }
  m26(x: number): number { return x * 27 + this.base; }
  m27(x: number): number { return x * 28 + this.base; }
  m28(x: number): number { return x * 29 + this.base; }
  m29(x: number): number { return x * 30 + this.base; }
  m30(x: number): number { return x * 31 + this.base; }
  m31(x: number): number { return x * 32 + this.base; }
  m32(x: number): number { return x * 33 + this.base; }
  m33(x: number): number { return x * 34 + this.base; }
  m34(x: number): number { return x * 35 + this.base; }
  m35(x: number): number { return x * 36 + this.base; }
  m36(x: number): number { return x * 37 + this.base; }
  m37(x: number): number { return x * 38 + this.base; }
  m38(x: number): number { return x * 39 + this.base; }
  m39(x: number): number { return x * 40 + this.base; }
  get twice(): number { return this.base * 2; }
}

class Sub extends Big {
  extra = 10;
  m0(x: number): number { return -x * 1 - this.extra; }
  m3(x: number): number { return -x * 4 - this.extra; }
  m6(x: number): number { return -x * 7 - this.extra; }
  m9(x: number): number { return -x * 10 - this.extra; }
  m12(x: number): number { return -x * 13 - this.extra; }
  m15(x: number): number { return -x * 16 - this.extra; }
  m18(x: number): number { return -x * 19 - this.extra; }
  m21(x: number): number { return -x * 22 - this.extra; }
  m24(x: number): number { return -x * 25 - this.extra; }
  m27(x: number): number { return -x * 28 - this.extra; }
  m30(x: number): number { return -x * 31 - this.extra; }
  m33(x: number): number { return -x * 34 - this.extra; }
  m36(x: number): number { return -x * 37 - this.extra; }
  m39(x: number): number { return -x * 40 - this.extra; }
  only(x: number): number { return x + this.extra; }
}

class Other {
  v = 1;
  m0(x: number): number { return x + 1000; }
  m2(x: number): number { return x + 1002; }
  m4(x: number): number { return x + 1004; }
  m6(x: number): number { return x + 1006; }
  m8(x: number): number { return x + 1008; }
  m10(x: number): number { return x + 1010; }
  m12(x: number): number { return x + 1012; }
  m14(x: number): number { return x + 1014; }
  m16(x: number): number { return x + 1016; }
  m18(x: number): number { return x + 1018; }
  m20(x: number): number { return x + 1020; }
  m22(x: number): number { return x + 1022; }
  m24(x: number): number { return x + 1024; }
  m26(x: number): number { return x + 1026; }
  m28(x: number): number { return x + 1028; }
  m30(x: number): number { return x + 1030; }
  m32(x: number): number { return x + 1032; }
  m34(x: number): number { return x + 1034; }
  m36(x: number): number { return x + 1036; }
  m38(x: number): number { return x + 1038; }
}

const all: any[] = [new Big(), new Sub(), new Other(), new Sub(), new Big()];
let sum = 0;
const names: string[] = [];
for (let i = 0; i < 44; i++) names.push('m' + i);
names.push('only', 'twice', 'base', 'tag', 'extra', 'v', 'nothere');
for (let r = 0; r < 3; r++) {
  for (const o of all) {
    for (const nm of names) {
      const f = o[nm];
      if (typeof f === 'function') sum += o[nm](r + 1);
      else if (typeof f === 'number') sum += f;
      else if (typeof f === 'string') sum += f.length;
      ck((nm in o) === (f !== undefined), 'in ' + nm);
    }
  }
}
sum += all[1].m3(1) + all[1].m0(1);
console.log('sum', sum);
const lines: string[] = [];
for (const o of all) lines.push(Object.keys(o).join(',') + ':' + typeof o['m39'] + typeof o['m38']);
console.log(lines.join('\n'));
console.log('checks', checks, 'bad', bad);