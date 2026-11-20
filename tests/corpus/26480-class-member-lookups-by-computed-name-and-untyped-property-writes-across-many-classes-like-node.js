"use strict";
// Class instances reached through untyped receivers: method calls by computed name, property writes (a declared field, a new key, a key naming
// a method) and own-key listings across 100 classes that share the runtime's per-class member caches (more classes than cache slots, so a slot is taken over).
const { EventEmitter } = require("node:events");
let bad = 0;
let sum = 0;
function ck(ok, what) {
  if (!ok) {
    bad++;
    console.log("BAD " + what);
  }
}
class C0 extends EventEmitter {
  constructor() {
    super();
    this.f = 0;
    this.tag = "c0";
  }
  put(k, v) {
    this[k] = v;
  }
  m0(x) { return x * 1 + 0 + this.f; }
  m1(x) { return x * 2 + 0 + this.f; }
  m2(x) { return x * 3 + 0 + this.f; }
  m3(x) { return x * 4 + 0 + this.f; }
  m4(x) { return x * 5 + 0 + this.f; }
  m5(x) { return x * 6 + 0 + this.f; }
  m6(x) { return x * 7 + 0 + this.f; }
  m7(x) { return x * 8 + 0 + this.f; }
  m8(x) { return x * 9 + 0 + this.f; }
  m9(x) { return x * 10 + 0 + this.f; }
  m10(x) { return x * 11 + 0 + this.f; }
  m11(x) { return x * 12 + 0 + this.f; }
  m12(x) { return x * 13 + 0 + this.f; }
  m13(x) { return x * 14 + 0 + this.f; }
  m14(x) { return x * 15 + 0 + this.f; }
  m15(x) { return x * 16 + 0 + this.f; }
  m16(x) { return x * 17 + 0 + this.f; }
  m17(x) { return x * 18 + 0 + this.f; }
}
class C1 {
  constructor() {
    this.f = 1;
    this.tag = "c1";
  }
  put(k, v) {
    this[k] = v;
  }
  z0() { return 0; }
  m0(x) { return x * 1 + 1 + this.f; }
  m1(x) { return x * 2 + 1 + this.f; }
  m2(x) { return x * 3 + 1 + this.f; }
  m3(x) { return x * 4 + 1 + this.f; }
  m4(x) { return x * 5 + 1 + this.f; }
  m5(x) { return x * 6 + 1 + this.f; }
  m6(x) { return x * 7 + 1 + this.f; }
  m7(x) { return x * 8 + 1 + this.f; }
  m8(x) { return x * 9 + 1 + this.f; }
  m9(x) { return x * 10 + 1 + this.f; }
  m10(x) { return x * 11 + 1 + this.f; }
  m11(x) { return x * 12 + 1 + this.f; }
  m12(x) { return x * 13 + 1 + this.f; }
  m13(x) { return x * 14 + 1 + this.f; }
  m14(x) { return x * 15 + 1 + this.f; }
  m15(x) { return x * 16 + 1 + this.f; }
  m16(x) { return x * 17 + 1 + this.f; }
  m17(x) { return x * 18 + 1 + this.f; }
}
class C2 extends EventEmitter {
  constructor() {
    super();
    this.f = 2;
    this.tag = "c2";
  }
  put(k, v) {
    this[k] = v;
  }
  z0() { return 0; }
  z1() { return 1; }
  m0(x) { return x * 1 + 2 + this.f; }
  m1(x) { return x * 2 + 2 + this.f; }
  m2(x) { return x * 3 + 2 + this.f; }
  m3(x) { return x * 4 + 2 + this.f; }
  m4(x) { return x * 5 + 2 + this.f; }
  m5(x) { return x * 6 + 2 + this.f; }
  m6(x) { return x * 7 + 2 + this.f; }
  m7(x) { return x * 8 + 2 + this.f; }
  m8(x) { return x * 9 + 2 + this.f; }
  m9(x) { return x * 10 + 2 + this.f; }
  m10(x) { return x * 11 + 2 + this.f; }
  m11(x) { return x * 12 + 2 + this.f; }
  m12(x) { return x * 13 + 2 + this.f; }
  m13(x) { return x * 14 + 2 + this.f; }
  m14(x) { return x * 15 + 2 + this.f; }
  m15(x) { return x * 16 + 2 + this.f; }
  m16(x) { return x * 17 + 2 + this.f; }
  m17(x) { return x * 18 + 2 + this.f; }
}
class C3 {
  constructor() {
    this.f = 3;
    this.tag = "c3";
  }
  put(k, v) {
    this[k] = v;
  }
  z0() { return 0; }
  z1() { return 1; }
  z2() { return 2; }
  m0(x) { return x * 1 + 3 + this.f; }
  m1(x) { return x * 2 + 3 + this.f; }
  m2(x) { return x * 3 + 3 + this.f; }
  m3(x) { return x * 4 + 3 + this.f; }
  m4(x) { return x * 5 + 3 + this.f; }
  m5(x) { return x * 6 + 3 + this.f; }
  m6(x) { return x * 7 + 3 + this.f; }
  m7(x) { return x * 8 + 3 + this.f; }
  m8(x) { return x * 9 + 3 + this.f; }
  m9(x) { return x * 10 + 3 + this.f; }
  m10(x) { return x * 11 + 3 + this.f; }
  m11(x) { return x * 12 + 3 + this.f; }
  m12(x) { return x * 13 + 3 + this.f; }
  m13(x) { return x * 14 + 3 + this.f; }
  m14(x) { return x * 15 + 3 + this.f; }
  m15(x) { return x * 16 + 3 + this.f; }
  m16(x) { return x * 17 + 3 + this.f; }
  m17(x) { return x * 18 + 3 + this.f; }
}
class C4 extends EventEmitter {
  constructor() {
    super();
    this.f = 4;
    this.tag = "c4";
  }
  put(k, v) {
    this[k] = v;
  }
  z0() { return 0; }
  z1() { return 1; }
  z2() { return 2; }
  z3() { return 3; }
  m0(x) { return x * 1 + 4 + this.f; }
  m1(x) { return x * 2 + 4 + this.f; }
  m2(x) { return x * 3 + 4 + this.f; }
  m3(x) { return x * 4 + 4 + this.f; }
  m4(x) { return x * 5 + 4 + this.f; }
  m5(x) { return x * 6 + 4 + this.f; }
  m6(x) { return x * 7 + 4 + this.f; }
  m7(x) { return x * 8 + 4 + this.f; }
  m8(x) { return x * 9 + 4 + this.f; }
  m9(x) { return x * 10 + 4 + this.f; }
  m10(x) { return x * 11 + 4 + this.f; }
  m11(x) { return x * 12 + 4 + this.f; }
  m12(x) { return x * 13 + 4 + this.f; }
  m13(x) { return x * 14 + 4 + this.f; }
  m14(x) { return x * 15 + 4 + this.f; }
  m15(x) { return x * 16 + 4 + this.f; }
  m16(x) { return x * 17 + 4 + this.f; }
  m17(x) { return x * 18 + 4 + this.f; }
}
class C5 {
  constructor() {
    this.f = 5;
    this.tag = "c5";
  }
  put(k, v) {
    this[k] = v;
  }
  z0() { return 0; }
  z1() { return 1; }
  z2() { return 2; }
  z3() { return 3; }
  z4() { return 4; }
  m0(x) { return x * 1 + 5 + this.f; }
  m1(x) { return x * 2 + 5 + this.f; }
  m2(x) { return x * 3 + 5 + this.f; }
  m3(x) { return x * 4 + 5 + this.f; }
  m4(x) { return x * 5 + 5 + this.f; }
  m5(x) { return x * 6 + 5 + this.f; }
  m6(x) { return x * 7 + 5 + this.f; }
  m7(x) { return x * 8 + 5 + this.f; }
  m8(x) { return x * 9 + 5 + this.f; }
  m9(x) { return x * 10 + 5 + this.f; }
  m10(x) { return x * 11 + 5 + this.f; }
  m11(x) { return x * 12 + 5 + this.f; }
  m12(x) { return x * 13 + 5 + this.f; }
  m13(x) { return x * 14 + 5 + this.f; }
  m14(x) { return x * 15 + 5 + this.f; }
  m15(x) { return x * 16 + 5 + this.f; }
  m16(x) { return x * 17 + 5 + this.f; }
  m17(x) { return x * 18 + 5 + this.f; }
}
class C6 extends EventEmitter {
  constructor() {
    super();
    this.f = 6;
    this.tag = "c6";
  }
  put(k, v) {
    this[k] = v;
  }
  z0() { return 0; }
  z1() { return 1; }
  z2() { return 2; }
  z3() { return 3; }
  z4() { return 4; }
  z5() { return 5; }
  m0(x) { return x * 1 + 6 + this.f; }
  m1(x) { return x * 2 + 6 + this.f; }
  m2(x) { return x * 3 + 6 + this.f; }
  m3(x) { return x * 4 + 6 + this.f; }
  m4(x) { return x * 5 + 6 + this.f; }
  m5(x) { return x * 6 + 6 + this.f; }
  m6(x) { return x * 7 + 6 + this.f; }
  m7(x) { return x * 8 + 6 + this.f; }
  m8(x) { return x * 9 + 6 + this.f; }
  m9(x) { return x * 10 + 6 + this.f; }
  m10(x) { return x * 11 + 6 + this.f; }
  m11(x) { return x * 12 + 6 + this.f; }
  m12(x) { return x * 13 + 6 + this.f; }
  m13(x) { return x * 14 + 6 + this.f; }
  m14(x) { return x * 15 + 6 + this.f; }
  m15(x) { return x * 16 + 6 + this.f; }
  m16(x) { return x * 17 + 6 + this.f; }
  m17(x) { return x * 18 + 6 + this.f; }
}
class C7 {
  constructor() {
    this.f = 7;
    this.tag = "c7";
  }
  put(k, v) {
    this[k] = v;
  }
  m0(x) { return x * 1 + 7 + this.f; }
  m1(x) { return x * 2 + 7 + this.f; }
  m2(x) { return x * 3 + 7 + this.f; }
  m3(x) { return x * 4 + 7 + this.f; }
  m4(x) { return x * 5 + 7 + this.f; }
  m5(x) { return x * 6 + 7 + this.f; }
  m6(x) { return x * 7 + 7 + this.f; }
  m7(x) { return x * 8 + 7 + this.f; }
  m8(x) { return x * 9 + 7 + this.f; }
  m9(x) { return x * 10 + 7 + this.f; }
  m10(x) { return x * 11 + 7 + this.f; }
  m11(x) { return x * 12 + 7 + this.f; }
  m12(x) { return x * 13 + 7 + this.f; }
  m13(x) { return x * 14 + 7 + this.f; }
  m14(x) { return x * 15 + 7 + this.f; }
  m15(x) { return x * 16 + 7 + this.f; }
  m16(x) { return x * 17 + 7 + this.f; }
  m17(x) { return x * 18 + 7 + this.f; }
}
class C8 extends EventEmitter {
  constructor() {
    super();
    this.f = 8;
    this.tag = "c8";
  }
  put(k, v) {
    this[k] = v;
  }
  z0() { return 0; }
  m0(x) { return x * 1 + 8 + this.f; }
  m1(x) { return x * 2 + 8 + this.f; }
  m2(x) { return x * 3 + 8 + this.f; }
  m3(x) { return x * 4 + 8 + this.f; }
  m4(x) { return x * 5 + 8 + this.f; }
  m5(x) { return x * 6 + 8 + this.f; }
  m6(x) { return x * 7 + 8 + this.f; }
  m7(x) { return x * 8 + 8 + this.f; }
  m8(x) { return x * 9 + 8 + this.f; }
  m9(x) { return x * 10 + 8 + this.f; }
  m10(x) { return x * 11 + 8 + this.f; }
  m11(x) { return x * 12 + 8 + this.f; }
  m12(x) { return x * 13 + 8 + this.f; }
  m13(x) { return x * 14 + 8 + this.f; }
  m14(x) { return x * 15 + 8 + this.f; }
  m15(x) { return x * 16 + 8 + this.f; }
  m16(x) { return x * 17 + 8 + this.f; }
  m17(x) { return x * 18 + 8 + this.f; }
}
class C9 {
  constructor() {
    this.f = 9;
    this.tag = "c9";
  }
  put(k, v) {
    this[k] = v;
  }
  z0() { return 0; }
  z1() { return 1; }
  m0(x) { return x * 1 + 9 + this.f; }
  m1(x) { return x * 2 + 9 + this.f; }
  m2(x) { return x * 3 + 9 + this.f; }
  m3(x) { return x * 4 + 9 + this.f; }
  m4(x) { return x * 5 + 9 + this.f; }
  m5(x) { return x * 6 + 9 + this.f; }
  m6(x) { return x * 7 + 9 + this.f; }
  m7(x) { return x * 8 + 9 + this.f; }
  m8(x) { return x * 9 + 9 + this.f; }
  m9(x) { return x * 10 + 9 + this.f; }
  m10(x) { return x * 11 + 9 + this.f; }
  m11(x) { return x * 12 + 9 + this.f; }
  m12(x) { return x * 13 + 9 + this.f; }
  m13(x) { return x * 14 + 9 + this.f; }
  m14(x) { return x * 15 + 9 + this.f; }
  m15(x) { return x * 16 + 9 + this.f; }
  m16(x) { return x * 17 + 9 + this.f; }
  m17(x) { return x * 18 + 9 + this.f; }
}
class C10 extends EventEmitter {
  constructor() {
    super();
    this.f = 10;
    this.tag = "c10";
  }
  put(k, v) {
    this[k] = v;
  }
  z0() { return 0; }
  z1() { return 1; }
  z2() { return 2; }
  m0(x) { return x * 1 + 10 + this.f; }
  m1(x) { return x * 2 + 10 + this.f; }
  m2(x) { return x * 3 + 10 + this.f; }
  m3(x) { return x * 4 + 10 + this.f; }
  m4(x) { return x * 5 + 10 + this.f; }
  m5(x) { return x * 6 + 10 + this.f; }
  m6(x) { return x * 7 + 10 + this.f; }
  m7(x) { return x * 8 + 10 + this.f; }
  m8(x) { return x * 9 + 10 + this.f; }
  m9(x) { return x * 10 + 10 + this.f; }
  m10(x) { return x * 11 + 10 + this.f; }
  m11(x) { return x * 12 + 10 + this.f; }
  m12(x) { return x * 13 + 10 + this.f; }
  m13(x) { return x * 14 + 10 + this.f; }
  m14(x) { return x * 15 + 10 + this.f; }
  m15(x) { return x * 16 + 10 + this.f; }
  m16(x) { return x * 17 + 10 + this.f; }
  m17(x) { return x * 18 + 10 + this.f; }
}
class C11 {
  constructor() {
    this.f = 11;
    this.tag = "c11";
  }
  put(k, v) {
    this[k] = v;
  }
  z0() { return 0; }
  z1() { return 1; }
  z2() { return 2; }
  z3() { return 3; }
  m0(x) { return x * 1 + 11 + this.f; }
  m1(x) { return x * 2 + 11 + this.f; }
  m2(x) { return x * 3 + 11 + this.f; }
  m3(x) { return x * 4 + 11 + this.f; }
  m4(x) { return x * 5 + 11 + this.f; }
  m5(x) { return x * 6 + 11 + this.f; }
  m6(x) { return x * 7 + 11 + this.f; }
  m7(x) { return x * 8 + 11 + this.f; }
  m8(x) { return x * 9 + 11 + this.f; }
  m9(x) { return x * 10 + 11 + this.f; }
  m10(x) { return x * 11 + 11 + this.f; }
  m11(x) { return x * 12 + 11 + this.f; }
  m12(x) { return x * 13 + 11 + this.f; }
  m13(x) { return x * 14 + 11 + this.f; }
  m14(x) { return x * 15 + 11 + this.f; }
  m15(x) { return x * 16 + 11 + this.f; }
  m16(x) { return x * 17 + 11 + this.f; }
  m17(x) { return x * 18 + 11 + this.f; }
}
class C12 extends EventEmitter {
  constructor() {
    super();
    this.f = 12;
    this.tag = "c12";
  }
  put(k, v) {
    this[k] = v;
  }
  z0() { return 0; }
  z1() { return 1; }
  z2() { return 2; }
  z3() { return 3; }
  z4() { return 4; }
  m0(x) { return x * 1 + 12 + this.f; }
  m1(x) { return x * 2 + 12 + this.f; }
  m2(x) { return x * 3 + 12 + this.f; }
  m3(x) { return x * 4 + 12 + this.f; }
  m4(x) { return x * 5 + 12 + this.f; }
  m5(x) { return x * 6 + 12 + this.f; }
  m6(x) { return x * 7 + 12 + this.f; }
  m7(x) { return x * 8 + 12 + this.f; }
  m8(x) { return x * 9 + 12 + this.f; }
  m9(x) { return x * 10 + 12 + this.f; }
  m10(x) { return x * 11 + 12 + this.f; }
  m11(x) { return x * 12 + 12 + this.f; }
  m12(x) { return x * 13 + 12 + this.f; }
  m13(x) { return x * 14 + 12 + this.f; }
  m14(x) { return x * 15 + 12 + this.f; }
  m15(x) { return x * 16 + 12 + this.f; }
  m16(x) { return x * 17 + 12 + this.f; }
  m17(x) { return x * 18 + 12 + this.f; }
}
class C13 {
  constructor() {
    this.f = 13;
    this.tag = "c13";
  }
  put(k, v) {
    this[k] = v;
  }
  z0() { return 0; }
  z1() { return 1; }
  z2() { return 2; }
  z3() { return 3; }
  z4() { return 4; }
  z5() { return 5; }
  m0(x) { return x * 1 + 13 + this.f; }
  m1(x) { return x * 2 + 13 + this.f; }
  m2(x) { return x * 3 + 13 + this.f; }
  m3(x) { return x * 4 + 13 + this.f; }
  m4(x) { return x * 5 + 13 + this.f; }
  m5(x) { return x * 6 + 13 + this.f; }
  m6(x) { return x * 7 + 13 + this.f; }
  m7(x) { return x * 8 + 13 + this.f; }
  m8(x) { return x * 9 + 13 + this.f; }
  m9(x) { return x * 10 + 13 + this.f; }
  m10(x) { return x * 11 + 13 + this.f; }
  m11(x) { return x * 12 + 13 + this.f; }
  m12(x) { return x * 13 + 13 + this.f; }
  m13(x) { return x * 14 + 13 + this.f; }
  m14(x) { return x * 15 + 13 + this.f; }
  m15(x) { return x * 16 + 13 + this.f; }
  m16(x) { return x * 17 + 13 + this.f; }
  m17(x) { return x * 18 + 13 + this.f; }
}
class C14 extends EventEmitter {
  constructor() {
    super();
    this.f = 14;
    this.tag = "c14";
  }
  put(k, v) {
    this[k] = v;
  }
  m0(x) { return x * 1 + 14 + this.f; }
  m1(x) { return x * 2 + 14 + this.f; }
  m2(x) { return x * 3 + 14 + this.f; }
  m3(x) { return x * 4 + 14 + this.f; }
  m4(x) { return x * 5 + 14 + this.f; }
  m5(x) { return x * 6 + 14 + this.f; }
  m6(x) { return x * 7 + 14 + this.f; }
  m7(x) { return x * 8 + 14 + this.f; }
  m8(x) { return x * 9 + 14 + this.f; }
  m9(x) { return x * 10 + 14 + this.f; }
  m10(x) { return x * 11 + 14 + this.f; }
  m11(x) { return x * 12 + 14 + this.f; }
  m12(x) { return x * 13 + 14 + this.f; }
  m13(x) { return x * 14 + 14 + this.f; }
  m14(x) { return x * 15 + 14 + this.f; }
  m15(x) { return x * 16 + 14 + this.f; }
  m16(x) { return x * 17 + 14 + this.f; }
  m17(x) { return x * 18 + 14 + this.f; }
}
class C15 {
  constructor() {
    this.f = 15;
    this.tag = "c15";
  }
  put(k, v) {
    this[k] = v;
  }
  z0() { return 0; }
  m0(x) { return x * 1 + 15 + this.f; }
  m1(x) { return x * 2 + 15 + this.f; }
  m2(x) { return x * 3 + 15 + this.f; }
  m3(x) { return x * 4 + 15 + this.f; }
  m4(x) { return x * 5 + 15 + this.f; }
  m5(x) { return x * 6 + 15 + this.f; }
  m6(x) { return x * 7 + 15 + this.f; }
  m7(x) { return x * 8 + 15 + this.f; }
  m8(x) { return x * 9 + 15 + this.f; }
  m9(x) { return x * 10 + 15 + this.f; }
  m10(x) { return x * 11 + 15 + this.f; }
  m11(x) { return x * 12 + 15 + this.f; }
  m12(x) { return x * 13 + 15 + this.f; }
  m13(x) { return x * 14 + 15 + this.f; }
  m14(x) { return x * 15 + 15 + this.f; }
  m15(x) { return x * 16 + 15 + this.f; }
  m16(x) { return x * 17 + 15 + this.f; }
  m17(x) { return x * 18 + 15 + this.f; }
}
class C16 extends EventEmitter {
  constructor() {
    super();
    this.f = 16;
    this.tag = "c16";
  }
  put(k, v) {
    this[k] = v;
  }
  z0() { return 0; }
  z1() { return 1; }
  m0(x) { return x * 1 + 16 + this.f; }
  m1(x) { return x * 2 + 16 + this.f; }
  m2(x) { return x * 3 + 16 + this.f; }
  m3(x) { return x * 4 + 16 + this.f; }
  m4(x) { return x * 5 + 16 + this.f; }
  m5(x) { return x * 6 + 16 + this.f; }
  m6(x) { return x * 7 + 16 + this.f; }
  m7(x) { return x * 8 + 16 + this.f; }
  m8(x) { return x * 9 + 16 + this.f; }
  m9(x) { return x * 10 + 16 + this.f; }
  m10(x) { return x * 11 + 16 + this.f; }
  m11(x) { return x * 12 + 16 + this.f; }
  m12(x) { return x * 13 + 16 + this.f; }
  m13(x) { return x * 14 + 16 + this.f; }
  m14(x) { return x * 15 + 16 + this.f; }
  m15(x) { return x * 16 + 16 + this.f; }
  m16(x) { return x * 17 + 16 + this.f; }
  m17(x) { return x * 18 + 16 + this.f; }
}
class C17 {
  constructor() {
    this.f = 17;
    this.tag = "c17";
  }
  put(k, v) {
    this[k] = v;
  }
  z0() { return 0; }
  z1() { return 1; }
  z2() { return 2; }
  m0(x) { return x * 1 + 17 + this.f; }
  m1(x) { return x * 2 + 17 + this.f; }
  m2(x) { return x * 3 + 17 + this.f; }
  m3(x) { return x * 4 + 17 + this.f; }
  m4(x) { return x * 5 + 17 + this.f; }
  m5(x) { return x * 6 + 17 + this.f; }
  m6(x) { return x * 7 + 17 + this.f; }
  m7(x) { return x * 8 + 17 + this.f; }
  m8(x) { return x * 9 + 17 + this.f; }
  m9(x) { return x * 10 + 17 + this.f; }
  m10(x) { return x * 11 + 17 + this.f; }
  m11(x) { return x * 12 + 17 + this.f; }
  m12(x) { return x * 13 + 17 + this.f; }
  m13(x) { return x * 14 + 17 + this.f; }
  m14(x) { return x * 15 + 17 + this.f; }
  m15(x) { return x * 16 + 17 + this.f; }
  m16(x) { return x * 17 + 17 + this.f; }
  m17(x) { return x * 18 + 17 + this.f; }
}
class C18 extends EventEmitter {
  constructor() {
    super();
    this.f = 18;
    this.tag = "c18";
  }
  put(k, v) {
    this[k] = v;
  }
  z0() { return 0; }
  z1() { return 1; }
  z2() { return 2; }
  z3() { return 3; }
  m0(x) { return x * 1 + 18 + this.f; }
  m1(x) { return x * 2 + 18 + this.f; }
  m2(x) { return x * 3 + 18 + this.f; }
  m3(x) { return x * 4 + 18 + this.f; }
  m4(x) { return x * 5 + 18 + this.f; }
  m5(x) { return x * 6 + 18 + this.f; }
  m6(x) { return x * 7 + 18 + this.f; }
  m7(x) { return x * 8 + 18 + this.f; }
  m8(x) { return x * 9 + 18 + this.f; }
  m9(x) { return x * 10 + 18 + this.f; }
  m10(x) { return x * 11 + 18 + this.f; }
  m11(x) { return x * 12 + 18 + this.f; }
  m12(x) { return x * 13 + 18 + this.f; }
  m13(x) { return x * 14 + 18 + this.f; }
  m14(x) { return x * 15 + 18 + this.f; }
  m15(x) { return x * 16 + 18 + this.f; }
  m16(x) { return x * 17 + 18 + this.f; }
  m17(x) { return x * 18 + 18 + this.f; }
}
class C19 {
  constructor() {
    this.f = 19;
    this.tag = "c19";
  }
  put(k, v) {
    this[k] = v;
  }
  z0() { return 0; }
  z1() { return 1; }
  z2() { return 2; }
  z3() { return 3; }
  z4() { return 4; }
  m0(x) { return x * 1 + 19 + this.f; }
  m1(x) { return x * 2 + 19 + this.f; }
  m2(x) { return x * 3 + 19 + this.f; }
  m3(x) { return x * 4 + 19 + this.f; }
  m4(x) { return x * 5 + 19 + this.f; }
  m5(x) { return x * 6 + 19 + this.f; }
  m6(x) { return x * 7 + 19 + this.f; }
  m7(x) { return x * 8 + 19 + this.f; }
  m8(x) { return x * 9 + 19 + this.f; }
  m9(x) { return x * 10 + 19 + this.f; }
  m10(x) { return x * 11 + 19 + this.f; }
  m11(x) { return x * 12 + 19 + this.f; }
  m12(x) { return x * 13 + 19 + this.f; }
  m13(x) { return x * 14 + 19 + this.f; }
  m14(x) { return x * 15 + 19 + this.f; }
  m15(x) { return x * 16 + 19 + this.f; }
  m16(x) { return x * 17 + 19 + this.f; }
  m17(x) { return x * 18 + 19 + this.f; }
}
class C20 extends EventEmitter {
  constructor() {
    super();
    this.f = 20;
    this.tag = "c20";
  }
  put(k, v) {
    this[k] = v;
  }
  z0() { return 0; }
  z1() { return 1; }
  z2() { return 2; }
  z3() { return 3; }
  z4() { return 4; }
  z5() { return 5; }
  m0(x) { return x * 1 + 20 + this.f; }
  m1(x) { return x * 2 + 20 + this.f; }
  m2(x) { return x * 3 + 20 + this.f; }
  m3(x) { return x * 4 + 20 + this.f; }
  m4(x) { return x * 5 + 20 + this.f; }
  m5(x) { return x * 6 + 20 + this.f; }
  m6(x) { return x * 7 + 20 + this.f; }
  m7(x) { return x * 8 + 20 + this.f; }
  m8(x) { return x * 9 + 20 + this.f; }
  m9(x) { return x * 10 + 20 + this.f; }
  m10(x) { return x * 11 + 20 + this.f; }
  m11(x) { return x * 12 + 20 + this.f; }
  m12(x) { return x * 13 + 20 + this.f; }
  m13(x) { return x * 14 + 20 + this.f; }
  m14(x) { return x * 15 + 20 + this.f; }
  m15(x) { return x * 16 + 20 + this.f; }
  m16(x) { return x * 17 + 20 + this.f; }
  m17(x) { return x * 18 + 20 + this.f; }
}
class C21 {
  constructor() {
    this.f = 21;
    this.tag = "c21";
  }
  put(k, v) {
    this[k] = v;
  }
  m0(x) { return x * 1 + 21 + this.f; }
  m1(x) { return x * 2 + 21 + this.f; }
  m2(x) { return x * 3 + 21 + this.f; }
  m3(x) { return x * 4 + 21 + this.f; }
  m4(x) { return x * 5 + 21 + this.f; }
  m5(x) { return x * 6 + 21 + this.f; }
  m6(x) { return x * 7 + 21 + this.f; }
  m7(x) { return x * 8 + 21 + this.f; }
  m8(x) { return x * 9 + 21 + this.f; }
  m9(x) { return x * 10 + 21 + this.f; }
  m10(x) { return x * 11 + 21 + this.f; }
  m11(x) { return x * 12 + 21 + this.f; }
  m12(x) { return x * 13 + 21 + this.f; }
  m13(x) { return x * 14 + 21 + this.f; }
  m14(x) { return x * 15 + 21 + this.f; }
  m15(x) { return x * 16 + 21 + this.f; }
  m16(x) { return x * 17 + 21 + this.f; }
  m17(x) { return x * 18 + 21 + this.f; }
}
class C22 extends EventEmitter {
  constructor() {
    super();
    this.f = 22;
    this.tag = "c22";
  }
  put(k, v) {
    this[k] = v;
  }
  z0() { return 0; }
  m0(x) { return x * 1 + 22 + this.f; }
  m1(x) { return x * 2 + 22 + this.f; }
  m2(x) { return x * 3 + 22 + this.f; }
  m3(x) { return x * 4 + 22 + this.f; }
  m4(x) { return x * 5 + 22 + this.f; }
  m5(x) { return x * 6 + 22 + this.f; }
  m6(x) { return x * 7 + 22 + this.f; }
  m7(x) { return x * 8 + 22 + this.f; }
  m8(x) { return x * 9 + 22 + this.f; }
  m9(x) { return x * 10 + 22 + this.f; }
  m10(x) { return x * 11 + 22 + this.f; }
  m11(x) { return x * 12 + 22 + this.f; }
  m12(x) { return x * 13 + 22 + this.f; }
  m13(x) { return x * 14 + 22 + this.f; }
  m14(x) { return x * 15 + 22 + this.f; }
  m15(x) { return x * 16 + 22 + this.f; }
  m16(x) { return x * 17 + 22 + this.f; }
  m17(x) { return x * 18 + 22 + this.f; }
}
class C23 {
  constructor() {
    this.f = 23;
    this.tag = "c23";
  }
  put(k, v) {
    this[k] = v;
  }
  z0() { return 0; }
  z1() { return 1; }
  m0(x) { return x * 1 + 23 + this.f; }
  m1(x) { return x * 2 + 23 + this.f; }
  m2(x) { return x * 3 + 23 + this.f; }
  m3(x) { return x * 4 + 23 + this.f; }
  m4(x) { return x * 5 + 23 + this.f; }
  m5(x) { return x * 6 + 23 + this.f; }
  m6(x) { return x * 7 + 23 + this.f; }
  m7(x) { return x * 8 + 23 + this.f; }
  m8(x) { return x * 9 + 23 + this.f; }
  m9(x) { return x * 10 + 23 + this.f; }
  m10(x) { return x * 11 + 23 + this.f; }
  m11(x) { return x * 12 + 23 + this.f; }
  m12(x) { return x * 13 + 23 + this.f; }
  m13(x) { return x * 14 + 23 + this.f; }
  m14(x) { return x * 15 + 23 + this.f; }
  m15(x) { return x * 16 + 23 + this.f; }
  m16(x) { return x * 17 + 23 + this.f; }
  m17(x) { return x * 18 + 23 + this.f; }
}
class C24 extends EventEmitter {
  constructor() {
    super();
    this.f = 24;
    this.tag = "c24";
  }
  put(k, v) {
    this[k] = v;
  }
  z0() { return 0; }
  z1() { return 1; }
  z2() { return 2; }
  m0(x) { return x * 1 + 24 + this.f; }
  m1(x) { return x * 2 + 24 + this.f; }
  m2(x) { return x * 3 + 24 + this.f; }
  m3(x) { return x * 4 + 24 + this.f; }
  m4(x) { return x * 5 + 24 + this.f; }
  m5(x) { return x * 6 + 24 + this.f; }
  m6(x) { return x * 7 + 24 + this.f; }
  m7(x) { return x * 8 + 24 + this.f; }
  m8(x) { return x * 9 + 24 + this.f; }
  m9(x) { return x * 10 + 24 + this.f; }
  m10(x) { return x * 11 + 24 + this.f; }
  m11(x) { return x * 12 + 24 + this.f; }
  m12(x) { return x * 13 + 24 + this.f; }
  m13(x) { return x * 14 + 24 + this.f; }
  m14(x) { return x * 15 + 24 + this.f; }
  m15(x) { return x * 16 + 24 + this.f; }
  m16(x) { return x * 17 + 24 + this.f; }
  m17(x) { return x * 18 + 24 + this.f; }
}
class C25 {
  constructor() {
    this.f = 25;
    this.tag = "c25";
  }
  put(k, v) {
    this[k] = v;
  }
  z0() { return 0; }
  z1() { return 1; }
  z2() { return 2; }
  z3() { return 3; }
  m0(x) { return x * 1 + 25 + this.f; }
  m1(x) { return x * 2 + 25 + this.f; }
  m2(x) { return x * 3 + 25 + this.f; }
  m3(x) { return x * 4 + 25 + this.f; }
  m4(x) { return x * 5 + 25 + this.f; }
  m5(x) { return x * 6 + 25 + this.f; }
  m6(x) { return x * 7 + 25 + this.f; }
  m7(x) { return x * 8 + 25 + this.f; }
  m8(x) { return x * 9 + 25 + this.f; }
  m9(x) { return x * 10 + 25 + this.f; }
  m10(x) { return x * 11 + 25 + this.f; }
  m11(x) { return x * 12 + 25 + this.f; }
  m12(x) { return x * 13 + 25 + this.f; }
  m13(x) { return x * 14 + 25 + this.f; }
  m14(x) { return x * 15 + 25 + this.f; }
  m15(x) { return x * 16 + 25 + this.f; }
  m16(x) { return x * 17 + 25 + this.f; }
  m17(x) { return x * 18 + 25 + this.f; }
}
class C26 extends EventEmitter {
  constructor() {
    super();
    this.f = 26;
    this.tag = "c26";
  }
  put(k, v) {
    this[k] = v;
  }
  z0() { return 0; }
  z1() { return 1; }
  z2() { return 2; }
  z3() { return 3; }
  z4() { return 4; }
  m0(x) { return x * 1 + 26 + this.f; }
  m1(x) { return x * 2 + 26 + this.f; }
  m2(x) { return x * 3 + 26 + this.f; }
  m3(x) { return x * 4 + 26 + this.f; }
  m4(x) { return x * 5 + 26 + this.f; }
  m5(x) { return x * 6 + 26 + this.f; }
  m6(x) { return x * 7 + 26 + this.f; }
  m7(x) { return x * 8 + 26 + this.f; }
  m8(x) { return x * 9 + 26 + this.f; }
  m9(x) { return x * 10 + 26 + this.f; }
  m10(x) { return x * 11 + 26 + this.f; }
  m11(x) { return x * 12 + 26 + this.f; }
  m12(x) { return x * 13 + 26 + this.f; }
  m13(x) { return x * 14 + 26 + this.f; }
  m14(x) { return x * 15 + 26 + this.f; }
  m15(x) { return x * 16 + 26 + this.f; }
  m16(x) { return x * 17 + 26 + this.f; }
  m17(x) { return x * 18 + 26 + this.f; }
}
class C27 {
  constructor() {
    this.f = 27;
    this.tag = "c27";
  }
  put(k, v) {
    this[k] = v;
  }
  z0() { return 0; }
  z1() { return 1; }
  z2() { return 2; }
  z3() { return 3; }
  z4() { return 4; }
  z5() { return 5; }
  m0(x) { return x * 1 + 27 + this.f; }
  m1(x) { return x * 2 + 27 + this.f; }
  m2(x) { return x * 3 + 27 + this.f; }
  m3(x) { return x * 4 + 27 + this.f; }
  m4(x) { return x * 5 + 27 + this.f; }
  m5(x) { return x * 6 + 27 + this.f; }
  m6(x) { return x * 7 + 27 + this.f; }
  m7(x) { return x * 8 + 27 + this.f; }
  m8(x) { return x * 9 + 27 + this.f; }
  m9(x) { return x * 10 + 27 + this.f; }
  m10(x) { return x * 11 + 27 + this.f; }
  m11(x) { return x * 12 + 27 + this.f; }
  m12(x) { return x * 13 + 27 + this.f; }
  m13(x) { return x * 14 + 27 + this.f; }
  m14(x) { return x * 15 + 27 + this.f; }
  m15(x) { return x * 16 + 27 + this.f; }
  m16(x) { return x * 17 + 27 + this.f; }
  m17(x) { return x * 18 + 27 + this.f; }
}
class C28 extends EventEmitter {
  constructor() {
    super();
    this.f = 28;
    this.tag = "c28";
  }
  put(k, v) {
    this[k] = v;
  }
  m0(x) { return x * 1 + 28 + this.f; }
  m1(x) { return x * 2 + 28 + this.f; }
  m2(x) { return x * 3 + 28 + this.f; }
  m3(x) { return x * 4 + 28 + this.f; }
  m4(x) { return x * 5 + 28 + this.f; }
  m5(x) { return x * 6 + 28 + this.f; }
  m6(x) { return x * 7 + 28 + this.f; }
  m7(x) { return x * 8 + 28 + this.f; }
  m8(x) { return x * 9 + 28 + this.f; }
  m9(x) { return x * 10 + 28 + this.f; }
  m10(x) { return x * 11 + 28 + this.f; }
  m11(x) { return x * 12 + 28 + this.f; }
  m12(x) { return x * 13 + 28 + this.f; }
  m13(x) { return x * 14 + 28 + this.f; }
  m14(x) { return x * 15 + 28 + this.f; }
  m15(x) { return x * 16 + 28 + this.f; }
  m16(x) { return x * 17 + 28 + this.f; }
  m17(x) { return x * 18 + 28 + this.f; }
}
class C29 {
  constructor() {
    this.f = 29;
    this.tag = "c29";
  }
  put(k, v) {
    this[k] = v;
  }
  z0() { return 0; }
  m0(x) { return x * 1 + 29 + this.f; }
  m1(x) { return x * 2 + 29 + this.f; }
  m2(x) { return x * 3 + 29 + this.f; }
  m3(x) { return x * 4 + 29 + this.f; }
  m4(x) { return x * 5 + 29 + this.f; }
  m5(x) { return x * 6 + 29 + this.f; }
  m6(x) { return x * 7 + 29 + this.f; }
  m7(x) { return x * 8 + 29 + this.f; }
  m8(x) { return x * 9 + 29 + this.f; }
  m9(x) { return x * 10 + 29 + this.f; }
  m10(x) { return x * 11 + 29 + this.f; }
  m11(x) { return x * 12 + 29 + this.f; }
  m12(x) { return x * 13 + 29 + this.f; }
  m13(x) { return x * 14 + 29 + this.f; }
  m14(x) { return x * 15 + 29 + this.f; }
  m15(x) { return x * 16 + 29 + this.f; }
  m16(x) { return x * 17 + 29 + this.f; }
  m17(x) { return x * 18 + 29 + this.f; }
}
class C30 extends EventEmitter {
  constructor() {
    super();
    this.f = 30;
    this.tag = "c30";
  }
  put(k, v) {
    this[k] = v;
  }
  z0() { return 0; }
  z1() { return 1; }
  m0(x) { return x * 1 + 30 + this.f; }
  m1(x) { return x * 2 + 30 + this.f; }
  m2(x) { return x * 3 + 30 + this.f; }
  m3(x) { return x * 4 + 30 + this.f; }
  m4(x) { return x * 5 + 30 + this.f; }
  m5(x) { return x * 6 + 30 + this.f; }
  m6(x) { return x * 7 + 30 + this.f; }
  m7(x) { return x * 8 + 30 + this.f; }
  m8(x) { return x * 9 + 30 + this.f; }
  m9(x) { return x * 10 + 30 + this.f; }
  m10(x) { return x * 11 + 30 + this.f; }
  m11(x) { return x * 12 + 30 + this.f; }
  m12(x) { return x * 13 + 30 + this.f; }
  m13(x) { return x * 14 + 30 + this.f; }
  m14(x) { return x * 15 + 30 + this.f; }
  m15(x) { return x * 16 + 30 + this.f; }
  m16(x) { return x * 17 + 30 + this.f; }
  m17(x) { return x * 18 + 30 + this.f; }
}
class C31 {
  constructor() {
    this.f = 31;
    this.tag = "c31";
  }
  put(k, v) {
    this[k] = v;
  }
  z0() { return 0; }
  z1() { return 1; }
  z2() { return 2; }
  m0(x) { return x * 1 + 31 + this.f; }
  m1(x) { return x * 2 + 31 + this.f; }
  m2(x) { return x * 3 + 31 + this.f; }
  m3(x) { return x * 4 + 31 + this.f; }
  m4(x) { return x * 5 + 31 + this.f; }
  m5(x) { return x * 6 + 31 + this.f; }
  m6(x) { return x * 7 + 31 + this.f; }
  m7(x) { return x * 8 + 31 + this.f; }
  m8(x) { return x * 9 + 31 + this.f; }
  m9(x) { return x * 10 + 31 + this.f; }
  m10(x) { return x * 11 + 31 + this.f; }
  m11(x) { return x * 12 + 31 + this.f; }
  m12(x) { return x * 13 + 31 + this.f; }
  m13(x) { return x * 14 + 31 + this.f; }
  m14(x) { return x * 15 + 31 + this.f; }
  m15(x) { return x * 16 + 31 + this.f; }
  m16(x) { return x * 17 + 31 + this.f; }
  m17(x) { return x * 18 + 31 + this.f; }
}
class C32 extends EventEmitter {
  constructor() {
    super();
    this.f = 32;
    this.tag = "c32";
  }
  put(k, v) {
    this[k] = v;
  }
  z0() { return 0; }
  z1() { return 1; }
  z2() { return 2; }
  z3() { return 3; }
  m0(x) { return x * 1 + 32 + this.f; }
  m1(x) { return x * 2 + 32 + this.f; }
  m2(x) { return x * 3 + 32 + this.f; }
  m3(x) { return x * 4 + 32 + this.f; }
  m4(x) { return x * 5 + 32 + this.f; }
  m5(x) { return x * 6 + 32 + this.f; }
  m6(x) { return x * 7 + 32 + this.f; }
  m7(x) { return x * 8 + 32 + this.f; }
  m8(x) { return x * 9 + 32 + this.f; }
  m9(x) { return x * 10 + 32 + this.f; }
  m10(x) { return x * 11 + 32 + this.f; }
  m11(x) { return x * 12 + 32 + this.f; }
  m12(x) { return x * 13 + 32 + this.f; }
  m13(x) { return x * 14 + 32 + this.f; }
  m14(x) { return x * 15 + 32 + this.f; }
  m15(x) { return x * 16 + 32 + this.f; }
  m16(x) { return x * 17 + 32 + this.f; }
  m17(x) { return x * 18 + 32 + this.f; }
}
class C33 {
  constructor() {
    this.f = 33;
    this.tag = "c33";
  }
  put(k, v) {
    this[k] = v;
  }
  z0() { return 0; }
  z1() { return 1; }
  z2() { return 2; }
  z3() { return 3; }
  z4() { return 4; }
  m0(x) { return x * 1 + 33 + this.f; }
  m1(x) { return x * 2 + 33 + this.f; }
  m2(x) { return x * 3 + 33 + this.f; }
  m3(x) { return x * 4 + 33 + this.f; }
  m4(x) { return x * 5 + 33 + this.f; }
  m5(x) { return x * 6 + 33 + this.f; }
  m6(x) { return x * 7 + 33 + this.f; }
  m7(x) { return x * 8 + 33 + this.f; }
  m8(x) { return x * 9 + 33 + this.f; }
  m9(x) { return x * 10 + 33 + this.f; }
  m10(x) { return x * 11 + 33 + this.f; }
  m11(x) { return x * 12 + 33 + this.f; }
  m12(x) { return x * 13 + 33 + this.f; }
  m13(x) { return x * 14 + 33 + this.f; }
  m14(x) { return x * 15 + 33 + this.f; }
  m15(x) { return x * 16 + 33 + this.f; }
  m16(x) { return x * 17 + 33 + this.f; }
  m17(x) { return x * 18 + 33 + this.f; }
}
class C34 extends EventEmitter {
  constructor() {
    super();
    this.f = 34;
    this.tag = "c34";
  }
  put(k, v) {
    this[k] = v;
  }
  z0() { return 0; }
  z1() { return 1; }
  z2() { return 2; }
  z3() { return 3; }
  z4() { return 4; }
  z5() { return 5; }
  m0(x) { return x * 1 + 34 + this.f; }
  m1(x) { return x * 2 + 34 + this.f; }
  m2(x) { return x * 3 + 34 + this.f; }
  m3(x) { return x * 4 + 34 + this.f; }
  m4(x) { return x * 5 + 34 + this.f; }
  m5(x) { return x * 6 + 34 + this.f; }
  m6(x) { return x * 7 + 34 + this.f; }
  m7(x) { return x * 8 + 34 + this.f; }
  m8(x) { return x * 9 + 34 + this.f; }
  m9(x) { return x * 10 + 34 + this.f; }
  m10(x) { return x * 11 + 34 + this.f; }
  m11(x) { return x * 12 + 34 + this.f; }
  m12(x) { return x * 13 + 34 + this.f; }
  m13(x) { return x * 14 + 34 + this.f; }
  m14(x) { return x * 15 + 34 + this.f; }
  m15(x) { return x * 16 + 34 + this.f; }
  m16(x) { return x * 17 + 34 + this.f; }
  m17(x) { return x * 18 + 34 + this.f; }
}
class C35 {
  constructor() {
    this.f = 35;
    this.tag = "c35";
  }
  put(k, v) {
    this[k] = v;
  }
  m0(x) { return x * 1 + 35 + this.f; }
  m1(x) { return x * 2 + 35 + this.f; }
  m2(x) { return x * 3 + 35 + this.f; }
  m3(x) { return x * 4 + 35 + this.f; }
  m4(x) { return x * 5 + 35 + this.f; }
  m5(x) { return x * 6 + 35 + this.f; }
  m6(x) { return x * 7 + 35 + this.f; }
  m7(x) { return x * 8 + 35 + this.f; }
  m8(x) { return x * 9 + 35 + this.f; }
  m9(x) { return x * 10 + 35 + this.f; }
  m10(x) { return x * 11 + 35 + this.f; }
  m11(x) { return x * 12 + 35 + this.f; }
  m12(x) { return x * 13 + 35 + this.f; }
  m13(x) { return x * 14 + 35 + this.f; }
  m14(x) { return x * 15 + 35 + this.f; }
  m15(x) { return x * 16 + 35 + this.f; }
  m16(x) { return x * 17 + 35 + this.f; }
  m17(x) { return x * 18 + 35 + this.f; }
}
class C36 extends EventEmitter {
  constructor() {
    super();
    this.f = 36;
    this.tag = "c36";
  }
  put(k, v) {
    this[k] = v;
  }
  z0() { return 0; }
  m0(x) { return x * 1 + 36 + this.f; }
  m1(x) { return x * 2 + 36 + this.f; }
  m2(x) { return x * 3 + 36 + this.f; }
  m3(x) { return x * 4 + 36 + this.f; }
  m4(x) { return x * 5 + 36 + this.f; }
  m5(x) { return x * 6 + 36 + this.f; }
  m6(x) { return x * 7 + 36 + this.f; }
  m7(x) { return x * 8 + 36 + this.f; }
  m8(x) { return x * 9 + 36 + this.f; }
  m9(x) { return x * 10 + 36 + this.f; }
  m10(x) { return x * 11 + 36 + this.f; }
  m11(x) { return x * 12 + 36 + this.f; }
  m12(x) { return x * 13 + 36 + this.f; }
  m13(x) { return x * 14 + 36 + this.f; }
  m14(x) { return x * 15 + 36 + this.f; }
  m15(x) { return x * 16 + 36 + this.f; }
  m16(x) { return x * 17 + 36 + this.f; }
  m17(x) { return x * 18 + 36 + this.f; }
}
class C37 {
  constructor() {
    this.f = 37;
    this.tag = "c37";
  }
  put(k, v) {
    this[k] = v;
  }
  z0() { return 0; }
  z1() { return 1; }
  m0(x) { return x * 1 + 37 + this.f; }
  m1(x) { return x * 2 + 37 + this.f; }
  m2(x) { return x * 3 + 37 + this.f; }
  m3(x) { return x * 4 + 37 + this.f; }
  m4(x) { return x * 5 + 37 + this.f; }
  m5(x) { return x * 6 + 37 + this.f; }
  m6(x) { return x * 7 + 37 + this.f; }
  m7(x) { return x * 8 + 37 + this.f; }
  m8(x) { return x * 9 + 37 + this.f; }
  m9(x) { return x * 10 + 37 + this.f; }
  m10(x) { return x * 11 + 37 + this.f; }
  m11(x) { return x * 12 + 37 + this.f; }
  m12(x) { return x * 13 + 37 + this.f; }
  m13(x) { return x * 14 + 37 + this.f; }
  m14(x) { return x * 15 + 37 + this.f; }
  m15(x) { return x * 16 + 37 + this.f; }
  m16(x) { return x * 17 + 37 + this.f; }
  m17(x) { return x * 18 + 37 + this.f; }
}
class C38 extends EventEmitter {
  constructor() {
    super();
    this.f = 38;
    this.tag = "c38";
  }
  put(k, v) {
    this[k] = v;
  }
  z0() { return 0; }
  z1() { return 1; }
  z2() { return 2; }
  m0(x) { return x * 1 + 38 + this.f; }
  m1(x) { return x * 2 + 38 + this.f; }
  m2(x) { return x * 3 + 38 + this.f; }
  m3(x) { return x * 4 + 38 + this.f; }
  m4(x) { return x * 5 + 38 + this.f; }
  m5(x) { return x * 6 + 38 + this.f; }
  m6(x) { return x * 7 + 38 + this.f; }
  m7(x) { return x * 8 + 38 + this.f; }
  m8(x) { return x * 9 + 38 + this.f; }
  m9(x) { return x * 10 + 38 + this.f; }
  m10(x) { return x * 11 + 38 + this.f; }
  m11(x) { return x * 12 + 38 + this.f; }
  m12(x) { return x * 13 + 38 + this.f; }
  m13(x) { return x * 14 + 38 + this.f; }
  m14(x) { return x * 15 + 38 + this.f; }
  m15(x) { return x * 16 + 38 + this.f; }
  m16(x) { return x * 17 + 38 + this.f; }
  m17(x) { return x * 18 + 38 + this.f; }
}
class C39 {
  constructor() {
    this.f = 39;
    this.tag = "c39";
  }
  put(k, v) {
    this[k] = v;
  }
  z0() { return 0; }
  z1() { return 1; }
  z2() { return 2; }
  z3() { return 3; }
  m0(x) { return x * 1 + 39 + this.f; }
  m1(x) { return x * 2 + 39 + this.f; }
  m2(x) { return x * 3 + 39 + this.f; }
  m3(x) { return x * 4 + 39 + this.f; }
  m4(x) { return x * 5 + 39 + this.f; }
  m5(x) { return x * 6 + 39 + this.f; }
  m6(x) { return x * 7 + 39 + this.f; }
  m7(x) { return x * 8 + 39 + this.f; }
  m8(x) { return x * 9 + 39 + this.f; }
  m9(x) { return x * 10 + 39 + this.f; }
  m10(x) { return x * 11 + 39 + this.f; }
  m11(x) { return x * 12 + 39 + this.f; }
  m12(x) { return x * 13 + 39 + this.f; }
  m13(x) { return x * 14 + 39 + this.f; }
  m14(x) { return x * 15 + 39 + this.f; }
  m15(x) { return x * 16 + 39 + this.f; }
  m16(x) { return x * 17 + 39 + this.f; }
  m17(x) { return x * 18 + 39 + this.f; }
}
class C40 extends EventEmitter {
  constructor() {
    super();
    this.f = 40;
    this.tag = "c40";
  }
  put(k, v) {
    this[k] = v;
  }
  z0() { return 0; }
  z1() { return 1; }
  z2() { return 2; }
  z3() { return 3; }
  z4() { return 4; }
  m0(x) { return x * 1 + 40 + this.f; }
  m1(x) { return x * 2 + 40 + this.f; }
  m2(x) { return x * 3 + 40 + this.f; }
  m3(x) { return x * 4 + 40 + this.f; }
  m4(x) { return x * 5 + 40 + this.f; }
  m5(x) { return x * 6 + 40 + this.f; }
  m6(x) { return x * 7 + 40 + this.f; }
  m7(x) { return x * 8 + 40 + this.f; }
  m8(x) { return x * 9 + 40 + this.f; }
  m9(x) { return x * 10 + 40 + this.f; }
  m10(x) { return x * 11 + 40 + this.f; }
  m11(x) { return x * 12 + 40 + this.f; }
  m12(x) { return x * 13 + 40 + this.f; }
  m13(x) { return x * 14 + 40 + this.f; }
  m14(x) { return x * 15 + 40 + this.f; }
  m15(x) { return x * 16 + 40 + this.f; }
  m16(x) { return x * 17 + 40 + this.f; }
  m17(x) { return x * 18 + 40 + this.f; }
}
class C41 {
  constructor() {
    this.f = 41;
    this.tag = "c41";
  }
  put(k, v) {
    this[k] = v;
  }
  z0() { return 0; }
  z1() { return 1; }
  z2() { return 2; }
  z3() { return 3; }
  z4() { return 4; }
  z5() { return 5; }
  m0(x) { return x * 1 + 41 + this.f; }
  m1(x) { return x * 2 + 41 + this.f; }
  m2(x) { return x * 3 + 41 + this.f; }
  m3(x) { return x * 4 + 41 + this.f; }
  m4(x) { return x * 5 + 41 + this.f; }
  m5(x) { return x * 6 + 41 + this.f; }
  m6(x) { return x * 7 + 41 + this.f; }
  m7(x) { return x * 8 + 41 + this.f; }
  m8(x) { return x * 9 + 41 + this.f; }
  m9(x) { return x * 10 + 41 + this.f; }
  m10(x) { return x * 11 + 41 + this.f; }
  m11(x) { return x * 12 + 41 + this.f; }
  m12(x) { return x * 13 + 41 + this.f; }
  m13(x) { return x * 14 + 41 + this.f; }
  m14(x) { return x * 15 + 41 + this.f; }
  m15(x) { return x * 16 + 41 + this.f; }
  m16(x) { return x * 17 + 41 + this.f; }
  m17(x) { return x * 18 + 41 + this.f; }
}
class C42 extends EventEmitter {
  constructor() {
    super();
    this.f = 42;
    this.tag = "c42";
  }
  put(k, v) {
    this[k] = v;
  }
  m0(x) { return x * 1 + 42 + this.f; }
  m1(x) { return x * 2 + 42 + this.f; }
  m2(x) { return x * 3 + 42 + this.f; }
  m3(x) { return x * 4 + 42 + this.f; }
  m4(x) { return x * 5 + 42 + this.f; }
  m5(x) { return x * 6 + 42 + this.f; }
  m6(x) { return x * 7 + 42 + this.f; }
  m7(x) { return x * 8 + 42 + this.f; }
  m8(x) { return x * 9 + 42 + this.f; }
  m9(x) { return x * 10 + 42 + this.f; }
  m10(x) { return x * 11 + 42 + this.f; }
  m11(x) { return x * 12 + 42 + this.f; }
  m12(x) { return x * 13 + 42 + this.f; }
  m13(x) { return x * 14 + 42 + this.f; }
  m14(x) { return x * 15 + 42 + this.f; }
  m15(x) { return x * 16 + 42 + this.f; }
  m16(x) { return x * 17 + 42 + this.f; }
  m17(x) { return x * 18 + 42 + this.f; }
}
class C43 {
  constructor() {
    this.f = 43;
    this.tag = "c43";
  }
  put(k, v) {
    this[k] = v;
  }
  z0() { return 0; }
  m0(x) { return x * 1 + 43 + this.f; }
  m1(x) { return x * 2 + 43 + this.f; }
  m2(x) { return x * 3 + 43 + this.f; }
  m3(x) { return x * 4 + 43 + this.f; }
  m4(x) { return x * 5 + 43 + this.f; }
  m5(x) { return x * 6 + 43 + this.f; }
  m6(x) { return x * 7 + 43 + this.f; }
  m7(x) { return x * 8 + 43 + this.f; }
  m8(x) { return x * 9 + 43 + this.f; }
  m9(x) { return x * 10 + 43 + this.f; }
  m10(x) { return x * 11 + 43 + this.f; }
  m11(x) { return x * 12 + 43 + this.f; }
  m12(x) { return x * 13 + 43 + this.f; }
  m13(x) { return x * 14 + 43 + this.f; }
  m14(x) { return x * 15 + 43 + this.f; }
  m15(x) { return x * 16 + 43 + this.f; }
  m16(x) { return x * 17 + 43 + this.f; }
  m17(x) { return x * 18 + 43 + this.f; }
}
class C44 extends EventEmitter {
  constructor() {
    super();
    this.f = 44;
    this.tag = "c44";
  }
  put(k, v) {
    this[k] = v;
  }
  z0() { return 0; }
  z1() { return 1; }
  m0(x) { return x * 1 + 44 + this.f; }
  m1(x) { return x * 2 + 44 + this.f; }
  m2(x) { return x * 3 + 44 + this.f; }
  m3(x) { return x * 4 + 44 + this.f; }
  m4(x) { return x * 5 + 44 + this.f; }
  m5(x) { return x * 6 + 44 + this.f; }
  m6(x) { return x * 7 + 44 + this.f; }
  m7(x) { return x * 8 + 44 + this.f; }
  m8(x) { return x * 9 + 44 + this.f; }
  m9(x) { return x * 10 + 44 + this.f; }
  m10(x) { return x * 11 + 44 + this.f; }
  m11(x) { return x * 12 + 44 + this.f; }
  m12(x) { return x * 13 + 44 + this.f; }
  m13(x) { return x * 14 + 44 + this.f; }
  m14(x) { return x * 15 + 44 + this.f; }
  m15(x) { return x * 16 + 44 + this.f; }
  m16(x) { return x * 17 + 44 + this.f; }
  m17(x) { return x * 18 + 44 + this.f; }
}
class C45 {
  constructor() {
    this.f = 45;
    this.tag = "c45";
  }
  put(k, v) {
    this[k] = v;
  }
  z0() { return 0; }
  z1() { return 1; }
  z2() { return 2; }
  m0(x) { return x * 1 + 45 + this.f; }
  m1(x) { return x * 2 + 45 + this.f; }
  m2(x) { return x * 3 + 45 + this.f; }
  m3(x) { return x * 4 + 45 + this.f; }
  m4(x) { return x * 5 + 45 + this.f; }
  m5(x) { return x * 6 + 45 + this.f; }
  m6(x) { return x * 7 + 45 + this.f; }
  m7(x) { return x * 8 + 45 + this.f; }
  m8(x) { return x * 9 + 45 + this.f; }
  m9(x) { return x * 10 + 45 + this.f; }
  m10(x) { return x * 11 + 45 + this.f; }
  m11(x) { return x * 12 + 45 + this.f; }
  m12(x) { return x * 13 + 45 + this.f; }
  m13(x) { return x * 14 + 45 + this.f; }
  m14(x) { return x * 15 + 45 + this.f; }
  m15(x) { return x * 16 + 45 + this.f; }
  m16(x) { return x * 17 + 45 + this.f; }
  m17(x) { return x * 18 + 45 + this.f; }
}
class C46 extends EventEmitter {
  constructor() {
    super();
    this.f = 46;
    this.tag = "c46";
  }
  put(k, v) {
    this[k] = v;
  }
  z0() { return 0; }
  z1() { return 1; }
  z2() { return 2; }
  z3() { return 3; }
  m0(x) { return x * 1 + 46 + this.f; }
  m1(x) { return x * 2 + 46 + this.f; }
  m2(x) { return x * 3 + 46 + this.f; }
  m3(x) { return x * 4 + 46 + this.f; }
  m4(x) { return x * 5 + 46 + this.f; }
  m5(x) { return x * 6 + 46 + this.f; }
  m6(x) { return x * 7 + 46 + this.f; }
  m7(x) { return x * 8 + 46 + this.f; }
  m8(x) { return x * 9 + 46 + this.f; }
  m9(x) { return x * 10 + 46 + this.f; }
  m10(x) { return x * 11 + 46 + this.f; }
  m11(x) { return x * 12 + 46 + this.f; }
  m12(x) { return x * 13 + 46 + this.f; }
  m13(x) { return x * 14 + 46 + this.f; }
  m14(x) { return x * 15 + 46 + this.f; }
  m15(x) { return x * 16 + 46 + this.f; }
  m16(x) { return x * 17 + 46 + this.f; }
  m17(x) { return x * 18 + 46 + this.f; }
}
class C47 {
  constructor() {
    this.f = 47;
    this.tag = "c47";
  }
  put(k, v) {
    this[k] = v;
  }
  z0() { return 0; }
  z1() { return 1; }
  z2() { return 2; }
  z3() { return 3; }
  z4() { return 4; }
  m0(x) { return x * 1 + 47 + this.f; }
  m1(x) { return x * 2 + 47 + this.f; }
  m2(x) { return x * 3 + 47 + this.f; }
  m3(x) { return x * 4 + 47 + this.f; }
  m4(x) { return x * 5 + 47 + this.f; }
  m5(x) { return x * 6 + 47 + this.f; }
  m6(x) { return x * 7 + 47 + this.f; }
  m7(x) { return x * 8 + 47 + this.f; }
  m8(x) { return x * 9 + 47 + this.f; }
  m9(x) { return x * 10 + 47 + this.f; }
  m10(x) { return x * 11 + 47 + this.f; }
  m11(x) { return x * 12 + 47 + this.f; }
  m12(x) { return x * 13 + 47 + this.f; }
  m13(x) { return x * 14 + 47 + this.f; }
  m14(x) { return x * 15 + 47 + this.f; }
  m15(x) { return x * 16 + 47 + this.f; }
  m16(x) { return x * 17 + 47 + this.f; }
  m17(x) { return x * 18 + 47 + this.f; }
}
class C48 extends EventEmitter {
  constructor() {
    super();
    this.f = 48;
    this.tag = "c48";
  }
  put(k, v) {
    this[k] = v;
  }
  z0() { return 0; }
  z1() { return 1; }
  z2() { return 2; }
  z3() { return 3; }
  z4() { return 4; }
  z5() { return 5; }
  m0(x) { return x * 1 + 48 + this.f; }
  m1(x) { return x * 2 + 48 + this.f; }
  m2(x) { return x * 3 + 48 + this.f; }
  m3(x) { return x * 4 + 48 + this.f; }
  m4(x) { return x * 5 + 48 + this.f; }
  m5(x) { return x * 6 + 48 + this.f; }
  m6(x) { return x * 7 + 48 + this.f; }
  m7(x) { return x * 8 + 48 + this.f; }
  m8(x) { return x * 9 + 48 + this.f; }
  m9(x) { return x * 10 + 48 + this.f; }
  m10(x) { return x * 11 + 48 + this.f; }
  m11(x) { return x * 12 + 48 + this.f; }
  m12(x) { return x * 13 + 48 + this.f; }
  m13(x) { return x * 14 + 48 + this.f; }
  m14(x) { return x * 15 + 48 + this.f; }
  m15(x) { return x * 16 + 48 + this.f; }
  m16(x) { return x * 17 + 48 + this.f; }
  m17(x) { return x * 18 + 48 + this.f; }
}
class C49 {
  constructor() {
    this.f = 49;
    this.tag = "c49";
  }
  put(k, v) {
    this[k] = v;
  }
  m0(x) { return x * 1 + 49 + this.f; }
  m1(x) { return x * 2 + 49 + this.f; }
  m2(x) { return x * 3 + 49 + this.f; }
  m3(x) { return x * 4 + 49 + this.f; }
  m4(x) { return x * 5 + 49 + this.f; }
  m5(x) { return x * 6 + 49 + this.f; }
  m6(x) { return x * 7 + 49 + this.f; }
  m7(x) { return x * 8 + 49 + this.f; }
  m8(x) { return x * 9 + 49 + this.f; }
  m9(x) { return x * 10 + 49 + this.f; }
  m10(x) { return x * 11 + 49 + this.f; }
  m11(x) { return x * 12 + 49 + this.f; }
  m12(x) { return x * 13 + 49 + this.f; }
  m13(x) { return x * 14 + 49 + this.f; }
  m14(x) { return x * 15 + 49 + this.f; }
  m15(x) { return x * 16 + 49 + this.f; }
  m16(x) { return x * 17 + 49 + this.f; }
  m17(x) { return x * 18 + 49 + this.f; }
}
class C50 extends EventEmitter {
  constructor() {
    super();
    this.f = 50;
    this.tag = "c50";
  }
  put(k, v) {
    this[k] = v;
  }
  z0() { return 0; }
  m0(x) { return x * 1 + 50 + this.f; }
  m1(x) { return x * 2 + 50 + this.f; }
  m2(x) { return x * 3 + 50 + this.f; }
  m3(x) { return x * 4 + 50 + this.f; }
  m4(x) { return x * 5 + 50 + this.f; }
  m5(x) { return x * 6 + 50 + this.f; }
  m6(x) { return x * 7 + 50 + this.f; }
  m7(x) { return x * 8 + 50 + this.f; }
  m8(x) { return x * 9 + 50 + this.f; }
  m9(x) { return x * 10 + 50 + this.f; }
  m10(x) { return x * 11 + 50 + this.f; }
  m11(x) { return x * 12 + 50 + this.f; }
  m12(x) { return x * 13 + 50 + this.f; }
  m13(x) { return x * 14 + 50 + this.f; }
  m14(x) { return x * 15 + 50 + this.f; }
  m15(x) { return x * 16 + 50 + this.f; }
  m16(x) { return x * 17 + 50 + this.f; }
  m17(x) { return x * 18 + 50 + this.f; }
}
class C51 {
  constructor() {
    this.f = 51;
    this.tag = "c51";
  }
  put(k, v) {
    this[k] = v;
  }
  z0() { return 0; }
  z1() { return 1; }
  m0(x) { return x * 1 + 51 + this.f; }
  m1(x) { return x * 2 + 51 + this.f; }
  m2(x) { return x * 3 + 51 + this.f; }
  m3(x) { return x * 4 + 51 + this.f; }
  m4(x) { return x * 5 + 51 + this.f; }
  m5(x) { return x * 6 + 51 + this.f; }
  m6(x) { return x * 7 + 51 + this.f; }
  m7(x) { return x * 8 + 51 + this.f; }
  m8(x) { return x * 9 + 51 + this.f; }
  m9(x) { return x * 10 + 51 + this.f; }
  m10(x) { return x * 11 + 51 + this.f; }
  m11(x) { return x * 12 + 51 + this.f; }
  m12(x) { return x * 13 + 51 + this.f; }
  m13(x) { return x * 14 + 51 + this.f; }
  m14(x) { return x * 15 + 51 + this.f; }
  m15(x) { return x * 16 + 51 + this.f; }
  m16(x) { return x * 17 + 51 + this.f; }
  m17(x) { return x * 18 + 51 + this.f; }
}
class C52 extends EventEmitter {
  constructor() {
    super();
    this.f = 52;
    this.tag = "c52";
  }
  put(k, v) {
    this[k] = v;
  }
  z0() { return 0; }
  z1() { return 1; }
  z2() { return 2; }
  m0(x) { return x * 1 + 52 + this.f; }
  m1(x) { return x * 2 + 52 + this.f; }
  m2(x) { return x * 3 + 52 + this.f; }
  m3(x) { return x * 4 + 52 + this.f; }
  m4(x) { return x * 5 + 52 + this.f; }
  m5(x) { return x * 6 + 52 + this.f; }
  m6(x) { return x * 7 + 52 + this.f; }
  m7(x) { return x * 8 + 52 + this.f; }
  m8(x) { return x * 9 + 52 + this.f; }
  m9(x) { return x * 10 + 52 + this.f; }
  m10(x) { return x * 11 + 52 + this.f; }
  m11(x) { return x * 12 + 52 + this.f; }
  m12(x) { return x * 13 + 52 + this.f; }
  m13(x) { return x * 14 + 52 + this.f; }
  m14(x) { return x * 15 + 52 + this.f; }
  m15(x) { return x * 16 + 52 + this.f; }
  m16(x) { return x * 17 + 52 + this.f; }
  m17(x) { return x * 18 + 52 + this.f; }
}
class C53 {
  constructor() {
    this.f = 53;
    this.tag = "c53";
  }
  put(k, v) {
    this[k] = v;
  }
  z0() { return 0; }
  z1() { return 1; }
  z2() { return 2; }
  z3() { return 3; }
  m0(x) { return x * 1 + 53 + this.f; }
  m1(x) { return x * 2 + 53 + this.f; }
  m2(x) { return x * 3 + 53 + this.f; }
  m3(x) { return x * 4 + 53 + this.f; }
  m4(x) { return x * 5 + 53 + this.f; }
  m5(x) { return x * 6 + 53 + this.f; }
  m6(x) { return x * 7 + 53 + this.f; }
  m7(x) { return x * 8 + 53 + this.f; }
  m8(x) { return x * 9 + 53 + this.f; }
  m9(x) { return x * 10 + 53 + this.f; }
  m10(x) { return x * 11 + 53 + this.f; }
  m11(x) { return x * 12 + 53 + this.f; }
  m12(x) { return x * 13 + 53 + this.f; }
  m13(x) { return x * 14 + 53 + this.f; }
  m14(x) { return x * 15 + 53 + this.f; }
  m15(x) { return x * 16 + 53 + this.f; }
  m16(x) { return x * 17 + 53 + this.f; }
  m17(x) { return x * 18 + 53 + this.f; }
}
class C54 extends EventEmitter {
  constructor() {
    super();
    this.f = 54;
    this.tag = "c54";
  }
  put(k, v) {
    this[k] = v;
  }
  z0() { return 0; }
  z1() { return 1; }
  z2() { return 2; }
  z3() { return 3; }
  z4() { return 4; }
  m0(x) { return x * 1 + 54 + this.f; }
  m1(x) { return x * 2 + 54 + this.f; }
  m2(x) { return x * 3 + 54 + this.f; }
  m3(x) { return x * 4 + 54 + this.f; }
  m4(x) { return x * 5 + 54 + this.f; }
  m5(x) { return x * 6 + 54 + this.f; }
  m6(x) { return x * 7 + 54 + this.f; }
  m7(x) { return x * 8 + 54 + this.f; }
  m8(x) { return x * 9 + 54 + this.f; }
  m9(x) { return x * 10 + 54 + this.f; }
  m10(x) { return x * 11 + 54 + this.f; }
  m11(x) { return x * 12 + 54 + this.f; }
  m12(x) { return x * 13 + 54 + this.f; }
  m13(x) { return x * 14 + 54 + this.f; }
  m14(x) { return x * 15 + 54 + this.f; }
  m15(x) { return x * 16 + 54 + this.f; }
  m16(x) { return x * 17 + 54 + this.f; }
  m17(x) { return x * 18 + 54 + this.f; }
}
class C55 {
  constructor() {
    this.f = 55;
    this.tag = "c55";
  }
  put(k, v) {
    this[k] = v;
  }
  z0() { return 0; }
  z1() { return 1; }
  z2() { return 2; }
  z3() { return 3; }
  z4() { return 4; }
  z5() { return 5; }
  m0(x) { return x * 1 + 55 + this.f; }
  m1(x) { return x * 2 + 55 + this.f; }
  m2(x) { return x * 3 + 55 + this.f; }
  m3(x) { return x * 4 + 55 + this.f; }
  m4(x) { return x * 5 + 55 + this.f; }
  m5(x) { return x * 6 + 55 + this.f; }
  m6(x) { return x * 7 + 55 + this.f; }
  m7(x) { return x * 8 + 55 + this.f; }
  m8(x) { return x * 9 + 55 + this.f; }
  m9(x) { return x * 10 + 55 + this.f; }
  m10(x) { return x * 11 + 55 + this.f; }
  m11(x) { return x * 12 + 55 + this.f; }
  m12(x) { return x * 13 + 55 + this.f; }
  m13(x) { return x * 14 + 55 + this.f; }
  m14(x) { return x * 15 + 55 + this.f; }
  m15(x) { return x * 16 + 55 + this.f; }
  m16(x) { return x * 17 + 55 + this.f; }
  m17(x) { return x * 18 + 55 + this.f; }
}
class C56 extends EventEmitter {
  constructor() {
    super();
    this.f = 56;
    this.tag = "c56";
  }
  put(k, v) {
    this[k] = v;
  }
  m0(x) { return x * 1 + 56 + this.f; }
  m1(x) { return x * 2 + 56 + this.f; }
  m2(x) { return x * 3 + 56 + this.f; }
  m3(x) { return x * 4 + 56 + this.f; }
  m4(x) { return x * 5 + 56 + this.f; }
  m5(x) { return x * 6 + 56 + this.f; }
  m6(x) { return x * 7 + 56 + this.f; }
  m7(x) { return x * 8 + 56 + this.f; }
  m8(x) { return x * 9 + 56 + this.f; }
  m9(x) { return x * 10 + 56 + this.f; }
  m10(x) { return x * 11 + 56 + this.f; }
  m11(x) { return x * 12 + 56 + this.f; }
  m12(x) { return x * 13 + 56 + this.f; }
  m13(x) { return x * 14 + 56 + this.f; }
  m14(x) { return x * 15 + 56 + this.f; }
  m15(x) { return x * 16 + 56 + this.f; }
  m16(x) { return x * 17 + 56 + this.f; }
  m17(x) { return x * 18 + 56 + this.f; }
}
class C57 {
  constructor() {
    this.f = 57;
    this.tag = "c57";
  }
  put(k, v) {
    this[k] = v;
  }
  z0() { return 0; }
  m0(x) { return x * 1 + 57 + this.f; }
  m1(x) { return x * 2 + 57 + this.f; }
  m2(x) { return x * 3 + 57 + this.f; }
  m3(x) { return x * 4 + 57 + this.f; }
  m4(x) { return x * 5 + 57 + this.f; }
  m5(x) { return x * 6 + 57 + this.f; }
  m6(x) { return x * 7 + 57 + this.f; }
  m7(x) { return x * 8 + 57 + this.f; }
  m8(x) { return x * 9 + 57 + this.f; }
  m9(x) { return x * 10 + 57 + this.f; }
  m10(x) { return x * 11 + 57 + this.f; }
  m11(x) { return x * 12 + 57 + this.f; }
  m12(x) { return x * 13 + 57 + this.f; }
  m13(x) { return x * 14 + 57 + this.f; }
  m14(x) { return x * 15 + 57 + this.f; }
  m15(x) { return x * 16 + 57 + this.f; }
  m16(x) { return x * 17 + 57 + this.f; }
  m17(x) { return x * 18 + 57 + this.f; }
}
class C58 extends EventEmitter {
  constructor() {
    super();
    this.f = 58;
    this.tag = "c58";
  }
  put(k, v) {
    this[k] = v;
  }
  z0() { return 0; }
  z1() { return 1; }
  m0(x) { return x * 1 + 58 + this.f; }
  m1(x) { return x * 2 + 58 + this.f; }
  m2(x) { return x * 3 + 58 + this.f; }
  m3(x) { return x * 4 + 58 + this.f; }
  m4(x) { return x * 5 + 58 + this.f; }
  m5(x) { return x * 6 + 58 + this.f; }
  m6(x) { return x * 7 + 58 + this.f; }
  m7(x) { return x * 8 + 58 + this.f; }
  m8(x) { return x * 9 + 58 + this.f; }
  m9(x) { return x * 10 + 58 + this.f; }
  m10(x) { return x * 11 + 58 + this.f; }
  m11(x) { return x * 12 + 58 + this.f; }
  m12(x) { return x * 13 + 58 + this.f; }
  m13(x) { return x * 14 + 58 + this.f; }
  m14(x) { return x * 15 + 58 + this.f; }
  m15(x) { return x * 16 + 58 + this.f; }
  m16(x) { return x * 17 + 58 + this.f; }
  m17(x) { return x * 18 + 58 + this.f; }
}
class C59 {
  constructor() {
    this.f = 59;
    this.tag = "c59";
  }
  put(k, v) {
    this[k] = v;
  }
  z0() { return 0; }
  z1() { return 1; }
  z2() { return 2; }
  m0(x) { return x * 1 + 59 + this.f; }
  m1(x) { return x * 2 + 59 + this.f; }
  m2(x) { return x * 3 + 59 + this.f; }
  m3(x) { return x * 4 + 59 + this.f; }
  m4(x) { return x * 5 + 59 + this.f; }
  m5(x) { return x * 6 + 59 + this.f; }
  m6(x) { return x * 7 + 59 + this.f; }
  m7(x) { return x * 8 + 59 + this.f; }
  m8(x) { return x * 9 + 59 + this.f; }
  m9(x) { return x * 10 + 59 + this.f; }
  m10(x) { return x * 11 + 59 + this.f; }
  m11(x) { return x * 12 + 59 + this.f; }
  m12(x) { return x * 13 + 59 + this.f; }
  m13(x) { return x * 14 + 59 + this.f; }
  m14(x) { return x * 15 + 59 + this.f; }
  m15(x) { return x * 16 + 59 + this.f; }
  m16(x) { return x * 17 + 59 + this.f; }
  m17(x) { return x * 18 + 59 + this.f; }
}
class C60 extends EventEmitter {
  constructor() {
    super();
    this.f = 60;
    this.tag = "c60";
  }
  put(k, v) {
    this[k] = v;
  }
  z0() { return 0; }
  z1() { return 1; }
  z2() { return 2; }
  z3() { return 3; }
  m0(x) { return x * 1 + 60 + this.f; }
  m1(x) { return x * 2 + 60 + this.f; }
  m2(x) { return x * 3 + 60 + this.f; }
  m3(x) { return x * 4 + 60 + this.f; }
  m4(x) { return x * 5 + 60 + this.f; }
  m5(x) { return x * 6 + 60 + this.f; }
  m6(x) { return x * 7 + 60 + this.f; }
  m7(x) { return x * 8 + 60 + this.f; }
  m8(x) { return x * 9 + 60 + this.f; }
  m9(x) { return x * 10 + 60 + this.f; }
  m10(x) { return x * 11 + 60 + this.f; }
  m11(x) { return x * 12 + 60 + this.f; }
  m12(x) { return x * 13 + 60 + this.f; }
  m13(x) { return x * 14 + 60 + this.f; }
  m14(x) { return x * 15 + 60 + this.f; }
  m15(x) { return x * 16 + 60 + this.f; }
  m16(x) { return x * 17 + 60 + this.f; }
  m17(x) { return x * 18 + 60 + this.f; }
}
class C61 {
  constructor() {
    this.f = 61;
    this.tag = "c61";
  }
  put(k, v) {
    this[k] = v;
  }
  z0() { return 0; }
  z1() { return 1; }
  z2() { return 2; }
  z3() { return 3; }
  z4() { return 4; }
  m0(x) { return x * 1 + 61 + this.f; }
  m1(x) { return x * 2 + 61 + this.f; }
  m2(x) { return x * 3 + 61 + this.f; }
  m3(x) { return x * 4 + 61 + this.f; }
  m4(x) { return x * 5 + 61 + this.f; }
  m5(x) { return x * 6 + 61 + this.f; }
  m6(x) { return x * 7 + 61 + this.f; }
  m7(x) { return x * 8 + 61 + this.f; }
  m8(x) { return x * 9 + 61 + this.f; }
  m9(x) { return x * 10 + 61 + this.f; }
  m10(x) { return x * 11 + 61 + this.f; }
  m11(x) { return x * 12 + 61 + this.f; }
  m12(x) { return x * 13 + 61 + this.f; }
  m13(x) { return x * 14 + 61 + this.f; }
  m14(x) { return x * 15 + 61 + this.f; }
  m15(x) { return x * 16 + 61 + this.f; }
  m16(x) { return x * 17 + 61 + this.f; }
  m17(x) { return x * 18 + 61 + this.f; }
}
class C62 extends EventEmitter {
  constructor() {
    super();
    this.f = 62;
    this.tag = "c62";
  }
  put(k, v) {
    this[k] = v;
  }
  z0() { return 0; }
  z1() { return 1; }
  z2() { return 2; }
  z3() { return 3; }
  z4() { return 4; }
  z5() { return 5; }
  m0(x) { return x * 1 + 62 + this.f; }
  m1(x) { return x * 2 + 62 + this.f; }
  m2(x) { return x * 3 + 62 + this.f; }
  m3(x) { return x * 4 + 62 + this.f; }
  m4(x) { return x * 5 + 62 + this.f; }
  m5(x) { return x * 6 + 62 + this.f; }
  m6(x) { return x * 7 + 62 + this.f; }
  m7(x) { return x * 8 + 62 + this.f; }
  m8(x) { return x * 9 + 62 + this.f; }
  m9(x) { return x * 10 + 62 + this.f; }
  m10(x) { return x * 11 + 62 + this.f; }
  m11(x) { return x * 12 + 62 + this.f; }
  m12(x) { return x * 13 + 62 + this.f; }
  m13(x) { return x * 14 + 62 + this.f; }
  m14(x) { return x * 15 + 62 + this.f; }
  m15(x) { return x * 16 + 62 + this.f; }
  m16(x) { return x * 17 + 62 + this.f; }
  m17(x) { return x * 18 + 62 + this.f; }
}
class C63 {
  constructor() {
    this.f = 63;
    this.tag = "c63";
  }
  put(k, v) {
    this[k] = v;
  }
  m0(x) { return x * 1 + 63 + this.f; }
  m1(x) { return x * 2 + 63 + this.f; }
  m2(x) { return x * 3 + 63 + this.f; }
  m3(x) { return x * 4 + 63 + this.f; }
  m4(x) { return x * 5 + 63 + this.f; }
  m5(x) { return x * 6 + 63 + this.f; }
  m6(x) { return x * 7 + 63 + this.f; }
  m7(x) { return x * 8 + 63 + this.f; }
  m8(x) { return x * 9 + 63 + this.f; }
  m9(x) { return x * 10 + 63 + this.f; }
  m10(x) { return x * 11 + 63 + this.f; }
  m11(x) { return x * 12 + 63 + this.f; }
  m12(x) { return x * 13 + 63 + this.f; }
  m13(x) { return x * 14 + 63 + this.f; }
  m14(x) { return x * 15 + 63 + this.f; }
  m15(x) { return x * 16 + 63 + this.f; }
  m16(x) { return x * 17 + 63 + this.f; }
  m17(x) { return x * 18 + 63 + this.f; }
}
class C64 extends EventEmitter {
  constructor() {
    super();
    this.f = 64;
    this.tag = "c64";
  }
  put(k, v) {
    this[k] = v;
  }
  z0() { return 0; }
  m0(x) { return x * 1 + 64 + this.f; }
  m1(x) { return x * 2 + 64 + this.f; }
  m2(x) { return x * 3 + 64 + this.f; }
  m3(x) { return x * 4 + 64 + this.f; }
  m4(x) { return x * 5 + 64 + this.f; }
  m5(x) { return x * 6 + 64 + this.f; }
  m6(x) { return x * 7 + 64 + this.f; }
  m7(x) { return x * 8 + 64 + this.f; }
  m8(x) { return x * 9 + 64 + this.f; }
  m9(x) { return x * 10 + 64 + this.f; }
  m10(x) { return x * 11 + 64 + this.f; }
  m11(x) { return x * 12 + 64 + this.f; }
  m12(x) { return x * 13 + 64 + this.f; }
  m13(x) { return x * 14 + 64 + this.f; }
  m14(x) { return x * 15 + 64 + this.f; }
  m15(x) { return x * 16 + 64 + this.f; }
  m16(x) { return x * 17 + 64 + this.f; }
  m17(x) { return x * 18 + 64 + this.f; }
}
class C65 {
  constructor() {
    this.f = 65;
    this.tag = "c65";
  }
  put(k, v) {
    this[k] = v;
  }
  z0() { return 0; }
  z1() { return 1; }
  m0(x) { return x * 1 + 65 + this.f; }
  m1(x) { return x * 2 + 65 + this.f; }
  m2(x) { return x * 3 + 65 + this.f; }
  m3(x) { return x * 4 + 65 + this.f; }
  m4(x) { return x * 5 + 65 + this.f; }
  m5(x) { return x * 6 + 65 + this.f; }
  m6(x) { return x * 7 + 65 + this.f; }
  m7(x) { return x * 8 + 65 + this.f; }
  m8(x) { return x * 9 + 65 + this.f; }
  m9(x) { return x * 10 + 65 + this.f; }
  m10(x) { return x * 11 + 65 + this.f; }
  m11(x) { return x * 12 + 65 + this.f; }
  m12(x) { return x * 13 + 65 + this.f; }
  m13(x) { return x * 14 + 65 + this.f; }
  m14(x) { return x * 15 + 65 + this.f; }
  m15(x) { return x * 16 + 65 + this.f; }
  m16(x) { return x * 17 + 65 + this.f; }
  m17(x) { return x * 18 + 65 + this.f; }
}
class C66 extends EventEmitter {
  constructor() {
    super();
    this.f = 66;
    this.tag = "c66";
  }
  put(k, v) {
    this[k] = v;
  }
  z0() { return 0; }
  z1() { return 1; }
  z2() { return 2; }
  m0(x) { return x * 1 + 66 + this.f; }
  m1(x) { return x * 2 + 66 + this.f; }
  m2(x) { return x * 3 + 66 + this.f; }
  m3(x) { return x * 4 + 66 + this.f; }
  m4(x) { return x * 5 + 66 + this.f; }
  m5(x) { return x * 6 + 66 + this.f; }
  m6(x) { return x * 7 + 66 + this.f; }
  m7(x) { return x * 8 + 66 + this.f; }
  m8(x) { return x * 9 + 66 + this.f; }
  m9(x) { return x * 10 + 66 + this.f; }
  m10(x) { return x * 11 + 66 + this.f; }
  m11(x) { return x * 12 + 66 + this.f; }
  m12(x) { return x * 13 + 66 + this.f; }
  m13(x) { return x * 14 + 66 + this.f; }
  m14(x) { return x * 15 + 66 + this.f; }
  m15(x) { return x * 16 + 66 + this.f; }
  m16(x) { return x * 17 + 66 + this.f; }
  m17(x) { return x * 18 + 66 + this.f; }
}
class C67 {
  constructor() {
    this.f = 67;
    this.tag = "c67";
  }
  put(k, v) {
    this[k] = v;
  }
  z0() { return 0; }
  z1() { return 1; }
  z2() { return 2; }
  z3() { return 3; }
  m0(x) { return x * 1 + 67 + this.f; }
  m1(x) { return x * 2 + 67 + this.f; }
  m2(x) { return x * 3 + 67 + this.f; }
  m3(x) { return x * 4 + 67 + this.f; }
  m4(x) { return x * 5 + 67 + this.f; }
  m5(x) { return x * 6 + 67 + this.f; }
  m6(x) { return x * 7 + 67 + this.f; }
  m7(x) { return x * 8 + 67 + this.f; }
  m8(x) { return x * 9 + 67 + this.f; }
  m9(x) { return x * 10 + 67 + this.f; }
  m10(x) { return x * 11 + 67 + this.f; }
  m11(x) { return x * 12 + 67 + this.f; }
  m12(x) { return x * 13 + 67 + this.f; }
  m13(x) { return x * 14 + 67 + this.f; }
  m14(x) { return x * 15 + 67 + this.f; }
  m15(x) { return x * 16 + 67 + this.f; }
  m16(x) { return x * 17 + 67 + this.f; }
  m17(x) { return x * 18 + 67 + this.f; }
}
class C68 extends EventEmitter {
  constructor() {
    super();
    this.f = 68;
    this.tag = "c68";
  }
  put(k, v) {
    this[k] = v;
  }
  z0() { return 0; }
  z1() { return 1; }
  z2() { return 2; }
  z3() { return 3; }
  z4() { return 4; }
  m0(x) { return x * 1 + 68 + this.f; }
  m1(x) { return x * 2 + 68 + this.f; }
  m2(x) { return x * 3 + 68 + this.f; }
  m3(x) { return x * 4 + 68 + this.f; }
  m4(x) { return x * 5 + 68 + this.f; }
  m5(x) { return x * 6 + 68 + this.f; }
  m6(x) { return x * 7 + 68 + this.f; }
  m7(x) { return x * 8 + 68 + this.f; }
  m8(x) { return x * 9 + 68 + this.f; }
  m9(x) { return x * 10 + 68 + this.f; }
  m10(x) { return x * 11 + 68 + this.f; }
  m11(x) { return x * 12 + 68 + this.f; }
  m12(x) { return x * 13 + 68 + this.f; }
  m13(x) { return x * 14 + 68 + this.f; }
  m14(x) { return x * 15 + 68 + this.f; }
  m15(x) { return x * 16 + 68 + this.f; }
  m16(x) { return x * 17 + 68 + this.f; }
  m17(x) { return x * 18 + 68 + this.f; }
}
class C69 {
  constructor() {
    this.f = 69;
    this.tag = "c69";
  }
  put(k, v) {
    this[k] = v;
  }
  z0() { return 0; }
  z1() { return 1; }
  z2() { return 2; }
  z3() { return 3; }
  z4() { return 4; }
  z5() { return 5; }
  m0(x) { return x * 1 + 69 + this.f; }
  m1(x) { return x * 2 + 69 + this.f; }
  m2(x) { return x * 3 + 69 + this.f; }
  m3(x) { return x * 4 + 69 + this.f; }
  m4(x) { return x * 5 + 69 + this.f; }
  m5(x) { return x * 6 + 69 + this.f; }
  m6(x) { return x * 7 + 69 + this.f; }
  m7(x) { return x * 8 + 69 + this.f; }
  m8(x) { return x * 9 + 69 + this.f; }
  m9(x) { return x * 10 + 69 + this.f; }
  m10(x) { return x * 11 + 69 + this.f; }
  m11(x) { return x * 12 + 69 + this.f; }
  m12(x) { return x * 13 + 69 + this.f; }
  m13(x) { return x * 14 + 69 + this.f; }
  m14(x) { return x * 15 + 69 + this.f; }
  m15(x) { return x * 16 + 69 + this.f; }
  m16(x) { return x * 17 + 69 + this.f; }
  m17(x) { return x * 18 + 69 + this.f; }
}
class C70 extends EventEmitter {
  constructor() {
    super();
    this.f = 70;
    this.tag = "c70";
  }
  put(k, v) {
    this[k] = v;
  }
  m0(x) { return x * 1 + 70 + this.f; }
  m1(x) { return x * 2 + 70 + this.f; }
  m2(x) { return x * 3 + 70 + this.f; }
  m3(x) { return x * 4 + 70 + this.f; }
  m4(x) { return x * 5 + 70 + this.f; }
  m5(x) { return x * 6 + 70 + this.f; }
  m6(x) { return x * 7 + 70 + this.f; }
  m7(x) { return x * 8 + 70 + this.f; }
  m8(x) { return x * 9 + 70 + this.f; }
  m9(x) { return x * 10 + 70 + this.f; }
  m10(x) { return x * 11 + 70 + this.f; }
  m11(x) { return x * 12 + 70 + this.f; }
  m12(x) { return x * 13 + 70 + this.f; }
  m13(x) { return x * 14 + 70 + this.f; }
  m14(x) { return x * 15 + 70 + this.f; }
  m15(x) { return x * 16 + 70 + this.f; }
  m16(x) { return x * 17 + 70 + this.f; }
  m17(x) { return x * 18 + 70 + this.f; }
}
class C71 {
  constructor() {
    this.f = 71;
    this.tag = "c71";
  }
  put(k, v) {
    this[k] = v;
  }
  z0() { return 0; }
  m0(x) { return x * 1 + 71 + this.f; }
  m1(x) { return x * 2 + 71 + this.f; }
  m2(x) { return x * 3 + 71 + this.f; }
  m3(x) { return x * 4 + 71 + this.f; }
  m4(x) { return x * 5 + 71 + this.f; }
  m5(x) { return x * 6 + 71 + this.f; }
  m6(x) { return x * 7 + 71 + this.f; }
  m7(x) { return x * 8 + 71 + this.f; }
  m8(x) { return x * 9 + 71 + this.f; }
  m9(x) { return x * 10 + 71 + this.f; }
  m10(x) { return x * 11 + 71 + this.f; }
  m11(x) { return x * 12 + 71 + this.f; }
  m12(x) { return x * 13 + 71 + this.f; }
  m13(x) { return x * 14 + 71 + this.f; }
  m14(x) { return x * 15 + 71 + this.f; }
  m15(x) { return x * 16 + 71 + this.f; }
  m16(x) { return x * 17 + 71 + this.f; }
  m17(x) { return x * 18 + 71 + this.f; }
}
class C72 extends EventEmitter {
  constructor() {
    super();
    this.f = 72;
    this.tag = "c72";
  }
  put(k, v) {
    this[k] = v;
  }
  z0() { return 0; }
  z1() { return 1; }
  m0(x) { return x * 1 + 72 + this.f; }
  m1(x) { return x * 2 + 72 + this.f; }
  m2(x) { return x * 3 + 72 + this.f; }
  m3(x) { return x * 4 + 72 + this.f; }
  m4(x) { return x * 5 + 72 + this.f; }
  m5(x) { return x * 6 + 72 + this.f; }
  m6(x) { return x * 7 + 72 + this.f; }
  m7(x) { return x * 8 + 72 + this.f; }
  m8(x) { return x * 9 + 72 + this.f; }
  m9(x) { return x * 10 + 72 + this.f; }
  m10(x) { return x * 11 + 72 + this.f; }
  m11(x) { return x * 12 + 72 + this.f; }
  m12(x) { return x * 13 + 72 + this.f; }
  m13(x) { return x * 14 + 72 + this.f; }
  m14(x) { return x * 15 + 72 + this.f; }
  m15(x) { return x * 16 + 72 + this.f; }
  m16(x) { return x * 17 + 72 + this.f; }
  m17(x) { return x * 18 + 72 + this.f; }
}
class C73 {
  constructor() {
    this.f = 73;
    this.tag = "c73";
  }
  put(k, v) {
    this[k] = v;
  }
  z0() { return 0; }
  z1() { return 1; }
  z2() { return 2; }
  m0(x) { return x * 1 + 73 + this.f; }
  m1(x) { return x * 2 + 73 + this.f; }
  m2(x) { return x * 3 + 73 + this.f; }
  m3(x) { return x * 4 + 73 + this.f; }
  m4(x) { return x * 5 + 73 + this.f; }
  m5(x) { return x * 6 + 73 + this.f; }
  m6(x) { return x * 7 + 73 + this.f; }
  m7(x) { return x * 8 + 73 + this.f; }
  m8(x) { return x * 9 + 73 + this.f; }
  m9(x) { return x * 10 + 73 + this.f; }
  m10(x) { return x * 11 + 73 + this.f; }
  m11(x) { return x * 12 + 73 + this.f; }
  m12(x) { return x * 13 + 73 + this.f; }
  m13(x) { return x * 14 + 73 + this.f; }
  m14(x) { return x * 15 + 73 + this.f; }
  m15(x) { return x * 16 + 73 + this.f; }
  m16(x) { return x * 17 + 73 + this.f; }
  m17(x) { return x * 18 + 73 + this.f; }
}
class C74 extends EventEmitter {
  constructor() {
    super();
    this.f = 74;
    this.tag = "c74";
  }
  put(k, v) {
    this[k] = v;
  }
  z0() { return 0; }
  z1() { return 1; }
  z2() { return 2; }
  z3() { return 3; }
  m0(x) { return x * 1 + 74 + this.f; }
  m1(x) { return x * 2 + 74 + this.f; }
  m2(x) { return x * 3 + 74 + this.f; }
  m3(x) { return x * 4 + 74 + this.f; }
  m4(x) { return x * 5 + 74 + this.f; }
  m5(x) { return x * 6 + 74 + this.f; }
  m6(x) { return x * 7 + 74 + this.f; }
  m7(x) { return x * 8 + 74 + this.f; }
  m8(x) { return x * 9 + 74 + this.f; }
  m9(x) { return x * 10 + 74 + this.f; }
  m10(x) { return x * 11 + 74 + this.f; }
  m11(x) { return x * 12 + 74 + this.f; }
  m12(x) { return x * 13 + 74 + this.f; }
  m13(x) { return x * 14 + 74 + this.f; }
  m14(x) { return x * 15 + 74 + this.f; }
  m15(x) { return x * 16 + 74 + this.f; }
  m16(x) { return x * 17 + 74 + this.f; }
  m17(x) { return x * 18 + 74 + this.f; }
}
class C75 {
  constructor() {
    this.f = 75;
    this.tag = "c75";
  }
  put(k, v) {
    this[k] = v;
  }
  z0() { return 0; }
  z1() { return 1; }
  z2() { return 2; }
  z3() { return 3; }
  z4() { return 4; }
  m0(x) { return x * 1 + 75 + this.f; }
  m1(x) { return x * 2 + 75 + this.f; }
  m2(x) { return x * 3 + 75 + this.f; }
  m3(x) { return x * 4 + 75 + this.f; }
  m4(x) { return x * 5 + 75 + this.f; }
  m5(x) { return x * 6 + 75 + this.f; }
  m6(x) { return x * 7 + 75 + this.f; }
  m7(x) { return x * 8 + 75 + this.f; }
  m8(x) { return x * 9 + 75 + this.f; }
  m9(x) { return x * 10 + 75 + this.f; }
  m10(x) { return x * 11 + 75 + this.f; }
  m11(x) { return x * 12 + 75 + this.f; }
  m12(x) { return x * 13 + 75 + this.f; }
  m13(x) { return x * 14 + 75 + this.f; }
  m14(x) { return x * 15 + 75 + this.f; }
  m15(x) { return x * 16 + 75 + this.f; }
  m16(x) { return x * 17 + 75 + this.f; }
  m17(x) { return x * 18 + 75 + this.f; }
}
class C76 extends EventEmitter {
  constructor() {
    super();
    this.f = 76;
    this.tag = "c76";
  }
  put(k, v) {
    this[k] = v;
  }
  z0() { return 0; }
  z1() { return 1; }
  z2() { return 2; }
  z3() { return 3; }
  z4() { return 4; }
  z5() { return 5; }
  m0(x) { return x * 1 + 76 + this.f; }
  m1(x) { return x * 2 + 76 + this.f; }
  m2(x) { return x * 3 + 76 + this.f; }
  m3(x) { return x * 4 + 76 + this.f; }
  m4(x) { return x * 5 + 76 + this.f; }
  m5(x) { return x * 6 + 76 + this.f; }
  m6(x) { return x * 7 + 76 + this.f; }
  m7(x) { return x * 8 + 76 + this.f; }
  m8(x) { return x * 9 + 76 + this.f; }
  m9(x) { return x * 10 + 76 + this.f; }
  m10(x) { return x * 11 + 76 + this.f; }
  m11(x) { return x * 12 + 76 + this.f; }
  m12(x) { return x * 13 + 76 + this.f; }
  m13(x) { return x * 14 + 76 + this.f; }
  m14(x) { return x * 15 + 76 + this.f; }
  m15(x) { return x * 16 + 76 + this.f; }
  m16(x) { return x * 17 + 76 + this.f; }
  m17(x) { return x * 18 + 76 + this.f; }
}
class C77 {
  constructor() {
    this.f = 77;
    this.tag = "c77";
  }
  put(k, v) {
    this[k] = v;
  }
  m0(x) { return x * 1 + 77 + this.f; }
  m1(x) { return x * 2 + 77 + this.f; }
  m2(x) { return x * 3 + 77 + this.f; }
  m3(x) { return x * 4 + 77 + this.f; }
  m4(x) { return x * 5 + 77 + this.f; }
  m5(x) { return x * 6 + 77 + this.f; }
  m6(x) { return x * 7 + 77 + this.f; }
  m7(x) { return x * 8 + 77 + this.f; }
  m8(x) { return x * 9 + 77 + this.f; }
  m9(x) { return x * 10 + 77 + this.f; }
  m10(x) { return x * 11 + 77 + this.f; }
  m11(x) { return x * 12 + 77 + this.f; }
  m12(x) { return x * 13 + 77 + this.f; }
  m13(x) { return x * 14 + 77 + this.f; }
  m14(x) { return x * 15 + 77 + this.f; }
  m15(x) { return x * 16 + 77 + this.f; }
  m16(x) { return x * 17 + 77 + this.f; }
  m17(x) { return x * 18 + 77 + this.f; }
}
class C78 extends EventEmitter {
  constructor() {
    super();
    this.f = 78;
    this.tag = "c78";
  }
  put(k, v) {
    this[k] = v;
  }
  z0() { return 0; }
  m0(x) { return x * 1 + 78 + this.f; }
  m1(x) { return x * 2 + 78 + this.f; }
  m2(x) { return x * 3 + 78 + this.f; }
  m3(x) { return x * 4 + 78 + this.f; }
  m4(x) { return x * 5 + 78 + this.f; }
  m5(x) { return x * 6 + 78 + this.f; }
  m6(x) { return x * 7 + 78 + this.f; }
  m7(x) { return x * 8 + 78 + this.f; }
  m8(x) { return x * 9 + 78 + this.f; }
  m9(x) { return x * 10 + 78 + this.f; }
  m10(x) { return x * 11 + 78 + this.f; }
  m11(x) { return x * 12 + 78 + this.f; }
  m12(x) { return x * 13 + 78 + this.f; }
  m13(x) { return x * 14 + 78 + this.f; }
  m14(x) { return x * 15 + 78 + this.f; }
  m15(x) { return x * 16 + 78 + this.f; }
  m16(x) { return x * 17 + 78 + this.f; }
  m17(x) { return x * 18 + 78 + this.f; }
}
class C79 {
  constructor() {
    this.f = 79;
    this.tag = "c79";
  }
  put(k, v) {
    this[k] = v;
  }
  z0() { return 0; }
  z1() { return 1; }
  m0(x) { return x * 1 + 79 + this.f; }
  m1(x) { return x * 2 + 79 + this.f; }
  m2(x) { return x * 3 + 79 + this.f; }
  m3(x) { return x * 4 + 79 + this.f; }
  m4(x) { return x * 5 + 79 + this.f; }
  m5(x) { return x * 6 + 79 + this.f; }
  m6(x) { return x * 7 + 79 + this.f; }
  m7(x) { return x * 8 + 79 + this.f; }
  m8(x) { return x * 9 + 79 + this.f; }
  m9(x) { return x * 10 + 79 + this.f; }
  m10(x) { return x * 11 + 79 + this.f; }
  m11(x) { return x * 12 + 79 + this.f; }
  m12(x) { return x * 13 + 79 + this.f; }
  m13(x) { return x * 14 + 79 + this.f; }
  m14(x) { return x * 15 + 79 + this.f; }
  m15(x) { return x * 16 + 79 + this.f; }
  m16(x) { return x * 17 + 79 + this.f; }
  m17(x) { return x * 18 + 79 + this.f; }
}
class C80 extends EventEmitter {
  constructor() {
    super();
    this.f = 80;
    this.tag = "c80";
  }
  put(k, v) {
    this[k] = v;
  }
  z0() { return 0; }
  z1() { return 1; }
  z2() { return 2; }
  m0(x) { return x * 1 + 80 + this.f; }
  m1(x) { return x * 2 + 80 + this.f; }
  m2(x) { return x * 3 + 80 + this.f; }
  m3(x) { return x * 4 + 80 + this.f; }
  m4(x) { return x * 5 + 80 + this.f; }
  m5(x) { return x * 6 + 80 + this.f; }
  m6(x) { return x * 7 + 80 + this.f; }
  m7(x) { return x * 8 + 80 + this.f; }
  m8(x) { return x * 9 + 80 + this.f; }
  m9(x) { return x * 10 + 80 + this.f; }
  m10(x) { return x * 11 + 80 + this.f; }
  m11(x) { return x * 12 + 80 + this.f; }
  m12(x) { return x * 13 + 80 + this.f; }
  m13(x) { return x * 14 + 80 + this.f; }
  m14(x) { return x * 15 + 80 + this.f; }
  m15(x) { return x * 16 + 80 + this.f; }
  m16(x) { return x * 17 + 80 + this.f; }
  m17(x) { return x * 18 + 80 + this.f; }
}
class C81 {
  constructor() {
    this.f = 81;
    this.tag = "c81";
  }
  put(k, v) {
    this[k] = v;
  }
  z0() { return 0; }
  z1() { return 1; }
  z2() { return 2; }
  z3() { return 3; }
  m0(x) { return x * 1 + 81 + this.f; }
  m1(x) { return x * 2 + 81 + this.f; }
  m2(x) { return x * 3 + 81 + this.f; }
  m3(x) { return x * 4 + 81 + this.f; }
  m4(x) { return x * 5 + 81 + this.f; }
  m5(x) { return x * 6 + 81 + this.f; }
  m6(x) { return x * 7 + 81 + this.f; }
  m7(x) { return x * 8 + 81 + this.f; }
  m8(x) { return x * 9 + 81 + this.f; }
  m9(x) { return x * 10 + 81 + this.f; }
  m10(x) { return x * 11 + 81 + this.f; }
  m11(x) { return x * 12 + 81 + this.f; }
  m12(x) { return x * 13 + 81 + this.f; }
  m13(x) { return x * 14 + 81 + this.f; }
  m14(x) { return x * 15 + 81 + this.f; }
  m15(x) { return x * 16 + 81 + this.f; }
  m16(x) { return x * 17 + 81 + this.f; }
  m17(x) { return x * 18 + 81 + this.f; }
}
class C82 extends EventEmitter {
  constructor() {
    super();
    this.f = 82;
    this.tag = "c82";
  }
  put(k, v) {
    this[k] = v;
  }
  z0() { return 0; }
  z1() { return 1; }
  z2() { return 2; }
  z3() { return 3; }
  z4() { return 4; }
  m0(x) { return x * 1 + 82 + this.f; }
  m1(x) { return x * 2 + 82 + this.f; }
  m2(x) { return x * 3 + 82 + this.f; }
  m3(x) { return x * 4 + 82 + this.f; }
  m4(x) { return x * 5 + 82 + this.f; }
  m5(x) { return x * 6 + 82 + this.f; }
  m6(x) { return x * 7 + 82 + this.f; }
  m7(x) { return x * 8 + 82 + this.f; }
  m8(x) { return x * 9 + 82 + this.f; }
  m9(x) { return x * 10 + 82 + this.f; }
  m10(x) { return x * 11 + 82 + this.f; }
  m11(x) { return x * 12 + 82 + this.f; }
  m12(x) { return x * 13 + 82 + this.f; }
  m13(x) { return x * 14 + 82 + this.f; }
  m14(x) { return x * 15 + 82 + this.f; }
  m15(x) { return x * 16 + 82 + this.f; }
  m16(x) { return x * 17 + 82 + this.f; }
  m17(x) { return x * 18 + 82 + this.f; }
}
class C83 {
  constructor() {
    this.f = 83;
    this.tag = "c83";
  }
  put(k, v) {
    this[k] = v;
  }
  z0() { return 0; }
  z1() { return 1; }
  z2() { return 2; }
  z3() { return 3; }
  z4() { return 4; }
  z5() { return 5; }
  m0(x) { return x * 1 + 83 + this.f; }
  m1(x) { return x * 2 + 83 + this.f; }
  m2(x) { return x * 3 + 83 + this.f; }
  m3(x) { return x * 4 + 83 + this.f; }
  m4(x) { return x * 5 + 83 + this.f; }
  m5(x) { return x * 6 + 83 + this.f; }
  m6(x) { return x * 7 + 83 + this.f; }
  m7(x) { return x * 8 + 83 + this.f; }
  m8(x) { return x * 9 + 83 + this.f; }
  m9(x) { return x * 10 + 83 + this.f; }
  m10(x) { return x * 11 + 83 + this.f; }
  m11(x) { return x * 12 + 83 + this.f; }
  m12(x) { return x * 13 + 83 + this.f; }
  m13(x) { return x * 14 + 83 + this.f; }
  m14(x) { return x * 15 + 83 + this.f; }
  m15(x) { return x * 16 + 83 + this.f; }
  m16(x) { return x * 17 + 83 + this.f; }
  m17(x) { return x * 18 + 83 + this.f; }
}
class C84 extends EventEmitter {
  constructor() {
    super();
    this.f = 84;
    this.tag = "c84";
  }
  put(k, v) {
    this[k] = v;
  }
  m0(x) { return x * 1 + 84 + this.f; }
  m1(x) { return x * 2 + 84 + this.f; }
  m2(x) { return x * 3 + 84 + this.f; }
  m3(x) { return x * 4 + 84 + this.f; }
  m4(x) { return x * 5 + 84 + this.f; }
  m5(x) { return x * 6 + 84 + this.f; }
  m6(x) { return x * 7 + 84 + this.f; }
  m7(x) { return x * 8 + 84 + this.f; }
  m8(x) { return x * 9 + 84 + this.f; }
  m9(x) { return x * 10 + 84 + this.f; }
  m10(x) { return x * 11 + 84 + this.f; }
  m11(x) { return x * 12 + 84 + this.f; }
  m12(x) { return x * 13 + 84 + this.f; }
  m13(x) { return x * 14 + 84 + this.f; }
  m14(x) { return x * 15 + 84 + this.f; }
  m15(x) { return x * 16 + 84 + this.f; }
  m16(x) { return x * 17 + 84 + this.f; }
  m17(x) { return x * 18 + 84 + this.f; }
}
class C85 {
  constructor() {
    this.f = 85;
    this.tag = "c85";
  }
  put(k, v) {
    this[k] = v;
  }
  z0() { return 0; }
  m0(x) { return x * 1 + 85 + this.f; }
  m1(x) { return x * 2 + 85 + this.f; }
  m2(x) { return x * 3 + 85 + this.f; }
  m3(x) { return x * 4 + 85 + this.f; }
  m4(x) { return x * 5 + 85 + this.f; }
  m5(x) { return x * 6 + 85 + this.f; }
  m6(x) { return x * 7 + 85 + this.f; }
  m7(x) { return x * 8 + 85 + this.f; }
  m8(x) { return x * 9 + 85 + this.f; }
  m9(x) { return x * 10 + 85 + this.f; }
  m10(x) { return x * 11 + 85 + this.f; }
  m11(x) { return x * 12 + 85 + this.f; }
  m12(x) { return x * 13 + 85 + this.f; }
  m13(x) { return x * 14 + 85 + this.f; }
  m14(x) { return x * 15 + 85 + this.f; }
  m15(x) { return x * 16 + 85 + this.f; }
  m16(x) { return x * 17 + 85 + this.f; }
  m17(x) { return x * 18 + 85 + this.f; }
}
class C86 extends EventEmitter {
  constructor() {
    super();
    this.f = 86;
    this.tag = "c86";
  }
  put(k, v) {
    this[k] = v;
  }
  z0() { return 0; }
  z1() { return 1; }
  m0(x) { return x * 1 + 86 + this.f; }
  m1(x) { return x * 2 + 86 + this.f; }
  m2(x) { return x * 3 + 86 + this.f; }
  m3(x) { return x * 4 + 86 + this.f; }
  m4(x) { return x * 5 + 86 + this.f; }
  m5(x) { return x * 6 + 86 + this.f; }
  m6(x) { return x * 7 + 86 + this.f; }
  m7(x) { return x * 8 + 86 + this.f; }
  m8(x) { return x * 9 + 86 + this.f; }
  m9(x) { return x * 10 + 86 + this.f; }
  m10(x) { return x * 11 + 86 + this.f; }
  m11(x) { return x * 12 + 86 + this.f; }
  m12(x) { return x * 13 + 86 + this.f; }
  m13(x) { return x * 14 + 86 + this.f; }
  m14(x) { return x * 15 + 86 + this.f; }
  m15(x) { return x * 16 + 86 + this.f; }
  m16(x) { return x * 17 + 86 + this.f; }
  m17(x) { return x * 18 + 86 + this.f; }
}
class C87 {
  constructor() {
    this.f = 87;
    this.tag = "c87";
  }
  put(k, v) {
    this[k] = v;
  }
  z0() { return 0; }
  z1() { return 1; }
  z2() { return 2; }
  m0(x) { return x * 1 + 87 + this.f; }
  m1(x) { return x * 2 + 87 + this.f; }
  m2(x) { return x * 3 + 87 + this.f; }
  m3(x) { return x * 4 + 87 + this.f; }
  m4(x) { return x * 5 + 87 + this.f; }
  m5(x) { return x * 6 + 87 + this.f; }
  m6(x) { return x * 7 + 87 + this.f; }
  m7(x) { return x * 8 + 87 + this.f; }
  m8(x) { return x * 9 + 87 + this.f; }
  m9(x) { return x * 10 + 87 + this.f; }
  m10(x) { return x * 11 + 87 + this.f; }
  m11(x) { return x * 12 + 87 + this.f; }
  m12(x) { return x * 13 + 87 + this.f; }
  m13(x) { return x * 14 + 87 + this.f; }
  m14(x) { return x * 15 + 87 + this.f; }
  m15(x) { return x * 16 + 87 + this.f; }
  m16(x) { return x * 17 + 87 + this.f; }
  m17(x) { return x * 18 + 87 + this.f; }
}
class C88 extends EventEmitter {
  constructor() {
    super();
    this.f = 88;
    this.tag = "c88";
  }
  put(k, v) {
    this[k] = v;
  }
  z0() { return 0; }
  z1() { return 1; }
  z2() { return 2; }
  z3() { return 3; }
  m0(x) { return x * 1 + 88 + this.f; }
  m1(x) { return x * 2 + 88 + this.f; }
  m2(x) { return x * 3 + 88 + this.f; }
  m3(x) { return x * 4 + 88 + this.f; }
  m4(x) { return x * 5 + 88 + this.f; }
  m5(x) { return x * 6 + 88 + this.f; }
  m6(x) { return x * 7 + 88 + this.f; }
  m7(x) { return x * 8 + 88 + this.f; }
  m8(x) { return x * 9 + 88 + this.f; }
  m9(x) { return x * 10 + 88 + this.f; }
  m10(x) { return x * 11 + 88 + this.f; }
  m11(x) { return x * 12 + 88 + this.f; }
  m12(x) { return x * 13 + 88 + this.f; }
  m13(x) { return x * 14 + 88 + this.f; }
  m14(x) { return x * 15 + 88 + this.f; }
  m15(x) { return x * 16 + 88 + this.f; }
  m16(x) { return x * 17 + 88 + this.f; }
  m17(x) { return x * 18 + 88 + this.f; }
}
class C89 {
  constructor() {
    this.f = 89;
    this.tag = "c89";
  }
  put(k, v) {
    this[k] = v;
  }
  z0() { return 0; }
  z1() { return 1; }
  z2() { return 2; }
  z3() { return 3; }
  z4() { return 4; }
  m0(x) { return x * 1 + 89 + this.f; }
  m1(x) { return x * 2 + 89 + this.f; }
  m2(x) { return x * 3 + 89 + this.f; }
  m3(x) { return x * 4 + 89 + this.f; }
  m4(x) { return x * 5 + 89 + this.f; }
  m5(x) { return x * 6 + 89 + this.f; }
  m6(x) { return x * 7 + 89 + this.f; }
  m7(x) { return x * 8 + 89 + this.f; }
  m8(x) { return x * 9 + 89 + this.f; }
  m9(x) { return x * 10 + 89 + this.f; }
  m10(x) { return x * 11 + 89 + this.f; }
  m11(x) { return x * 12 + 89 + this.f; }
  m12(x) { return x * 13 + 89 + this.f; }
  m13(x) { return x * 14 + 89 + this.f; }
  m14(x) { return x * 15 + 89 + this.f; }
  m15(x) { return x * 16 + 89 + this.f; }
  m16(x) { return x * 17 + 89 + this.f; }
  m17(x) { return x * 18 + 89 + this.f; }
}
class C90 extends EventEmitter {
  constructor() {
    super();
    this.f = 90;
    this.tag = "c90";
  }
  put(k, v) {
    this[k] = v;
  }
  z0() { return 0; }
  z1() { return 1; }
  z2() { return 2; }
  z3() { return 3; }
  z4() { return 4; }
  z5() { return 5; }
  m0(x) { return x * 1 + 90 + this.f; }
  m1(x) { return x * 2 + 90 + this.f; }
  m2(x) { return x * 3 + 90 + this.f; }
  m3(x) { return x * 4 + 90 + this.f; }
  m4(x) { return x * 5 + 90 + this.f; }
  m5(x) { return x * 6 + 90 + this.f; }
  m6(x) { return x * 7 + 90 + this.f; }
  m7(x) { return x * 8 + 90 + this.f; }
  m8(x) { return x * 9 + 90 + this.f; }
  m9(x) { return x * 10 + 90 + this.f; }
  m10(x) { return x * 11 + 90 + this.f; }
  m11(x) { return x * 12 + 90 + this.f; }
  m12(x) { return x * 13 + 90 + this.f; }
  m13(x) { return x * 14 + 90 + this.f; }
  m14(x) { return x * 15 + 90 + this.f; }
  m15(x) { return x * 16 + 90 + this.f; }
  m16(x) { return x * 17 + 90 + this.f; }
  m17(x) { return x * 18 + 90 + this.f; }
}
class C91 {
  constructor() {
    this.f = 91;
    this.tag = "c91";
  }
  put(k, v) {
    this[k] = v;
  }
  m0(x) { return x * 1 + 91 + this.f; }
  m1(x) { return x * 2 + 91 + this.f; }
  m2(x) { return x * 3 + 91 + this.f; }
  m3(x) { return x * 4 + 91 + this.f; }
  m4(x) { return x * 5 + 91 + this.f; }
  m5(x) { return x * 6 + 91 + this.f; }
  m6(x) { return x * 7 + 91 + this.f; }
  m7(x) { return x * 8 + 91 + this.f; }
  m8(x) { return x * 9 + 91 + this.f; }
  m9(x) { return x * 10 + 91 + this.f; }
  m10(x) { return x * 11 + 91 + this.f; }
  m11(x) { return x * 12 + 91 + this.f; }
  m12(x) { return x * 13 + 91 + this.f; }
  m13(x) { return x * 14 + 91 + this.f; }
  m14(x) { return x * 15 + 91 + this.f; }
  m15(x) { return x * 16 + 91 + this.f; }
  m16(x) { return x * 17 + 91 + this.f; }
  m17(x) { return x * 18 + 91 + this.f; }
}
class C92 extends EventEmitter {
  constructor() {
    super();
    this.f = 92;
    this.tag = "c92";
  }
  put(k, v) {
    this[k] = v;
  }
  z0() { return 0; }
  m0(x) { return x * 1 + 92 + this.f; }
  m1(x) { return x * 2 + 92 + this.f; }
  m2(x) { return x * 3 + 92 + this.f; }
  m3(x) { return x * 4 + 92 + this.f; }
  m4(x) { return x * 5 + 92 + this.f; }
  m5(x) { return x * 6 + 92 + this.f; }
  m6(x) { return x * 7 + 92 + this.f; }
  m7(x) { return x * 8 + 92 + this.f; }
  m8(x) { return x * 9 + 92 + this.f; }
  m9(x) { return x * 10 + 92 + this.f; }
  m10(x) { return x * 11 + 92 + this.f; }
  m11(x) { return x * 12 + 92 + this.f; }
  m12(x) { return x * 13 + 92 + this.f; }
  m13(x) { return x * 14 + 92 + this.f; }
  m14(x) { return x * 15 + 92 + this.f; }
  m15(x) { return x * 16 + 92 + this.f; }
  m16(x) { return x * 17 + 92 + this.f; }
  m17(x) { return x * 18 + 92 + this.f; }
}
class C93 {
  constructor() {
    this.f = 93;
    this.tag = "c93";
  }
  put(k, v) {
    this[k] = v;
  }
  z0() { return 0; }
  z1() { return 1; }
  m0(x) { return x * 1 + 93 + this.f; }
  m1(x) { return x * 2 + 93 + this.f; }
  m2(x) { return x * 3 + 93 + this.f; }
  m3(x) { return x * 4 + 93 + this.f; }
  m4(x) { return x * 5 + 93 + this.f; }
  m5(x) { return x * 6 + 93 + this.f; }
  m6(x) { return x * 7 + 93 + this.f; }
  m7(x) { return x * 8 + 93 + this.f; }
  m8(x) { return x * 9 + 93 + this.f; }
  m9(x) { return x * 10 + 93 + this.f; }
  m10(x) { return x * 11 + 93 + this.f; }
  m11(x) { return x * 12 + 93 + this.f; }
  m12(x) { return x * 13 + 93 + this.f; }
  m13(x) { return x * 14 + 93 + this.f; }
  m14(x) { return x * 15 + 93 + this.f; }
  m15(x) { return x * 16 + 93 + this.f; }
  m16(x) { return x * 17 + 93 + this.f; }
  m17(x) { return x * 18 + 93 + this.f; }
}
class C94 extends EventEmitter {
  constructor() {
    super();
    this.f = 94;
    this.tag = "c94";
  }
  put(k, v) {
    this[k] = v;
  }
  z0() { return 0; }
  z1() { return 1; }
  z2() { return 2; }
  m0(x) { return x * 1 + 94 + this.f; }
  m1(x) { return x * 2 + 94 + this.f; }
  m2(x) { return x * 3 + 94 + this.f; }
  m3(x) { return x * 4 + 94 + this.f; }
  m4(x) { return x * 5 + 94 + this.f; }
  m5(x) { return x * 6 + 94 + this.f; }
  m6(x) { return x * 7 + 94 + this.f; }
  m7(x) { return x * 8 + 94 + this.f; }
  m8(x) { return x * 9 + 94 + this.f; }
  m9(x) { return x * 10 + 94 + this.f; }
  m10(x) { return x * 11 + 94 + this.f; }
  m11(x) { return x * 12 + 94 + this.f; }
  m12(x) { return x * 13 + 94 + this.f; }
  m13(x) { return x * 14 + 94 + this.f; }
  m14(x) { return x * 15 + 94 + this.f; }
  m15(x) { return x * 16 + 94 + this.f; }
  m16(x) { return x * 17 + 94 + this.f; }
  m17(x) { return x * 18 + 94 + this.f; }
}
class C95 {
  constructor() {
    this.f = 95;
    this.tag = "c95";
  }
  put(k, v) {
    this[k] = v;
  }
  z0() { return 0; }
  z1() { return 1; }
  z2() { return 2; }
  z3() { return 3; }
  m0(x) { return x * 1 + 95 + this.f; }
  m1(x) { return x * 2 + 95 + this.f; }
  m2(x) { return x * 3 + 95 + this.f; }
  m3(x) { return x * 4 + 95 + this.f; }
  m4(x) { return x * 5 + 95 + this.f; }
  m5(x) { return x * 6 + 95 + this.f; }
  m6(x) { return x * 7 + 95 + this.f; }
  m7(x) { return x * 8 + 95 + this.f; }
  m8(x) { return x * 9 + 95 + this.f; }
  m9(x) { return x * 10 + 95 + this.f; }
  m10(x) { return x * 11 + 95 + this.f; }
  m11(x) { return x * 12 + 95 + this.f; }
  m12(x) { return x * 13 + 95 + this.f; }
  m13(x) { return x * 14 + 95 + this.f; }
  m14(x) { return x * 15 + 95 + this.f; }
  m15(x) { return x * 16 + 95 + this.f; }
  m16(x) { return x * 17 + 95 + this.f; }
  m17(x) { return x * 18 + 95 + this.f; }
}
class C96 extends EventEmitter {
  constructor() {
    super();
    this.f = 96;
    this.tag = "c96";
  }
  put(k, v) {
    this[k] = v;
  }
  z0() { return 0; }
  z1() { return 1; }
  z2() { return 2; }
  z3() { return 3; }
  z4() { return 4; }
  m0(x) { return x * 1 + 96 + this.f; }
  m1(x) { return x * 2 + 96 + this.f; }
  m2(x) { return x * 3 + 96 + this.f; }
  m3(x) { return x * 4 + 96 + this.f; }
  m4(x) { return x * 5 + 96 + this.f; }
  m5(x) { return x * 6 + 96 + this.f; }
  m6(x) { return x * 7 + 96 + this.f; }
  m7(x) { return x * 8 + 96 + this.f; }
  m8(x) { return x * 9 + 96 + this.f; }
  m9(x) { return x * 10 + 96 + this.f; }
  m10(x) { return x * 11 + 96 + this.f; }
  m11(x) { return x * 12 + 96 + this.f; }
  m12(x) { return x * 13 + 96 + this.f; }
  m13(x) { return x * 14 + 96 + this.f; }
  m14(x) { return x * 15 + 96 + this.f; }
  m15(x) { return x * 16 + 96 + this.f; }
  m16(x) { return x * 17 + 96 + this.f; }
  m17(x) { return x * 18 + 96 + this.f; }
}
class C97 {
  constructor() {
    this.f = 97;
    this.tag = "c97";
  }
  put(k, v) {
    this[k] = v;
  }
  z0() { return 0; }
  z1() { return 1; }
  z2() { return 2; }
  z3() { return 3; }
  z4() { return 4; }
  z5() { return 5; }
  m0(x) { return x * 1 + 97 + this.f; }
  m1(x) { return x * 2 + 97 + this.f; }
  m2(x) { return x * 3 + 97 + this.f; }
  m3(x) { return x * 4 + 97 + this.f; }
  m4(x) { return x * 5 + 97 + this.f; }
  m5(x) { return x * 6 + 97 + this.f; }
  m6(x) { return x * 7 + 97 + this.f; }
  m7(x) { return x * 8 + 97 + this.f; }
  m8(x) { return x * 9 + 97 + this.f; }
  m9(x) { return x * 10 + 97 + this.f; }
  m10(x) { return x * 11 + 97 + this.f; }
  m11(x) { return x * 12 + 97 + this.f; }
  m12(x) { return x * 13 + 97 + this.f; }
  m13(x) { return x * 14 + 97 + this.f; }
  m14(x) { return x * 15 + 97 + this.f; }
  m15(x) { return x * 16 + 97 + this.f; }
  m16(x) { return x * 17 + 97 + this.f; }
  m17(x) { return x * 18 + 97 + this.f; }
}
class C98 extends EventEmitter {
  constructor() {
    super();
    this.f = 98;
    this.tag = "c98";
  }
  put(k, v) {
    this[k] = v;
  }
  m0(x) { return x * 1 + 98 + this.f; }
  m1(x) { return x * 2 + 98 + this.f; }
  m2(x) { return x * 3 + 98 + this.f; }
  m3(x) { return x * 4 + 98 + this.f; }
  m4(x) { return x * 5 + 98 + this.f; }
  m5(x) { return x * 6 + 98 + this.f; }
  m6(x) { return x * 7 + 98 + this.f; }
  m7(x) { return x * 8 + 98 + this.f; }
  m8(x) { return x * 9 + 98 + this.f; }
  m9(x) { return x * 10 + 98 + this.f; }
  m10(x) { return x * 11 + 98 + this.f; }
  m11(x) { return x * 12 + 98 + this.f; }
  m12(x) { return x * 13 + 98 + this.f; }
  m13(x) { return x * 14 + 98 + this.f; }
  m14(x) { return x * 15 + 98 + this.f; }
  m15(x) { return x * 16 + 98 + this.f; }
  m16(x) { return x * 17 + 98 + this.f; }
  m17(x) { return x * 18 + 98 + this.f; }
}
class C99 {
  constructor() {
    this.f = 99;
    this.tag = "c99";
  }
  put(k, v) {
    this[k] = v;
  }
  z0() { return 0; }
  m0(x) { return x * 1 + 99 + this.f; }
  m1(x) { return x * 2 + 99 + this.f; }
  m2(x) { return x * 3 + 99 + this.f; }
  m3(x) { return x * 4 + 99 + this.f; }
  m4(x) { return x * 5 + 99 + this.f; }
  m5(x) { return x * 6 + 99 + this.f; }
  m6(x) { return x * 7 + 99 + this.f; }
  m7(x) { return x * 8 + 99 + this.f; }
  m8(x) { return x * 9 + 99 + this.f; }
  m9(x) { return x * 10 + 99 + this.f; }
  m10(x) { return x * 11 + 99 + this.f; }
  m11(x) { return x * 12 + 99 + this.f; }
  m12(x) { return x * 13 + 99 + this.f; }
  m13(x) { return x * 14 + 99 + this.f; }
  m14(x) { return x * 15 + 99 + this.f; }
  m15(x) { return x * 16 + 99 + this.f; }
  m16(x) { return x * 17 + 99 + this.f; }
  m17(x) { return x * 18 + 99 + this.f; }
}
/** @type {any[]} */
const objs = [];
objs.push(new C0());
objs.push(new C1());
objs.push(new C2());
objs.push(new C3());
objs.push(new C4());
objs.push(new C5());
objs.push(new C6());
objs.push(new C7());
objs.push(new C8());
objs.push(new C9());
objs.push(new C10());
objs.push(new C11());
objs.push(new C12());
objs.push(new C13());
objs.push(new C14());
objs.push(new C15());
objs.push(new C16());
objs.push(new C17());
objs.push(new C18());
objs.push(new C19());
objs.push(new C20());
objs.push(new C21());
objs.push(new C22());
objs.push(new C23());
objs.push(new C24());
objs.push(new C25());
objs.push(new C26());
objs.push(new C27());
objs.push(new C28());
objs.push(new C29());
objs.push(new C30());
objs.push(new C31());
objs.push(new C32());
objs.push(new C33());
objs.push(new C34());
objs.push(new C35());
objs.push(new C36());
objs.push(new C37());
objs.push(new C38());
objs.push(new C39());
objs.push(new C40());
objs.push(new C41());
objs.push(new C42());
objs.push(new C43());
objs.push(new C44());
objs.push(new C45());
objs.push(new C46());
objs.push(new C47());
objs.push(new C48());
objs.push(new C49());
objs.push(new C50());
objs.push(new C51());
objs.push(new C52());
objs.push(new C53());
objs.push(new C54());
objs.push(new C55());
objs.push(new C56());
objs.push(new C57());
objs.push(new C58());
objs.push(new C59());
objs.push(new C60());
objs.push(new C61());
objs.push(new C62());
objs.push(new C63());
objs.push(new C64());
objs.push(new C65());
objs.push(new C66());
objs.push(new C67());
objs.push(new C68());
objs.push(new C69());
objs.push(new C70());
objs.push(new C71());
objs.push(new C72());
objs.push(new C73());
objs.push(new C74());
objs.push(new C75());
objs.push(new C76());
objs.push(new C77());
objs.push(new C78());
objs.push(new C79());
objs.push(new C80());
objs.push(new C81());
objs.push(new C82());
objs.push(new C83());
objs.push(new C84());
objs.push(new C85());
objs.push(new C86());
objs.push(new C87());
objs.push(new C88());
objs.push(new C89());
objs.push(new C90());
objs.push(new C91());
objs.push(new C92());
objs.push(new C93());
objs.push(new C94());
objs.push(new C95());
objs.push(new C96());
objs.push(new C97());
objs.push(new C98());
objs.push(new C99());

