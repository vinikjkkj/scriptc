// The integrity tests over a namespace whose members have never been read (freeze, seal and preventExtensions have no lowering for a dyn object yet).
var M={emptyArray:Object.freeze([]),oneOfGetter:function(e){for(var t=/** @type {any} */ ({}),n=0;n<e.length;++n)t[e[n]]=1;return function(){for(var e=Object.keys(this),n=e.length-1;n>-1;--n)if(1===t[e[n]]&&void 0!==this[e[n]]&&null!==this[e[n]])return e[n]}},oneOfSetter:function(e){return function(t){for(var n=0;n<e.length;++n)e[n]!==t&&delete this[e[n]]}}};
var ns=/** @type {any} */ ({});
ns.A=function(){function e(e){if(e)for(var t=Object.keys(e),n=0;n<t.length;++n)null!=e[t[n]]&&(this[t[n]]=e[t[n]])}var t;return e.prototype.f=M.emptyArray,Object.defineProperty(e.prototype,"_f",{get:M.oneOfGetter(t=["f"]),set:M.oneOfSetter(t)}),e}();
ns.B=function(){function e(e){if(e)for(var t=Object.keys(e),n=0;n<t.length;++n)null!=e[t[n]]&&(this[t[n]]=e[t[n]])}var t;return e.prototype.g=M.emptyArray,Object.defineProperty(e.prototype,"_g",{get:M.oneOfGetter(t=["g"]),set:M.oneOfSetter(t)}),e}();
ns.C=function(){function e(e){if(e)for(var t=Object.keys(e),n=0;n<t.length;++n)null!=e[t[n]]&&(this[t[n]]=e[t[n]])}var t;return e.prototype.h=M.emptyArray,Object.defineProperty(e.prototype,"_h",{get:M.oneOfGetter(t=["h"]),set:M.oneOfSetter(t)}),e}();
console.log(Object.isExtensible(ns),Object.isFrozen(ns),Object.isSealed(ns));
var d=Object.getOwnPropertyDescriptor(ns,"A");console.log(typeof d.value,d.writable,d.configurable,typeof d.get);
console.log(Object.isExtensible(ns),Object.isFrozen(ns),Object.isSealed(ns),typeof ns.B,typeof ns.C);
console.log(Object.isFrozen(ns.A),Object.isExtensible(ns.B));
