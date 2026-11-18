// The namespace IS the util object: a member stored under the key a later member reads (emptyArray) must be seen by that later member.
var M={emptyArray:["orig"],oneOfGetter:function(e){for(var t=/** @type {any} */ ({}),n=0;n<e.length;++n)t[e[n]]=1;return function(){for(var e=Object.keys(this),n=e.length-1;n>-1;--n)if(1===t[e[n]]&&void 0!==this[e[n]]&&null!==this[e[n]])return e[n]}},oneOfSetter:function(e){return function(t){for(var n=0;n<e.length;++n)e[n]!==t&&delete this[e[n]]}}};
M.A=function(){function e(e){if(e)for(var t=Object.keys(e),n=0;n<t.length;++n)null!=e[t[n]]&&(this[t[n]]=e[t[n]])}var t;return e.prototype.f=M.emptyArray,Object.defineProperty(e.prototype,"_f",{get:M.oneOfGetter(t=["f"]),set:M.oneOfSetter(t)}),e}();
M.emptyArray=function(){function q(){}q.tag="built";return q}();
M.B=function(){function e(e){if(e)for(var t=Object.keys(e),n=0;n<t.length;++n)null!=e[t[n]]&&(this[t[n]]=e[t[n]])}var t;return e.prototype.g=M.emptyArray,Object.defineProperty(e.prototype,"_g",{get:M.oneOfGetter(t=["g"]),set:M.oneOfSetter(t)}),e}();
console.log(new M.A().f.join(),typeof new M.B().g,M.B.name,Object.keys(M).join());
