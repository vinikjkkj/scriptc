// Redefining, deleting and assigning over members that have never been read.
var M={emptyArray:Object.freeze([]),oneOfGetter:function(e){for(var t=/** @type {any} */ ({}),n=0;n<e.length;++n)t[e[n]]=1;return function(){for(var e=Object.keys(this),n=e.length-1;n>-1;--n)if(1===t[e[n]]&&void 0!==this[e[n]]&&null!==this[e[n]])return e[n]}},oneOfSetter:function(e){return function(t){for(var n=0;n<e.length;++n)e[n]!==t&&delete this[e[n]]}}};
var ns=/** @type {any} */ ({});
ns.A=function(){function e(e){if(e)for(var t=Object.keys(e),n=0;n<t.length;++n)null!=e[t[n]]&&(this[t[n]]=e[t[n]])}var t;return e.prototype.f=M.emptyArray,Object.defineProperty(e.prototype,"_f",{get:M.oneOfGetter(t=["f"]),set:M.oneOfSetter(t)}),e}();
ns.B=function(){function e(e){if(e)for(var t=Object.keys(e),n=0;n<t.length;++n)null!=e[t[n]]&&(this[t[n]]=e[t[n]])}var t;return e.prototype.g=M.emptyArray,Object.defineProperty(e.prototype,"_g",{get:M.oneOfGetter(t=["g"]),set:M.oneOfSetter(t)}),e}();
ns.C=function(){function e(e){if(e)for(var t=Object.keys(e),n=0;n<t.length;++n)null!=e[t[n]]&&(this[t[n]]=e[t[n]])}var t;return e.prototype.h=M.emptyArray,Object.defineProperty(e.prototype,"_h",{get:M.oneOfGetter(t=["h"]),set:M.oneOfSetter(t)}),e}();
ns.D=function(){function e(e){if(e)for(var t=Object.keys(e),n=0;n<t.length;++n)null!=e[t[n]]&&(this[t[n]]=e[t[n]])}var t;return e.prototype.i=M.emptyArray,Object.defineProperty(e.prototype,"_i",{get:M.oneOfGetter(t=["i"]),set:M.oneOfSetter(t)}),e}();
Object.defineProperty(ns,"A",{value:1,writable:false,enumerable:false,configurable:true});
console.log(ns.A,Object.keys(ns).join(","),JSON.stringify(Object.getOwnPropertyDescriptor(ns,"A")));
console.log(delete ns.B,Object.keys(ns).join(","),typeof ns.B);
ns.C=5;console.log(ns.C,Object.keys(ns).join(","));
Object.defineProperty(ns,"D",{get:function(){return "got"},enumerable:true,configurable:true});
console.log(ns.D,Object.keys(ns).join(","),typeof Object.getOwnPropertyDescriptor(ns,"D").get);