/** @param {any} o @param {string} k @param {any} v */
function touch(o, k, v) {
  o[k] = v;
}
for (let round = 0; round < 3; round++) {
  for (let i = 0; i < objs.length; i++) {
    const o = objs[i];
    for (let k = 0; k < 18; k++) {
      const r = o["m" + k](round + 2);
      ck(r === (round + 2) * (k + 1) + i + o.f, "call " + i + "." + k);
      sum += r;
    }
    touch(o, "f", i + round);
    ck(o.f === i + round, "field " + i);
    touch(o, "extra" + (round % 2), round * 10 + i);
    ck(o["extra" + (round % 2)] === round * 10 + i, "expando " + i);
  }
}
for (let i = 0; i < objs.length; i += 3) {
  const o = objs[i];
  touch(o, "m3", (x) => -x);
  ck(o["m3"](5) === -5, "shadow call " + i);
  ck(o["m4"](1) === 5 + i + o.f, "sibling after shadow " + i);
  ck(typeof o["m3"] === "function", "shadow typeof " + i);
  ck(Object.keys(o).includes("m3"), "shadow listed " + i);
}
for (let i = 1; i < objs.length; i += 3) {
  const o = objs[i];
  ck(o["m3"](5) === 20 + i + o.f, "unshadowed " + i);
  ck(Object.keys(o).indexOf("m3") < 0, "unshadowed not listed " + i);
}
console.log(sum, bad);
console.log(Object.keys(objs[0]).join(","));
console.log(Object.keys(objs[1]).join(","));
console.log(Object.keys(objs[99]).join(","));
