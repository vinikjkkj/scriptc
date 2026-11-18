// Reflect.* over a namespace whose members have never been read, and an object whose prototype is that namespace.
var M={emptyArray:Object.freeze([]),oneOfGetter:function(e){for(var t=/** @type {any} */ ({}),n=0;n<e.length;++n)t[e[n]]=1;return function(){for(var e=Object.keys(this),n=e.length-1;n>-1;--n)if(1===t[e[n]]&&void 0!==this[e[n]]&&null!==this[e[n]])return e[n]}},oneOfSetter:function(e){return function(t){for(var n=0;n<e.length;++n)e[n]!==t&&delete this[e[n]]}}};
var ns=/** @type {any} */ ({});
ns.A=function(){function e(e){if(e)for(var t=Object.keys(e),n=0;n<t.length;++n)null!=e[t[n]]&&(this[t[n]]=e[t[n]])}var t;return e.prototype.f=M.emptyArray,Object.defineProperty(e.prototype,"_f",{get:M.oneOfGetter(t=["f"]),set:M.oneOfSetter(t)}),e}();
ns.B=function(){function e(e){if(e)for(var t=Object.keys(e),n=0;n<t.length;++n)null!=e[t[n]]&&(this[t[n]]=e[t[n]])}var t;return e.prototype.g=M.emptyArray,Object.defineProperty(e.prototype,"_g",{get:M.oneOfGetter(t=["g"]),set:M.oneOfSetter(t)}),e}();
ns.C=function(){function e(e){if(e)for(var t=Object.keys(e),n=0;n<t.length;++n)null!=e[t[n]]&&(this[t[n]]=e[t[n]])}var t;return e.prototype.h=M.emptyArray,Object.defineProperty(e.prototype,"_h",{get:M.oneOfGetter(t=["h"]),set:M.oneOfSetter(t)}),e}();
ns.D=function(){function e(e){if(e)for(var t=Object.keys(e),n=0;n<t.length;++n)null!=e[t[n]]&&(this[t[n]]=e[t[n]])}var t;return e.prototype.i=M.emptyArray,Object.defineProperty(e.prototype,"_i",{get:M.oneOfGetter(t=["i"]),set:M.oneOfSetter(t)}),e}();
ns.E=function(){function e(e){if(e)for(var t=Object.keys(e),n=0;n<t.length;++n)null!=e[t[n]]&&(this[t[n]]=e[t[n]])}var t;return e.prototype.j=M.emptyArray,Object.defineProperty(e.prototype,"_j",{get:M.oneOfGetter(t=["j"]),set:M.oneOfSetter(t)}),e}();
console.log(typeof Reflect.get(ns,"A"),Reflect.has(ns,"B"));
var d=Object.getOwnPropertyDescriptor(ns,"C");console.log(typeof d.value,d.writable,d.configurable,typeof d.get);
console.log(Reflect.defineProperty(ns,"D",{value:7,writable:true,enumerable:true,configurable:true}),ns.D,Object.keys(ns).join(","));
console.log(Reflect.deleteProperty(ns,"E"),Object.keys(ns).join(","));
console.log(Reflect.set(ns,"B",3),ns.B,Object.keys(ns).join(","));
var child=Object.create(ns);
console.log(typeof child.C,Object.keys(child).length,"C" in child,child.hasOwnProperty("C"));
child.C=5;console.log(child.C,typeof ns.C,child.hasOwnProperty("C"));
