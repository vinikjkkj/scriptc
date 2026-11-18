// Whole-object operations that read every value.
var M={emptyArray:Object.freeze([]),oneOfGetter:function(e){for(var t=/** @type {any} */ ({}),n=0;n<e.length;++n)t[e[n]]=1;return function(){for(var e=Object.keys(this),n=e.length-1;n>-1;--n)if(1===t[e[n]]&&void 0!==this[e[n]]&&null!==this[e[n]])return e[n]}},oneOfSetter:function(e){return function(t){for(var n=0;n<e.length;++n)e[n]!==t&&delete this[e[n]]}}};
var ns=/** @type {any} */ ({});
ns.A=function(){function e(e){if(e)for(var t=Object.keys(e),n=0;n<t.length;++n)null!=e[t[n]]&&(this[t[n]]=e[t[n]])}var t;return e.prototype.f=M.emptyArray,Object.defineProperty(e.prototype,"_f",{get:M.oneOfGetter(t=["f"]),set:M.oneOfSetter(t)}),e}();
ns.B=function(){function e(e){if(e)for(var t=Object.keys(e),n=0;n<t.length;++n)null!=e[t[n]]&&(this[t[n]]=e[t[n]])}var t;return e.prototype.g=M.emptyArray,Object.defineProperty(e.prototype,"_g",{get:M.oneOfGetter(t=["g"]),set:M.oneOfSetter(t)}),e}();
console.log(Reflect.ownKeys(ns).join(","));
console.log(JSON.stringify(ns),JSON.stringify({x:ns}));
var o=Object.assign({},ns);console.log(Object.keys(o).join(","),typeof o.A,typeof o.B);
var sp={...ns};console.log(Object.keys(sp).join(","),typeof sp.B);
console.log(Object.values(ns).map(function(v){return typeof v}).join(","),Object.entries(ns).map(function(e){return e[0]+":"+typeof e[1]}).join(","));
try{var sc=structuredClone(ns);console.log("clone",Object.keys(sc).join(","))}catch(e){console.log("clone threw",e.name)}
