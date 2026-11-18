'use strict';
var M = {
  oneOfGetter(names) { var t = {}; for (var i = 0; i < names.length; ++i) t[names[i]] = 1; return function () { var k = Object.keys(this); for (var i = k.length - 1; i > -1; --i) if (1 === t[k[i]] && this[k[i]] !== undefined && this[k[i]] !== null) return k[i]; }; },
  oneOfSetter(names) { return function (v) { for (var i = 0; i < names.length; ++i) if (names[i] !== v) delete this[names[i]]; }; },
};
function Msg() {}
var t;
var names = [];
var mp = new Map();
Object.defineProperty(Msg.prototype,"_f0",{get:M.oneOfGetter(t=["f0"]),set:M.oneOfSetter(t)}),mp.set("f0", 0);
Object.defineProperty(Msg.prototype,"_f1",{get:M.oneOfGetter(t=["f1"]),set:M.oneOfSetter(t)}),mp.set("f1", 1);
Object.defineProperty(Msg.prototype,"_f2",{get:M.oneOfGetter(t=["f2"]),set:M.oneOfSetter(t)}),mp.set("f2", 2);
Object.defineProperty(Msg.prototype,"_f3",{get:M.oneOfGetter(t=["f3"]),set:M.oneOfSetter(t)}),mp.set("f3", 3);
Object.defineProperty(Msg.prototype,"_f4",{get:M.oneOfGetter(t=["f4"]),set:M.oneOfSetter(t)}),mp.set("f4", 4);
Object.defineProperty(Msg.prototype,"_f5",{get:M.oneOfGetter(t=["f5"]),set:M.oneOfSetter(t)}),mp.set("f5", 5);
Object.defineProperty(Msg.prototype,"_f6",{get:M.oneOfGetter(t=["f6"]),set:M.oneOfSetter(t)}),mp.set("f6", 6);
Object.defineProperty(Msg.prototype,"_f7",{get:M.oneOfGetter(t=["f7"]),set:M.oneOfSetter(t)}),mp.set("f7", 7);
Object.defineProperty(Msg.prototype,"_f8",{get:M.oneOfGetter(t=["f8"]),set:M.oneOfSetter(t)}),mp.set("f8", 8);
Object.defineProperty(Msg.prototype,"_f9",{get:M.oneOfGetter(t=["f9"]),set:M.oneOfSetter(t)}),mp.set("f9", 9);
var m = new Msg(); m.f2 = 1;
console.log(m._f2, mp.get("f2"), mp.get("f" + 9), mp.size);
