'use strict';
var M = {
  oneOfGetter(names) { var t = {}; for (var i = 0; i < names.length; ++i) t[names[i]] = 1; return function () { var k = Object.keys(this); for (var i = k.length - 1; i > -1; --i) if (1 === t[k[i]] && this[k[i]] !== undefined && this[k[i]] !== null) return k[i]; }; },
  oneOfSetter(names) { return function (v) { for (var i = 0; i < names.length; ++i) if (names[i] !== v) delete this[names[i]]; }; },
};
var log = [];
var target = {};
var proto = new Proxy(target, { defineProperty: function (t, k, d) { log.push(String(k)); return Reflect.defineProperty(t, k, d); } });
var t;
Object.defineProperty(proto,"_f0",{get:M.oneOfGetter(t=["f0"]),set:M.oneOfSetter(t)});
Object.defineProperty(proto,"_f1",{get:M.oneOfGetter(t=["f1"]),set:M.oneOfSetter(t)});
Object.defineProperty(proto,"_f2",{get:M.oneOfGetter(t=["f2"]),set:M.oneOfSetter(t)});
Object.defineProperty(proto,"_f3",{get:M.oneOfGetter(t=["f3"]),set:M.oneOfSetter(t)});
Object.defineProperty(proto,"_f4",{get:M.oneOfGetter(t=["f4"]),set:M.oneOfSetter(t)});
Object.defineProperty(proto,"_f5",{get:M.oneOfGetter(t=["f5"]),set:M.oneOfSetter(t)});
Object.defineProperty(proto,"_f6",{get:M.oneOfGetter(t=["f6"]),set:M.oneOfSetter(t)});
Object.defineProperty(proto,"_f7",{get:M.oneOfGetter(t=["f7"]),set:M.oneOfSetter(t)});
Object.defineProperty(proto,"_f8",{get:M.oneOfGetter(t=["f8"]),set:M.oneOfSetter(t)});
Object.defineProperty(proto,"_f9",{get:M.oneOfGetter(t=["f9"]),set:M.oneOfSetter(t)});
Object.defineProperty(proto,"_f10",{get:M.oneOfGetter(t=["f10"]),set:M.oneOfSetter(t)});
Object.defineProperty(proto,"_f11",{get:M.oneOfGetter(t=["f11"]),set:M.oneOfSetter(t)});
Object.defineProperty(proto,"_f12",{get:M.oneOfGetter(t=["f12"]),set:M.oneOfSetter(t)});
Object.defineProperty(proto,"_f13",{get:M.oneOfGetter(t=["f13"]),set:M.oneOfSetter(t)});
Object.defineProperty(proto,"_f14",{get:M.oneOfGetter(t=["f14"]),set:M.oneOfSetter(t)});
Object.defineProperty(proto,"_f15",{get:M.oneOfGetter(t=["f15"]),set:M.oneOfSetter(t)});
Object.defineProperty(proto,"_f16",{get:M.oneOfGetter(t=["f16"]),set:M.oneOfSetter(t)});
Object.defineProperty(proto,"_f17",{get:M.oneOfGetter(t=["f17"]),set:M.oneOfSetter(t)});
Object.defineProperty(proto,"_f18",{get:M.oneOfGetter(t=["f18"]),set:M.oneOfSetter(t)});
Object.defineProperty(proto,"_f19",{get:M.oneOfGetter(t=["f19"]),set:M.oneOfSetter(t)});
console.log(log.length, log.slice(0, 3).join(","), log.slice(-2).join(","), Object.keys(target).length);
