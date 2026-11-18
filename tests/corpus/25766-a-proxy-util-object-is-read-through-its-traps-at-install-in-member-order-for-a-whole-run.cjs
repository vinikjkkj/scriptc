// The util object is a Proxy that logs every get: a run of members must perform the reads at install, per member and in order, exactly as Node does.
var log=[];var real={emptyArray:Object.freeze([]),oneOfGetter:function(e){for(var t=/** @type {any} */ ({}),n=0;n<e.length;++n)t[e[n]]=1;return function(){for(var e=Object.keys(this),n=e.length-1;n>-1;--n)if(1===t[e[n]]&&void 0!==this[e[n]]&&null!==this[e[n]])return e[n]}},oneOfSetter:function(e){return function(t){for(var n=0;n<e.length;++n)e[n]!==t&&delete this[e[n]]}}};
var M=new Proxy(real,{get:function(t,k,r){log.push(String(k));return Reflect.get(t,k,r)}});
var j=/** @type {any} */ ({}),n=/** @type {any} */ ({});
j.ns=((n={}).A=function(){function e(e){if(e)for(var t=Object.keys(e),n=0;n<t.length;++n)null!=e[t[n]]&&(this[t[n]]=e[t[n]])}var t;return e.prototype.f=M.emptyArray,Object.defineProperty(e.prototype,"_f",{get:M.oneOfGetter(t=["f"]),set:M.oneOfSetter(t)}),e}(),n.B=function(){function e(e){if(e)for(var t=Object.keys(e),n=0;n<t.length;++n)null!=e[t[n]]&&(this[t[n]]=e[t[n]])}var t;return e.prototype.g=M.emptyArray,Object.defineProperty(e.prototype,"_g",{get:M.oneOfGetter(t=["g"]),set:M.oneOfSetter(t)}),e}(),n.C=function(){function e(e){if(e)for(var t=Object.keys(e),n=0;n<t.length;++n)null!=e[t[n]]&&(this[t[n]]=e[t[n]])}var t;return e.prototype.h=M.emptyArray,Object.defineProperty(e.prototype,"_h",{get:M.oneOfGetter(t=["h"]),set:M.oneOfSetter(t)}),e}(),n);
console.log("after install",log.join(","));
var a=new j.ns.A();console.log("after use",log.length,a.f.length,a._f);
a.f=[1];console.log(a._f);
