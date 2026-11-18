'use strict';
var M = {
  oneOfGetter(names) { var t = {}; for (var i = 0; i < names.length; ++i) t[names[i]] = 1; return function () { var k = Object.keys(this); for (var i = k.length - 1; i > -1; --i) if (1 === t[k[i]] && this[k[i]] !== undefined && this[k[i]] !== null) return k[i]; }; },
  oneOfSetter(names) { return function (v) { for (var i = 0; i < names.length; ++i) if (names[i] !== v) delete this[names[i]]; }; },
};
var calls = 0;
var inner = M.oneOfGetter;
M.oneOfGetter = function (names) { calls += 1; if (calls === 37) throw new Error('row 37 ' + names[0]); return inner(names); };
function Msg() {}
var t;
try {
Object.defineProperty(Msg.prototype,"_f0",{get:M.oneOfGetter(t=["f0"]),set:M.oneOfSetter(t)});
Object.defineProperty(Msg.prototype,"_f1",{get:M.oneOfGetter(t=["f1"]),set:M.oneOfSetter(t)});
Object.defineProperty(Msg.prototype,"_f2",{get:M.oneOfGetter(t=["f2"]),set:M.oneOfSetter(t)});
Object.defineProperty(Msg.prototype,"_f3",{get:M.oneOfGetter(t=["f3"]),set:M.oneOfSetter(t)});
Object.defineProperty(Msg.prototype,"_f4",{get:M.oneOfGetter(t=["f4"]),set:M.oneOfSetter(t)});
Object.defineProperty(Msg.prototype,"_f5",{get:M.oneOfGetter(t=["f5"]),set:M.oneOfSetter(t)});
Object.defineProperty(Msg.prototype,"_f6",{get:M.oneOfGetter(t=["f6"]),set:M.oneOfSetter(t)});
Object.defineProperty(Msg.prototype,"_f7",{get:M.oneOfGetter(t=["f7"]),set:M.oneOfSetter(t)});
Object.defineProperty(Msg.prototype,"_f8",{get:M.oneOfGetter(t=["f8"]),set:M.oneOfSetter(t)});
Object.defineProperty(Msg.prototype,"_f9",{get:M.oneOfGetter(t=["f9"]),set:M.oneOfSetter(t)});
Object.defineProperty(Msg.prototype,"_f10",{get:M.oneOfGetter(t=["f10"]),set:M.oneOfSetter(t)});
Object.defineProperty(Msg.prototype,"_f11",{get:M.oneOfGetter(t=["f11"]),set:M.oneOfSetter(t)});
Object.defineProperty(Msg.prototype,"_f12",{get:M.oneOfGetter(t=["f12"]),set:M.oneOfSetter(t)});
Object.defineProperty(Msg.prototype,"_f13",{get:M.oneOfGetter(t=["f13"]),set:M.oneOfSetter(t)});
Object.defineProperty(Msg.prototype,"_f14",{get:M.oneOfGetter(t=["f14"]),set:M.oneOfSetter(t)});
Object.defineProperty(Msg.prototype,"_f15",{get:M.oneOfGetter(t=["f15"]),set:M.oneOfSetter(t)});
Object.defineProperty(Msg.prototype,"_f16",{get:M.oneOfGetter(t=["f16"]),set:M.oneOfSetter(t)});
Object.defineProperty(Msg.prototype,"_f17",{get:M.oneOfGetter(t=["f17"]),set:M.oneOfSetter(t)});
Object.defineProperty(Msg.prototype,"_f18",{get:M.oneOfGetter(t=["f18"]),set:M.oneOfSetter(t)});
Object.defineProperty(Msg.prototype,"_f19",{get:M.oneOfGetter(t=["f19"]),set:M.oneOfSetter(t)});
Object.defineProperty(Msg.prototype,"_f20",{get:M.oneOfGetter(t=["f20"]),set:M.oneOfSetter(t)});
Object.defineProperty(Msg.prototype,"_f21",{get:M.oneOfGetter(t=["f21"]),set:M.oneOfSetter(t)});
Object.defineProperty(Msg.prototype,"_f22",{get:M.oneOfGetter(t=["f22"]),set:M.oneOfSetter(t)});
Object.defineProperty(Msg.prototype,"_f23",{get:M.oneOfGetter(t=["f23"]),set:M.oneOfSetter(t)});
Object.defineProperty(Msg.prototype,"_f24",{get:M.oneOfGetter(t=["f24"]),set:M.oneOfSetter(t)});
Object.defineProperty(Msg.prototype,"_f25",{get:M.oneOfGetter(t=["f25"]),set:M.oneOfSetter(t)});
Object.defineProperty(Msg.prototype,"_f26",{get:M.oneOfGetter(t=["f26"]),set:M.oneOfSetter(t)});
Object.defineProperty(Msg.prototype,"_f27",{get:M.oneOfGetter(t=["f27"]),set:M.oneOfSetter(t)});
Object.defineProperty(Msg.prototype,"_f28",{get:M.oneOfGetter(t=["f28"]),set:M.oneOfSetter(t)});
Object.defineProperty(Msg.prototype,"_f29",{get:M.oneOfGetter(t=["f29"]),set:M.oneOfSetter(t)});
Object.defineProperty(Msg.prototype,"_f30",{get:M.oneOfGetter(t=["f30"]),set:M.oneOfSetter(t)});
Object.defineProperty(Msg.prototype,"_f31",{get:M.oneOfGetter(t=["f31"]),set:M.oneOfSetter(t)});
Object.defineProperty(Msg.prototype,"_f32",{get:M.oneOfGetter(t=["f32"]),set:M.oneOfSetter(t)});
Object.defineProperty(Msg.prototype,"_f33",{get:M.oneOfGetter(t=["f33"]),set:M.oneOfSetter(t)});
Object.defineProperty(Msg.prototype,"_f34",{get:M.oneOfGetter(t=["f34"]),set:M.oneOfSetter(t)});
Object.defineProperty(Msg.prototype,"_f35",{get:M.oneOfGetter(t=["f35"]),set:M.oneOfSetter(t)});
Object.defineProperty(Msg.prototype,"_f36",{get:M.oneOfGetter(t=["f36"]),set:M.oneOfSetter(t)});
Object.defineProperty(Msg.prototype,"_f37",{get:M.oneOfGetter(t=["f37"]),set:M.oneOfSetter(t)});
Object.defineProperty(Msg.prototype,"_f38",{get:M.oneOfGetter(t=["f38"]),set:M.oneOfSetter(t)});
Object.defineProperty(Msg.prototype,"_f39",{get:M.oneOfGetter(t=["f39"]),set:M.oneOfSetter(t)});
Object.defineProperty(Msg.prototype,"_f40",{get:M.oneOfGetter(t=["f40"]),set:M.oneOfSetter(t)});
Object.defineProperty(Msg.prototype,"_f41",{get:M.oneOfGetter(t=["f41"]),set:M.oneOfSetter(t)});
Object.defineProperty(Msg.prototype,"_f42",{get:M.oneOfGetter(t=["f42"]),set:M.oneOfSetter(t)});
Object.defineProperty(Msg.prototype,"_f43",{get:M.oneOfGetter(t=["f43"]),set:M.oneOfSetter(t)});
Object.defineProperty(Msg.prototype,"_f44",{get:M.oneOfGetter(t=["f44"]),set:M.oneOfSetter(t)});
Object.defineProperty(Msg.prototype,"_f45",{get:M.oneOfGetter(t=["f45"]),set:M.oneOfSetter(t)});
Object.defineProperty(Msg.prototype,"_f46",{get:M.oneOfGetter(t=["f46"]),set:M.oneOfSetter(t)});
Object.defineProperty(Msg.prototype,"_f47",{get:M.oneOfGetter(t=["f47"]),set:M.oneOfSetter(t)});
Object.defineProperty(Msg.prototype,"_f48",{get:M.oneOfGetter(t=["f48"]),set:M.oneOfSetter(t)});
Object.defineProperty(Msg.prototype,"_f49",{get:M.oneOfGetter(t=["f49"]),set:M.oneOfSetter(t)});
} catch (e) {
  console.log("caught", e.message, "calls", calls);
}
console.log(Object.keys(Msg.prototype).length, Object.getOwnPropertyNames(Msg.prototype).filter(function (k) { return k.charAt(0) === "_"; }).length, Object.getOwnPropertyNames(Msg.prototype).indexOf("_f35") >= 0, Object.getOwnPropertyNames(Msg.prototype).indexOf("_f36") >= 0);
