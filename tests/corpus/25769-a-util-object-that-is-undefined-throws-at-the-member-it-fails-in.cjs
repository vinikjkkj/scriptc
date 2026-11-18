// M is undefined when the run installs: Node installs member A (it reads nothing), then throws inside B; the namespace keeps A and not B.
var M;var ns={};
try{
ns.A=function(){function e(){}return e.prototype.k=1,e}(),ns.B=function(){function e(e){if(e)for(var t=Object.keys(e),n=0;n<t.length;++n)null!=e[t[n]]&&(this[t[n]]=e[t[n]])}var t;return e.prototype.g=M.emptyArray,Object.defineProperty(e.prototype,"_g",{get:M.oneOfGetter(t=["g"]),set:M.oneOfSetter(t)}),e}(),ns.C=function(){function e(e){if(e)for(var t=Object.keys(e),n=0;n<t.length;++n)null!=e[t[n]]&&(this[t[n]]=e[t[n]])}var t;return e.prototype.h=M.emptyArray,Object.defineProperty(e.prototype,"_h",{get:M.oneOfGetter(t=["h"]),set:M.oneOfSetter(t)}),e}();
}catch(err){console.log(err instanceof TypeError,String(err.message).slice(0,40))}
console.log(Object.keys(ns).join(),typeof ns.A,new ns.A().k);
