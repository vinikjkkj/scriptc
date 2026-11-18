'use strict';
var M = {
  oneOfGetter(names) { var t = {}; for (var i = 0; i < names.length; ++i) t[names[i]] = 1; return function () { var k = Object.keys(this); for (var i = k.length - 1; i > -1; --i) if (1 === t[k[i]] && this[k[i]] !== undefined && this[k[i]] !== null) return k[i]; }; },
  oneOfSetter(names) { return function (v) { for (var i = 0; i < names.length; ++i) if (names[i] !== v) delete this[names[i]]; }; },
};
function Msg() {}
var t;
for (var k = 0; k < 2; k++) {
Object.defineProperty(Msg.prototype,"_f0",{configurable:true,get:M.oneOfGetter(t=["f0"]),set:M.oneOfSetter(t)});
Object.defineProperty(Msg.prototype,"_f1",{configurable:true,get:M.oneOfGetter(t=["f1"]),set:M.oneOfSetter(t)});
Object.defineProperty(Msg.prototype,"_f2",{configurable:true,get:M.oneOfGetter(t=["f2"]),set:M.oneOfSetter(t)});
Object.defineProperty(Msg.prototype,"_f3",{configurable:true,get:M.oneOfGetter(t=["f3"]),set:M.oneOfSetter(t)});
Object.defineProperty(Msg.prototype,"_f4",{configurable:true,get:M.oneOfGetter(t=["f4"]),set:M.oneOfSetter(t)});
Object.defineProperty(Msg.prototype,"_f5",{configurable:true,get:M.oneOfGetter(t=["f5"]),set:M.oneOfSetter(t)});
}
function Two() {}
Object.defineProperty(Two.prototype,"_f0",{configurable:true,get:M.oneOfGetter(t=["f0"]),set:M.oneOfSetter(t)});
Object.defineProperty(Two.prototype,"_f1",{configurable:true,get:M.oneOfGetter(t=["f1"]),set:M.oneOfSetter(t)});
Object.defineProperty(Two.prototype,"_f2",{configurable:true,get:M.oneOfGetter(t=["f2"]),set:M.oneOfSetter(t)});
var m = new Msg(); m.f2 = 1; var n = new Two(); n.f1 = 2;
console.log(m._f2, n._f1, Object.keys(Msg.prototype).length, Object.keys(Two.prototype).length);
