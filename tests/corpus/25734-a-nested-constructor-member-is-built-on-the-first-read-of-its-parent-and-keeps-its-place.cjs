// A constructor nested in a constructor: reading the parent builds it, the nested member keeps its place in the parent's own keys.
var M={emptyArray:Object.freeze([]),oneOfGetter:function(e){for(var t=/** @type {any} */ ({}),n=0;n<e.length;++n)t[e[n]]=1;return function(){for(var e=Object.keys(this),n=e.length-1;n>-1;--n)if(1===t[e[n]]&&void 0!==this[e[n]]&&null!==this[e[n]])return e[n]}},oneOfSetter:function(e){return function(t){for(var n=0;n<e.length;++n)e[n]!==t&&delete this[e[n]]}}};
var ns={};
ns.Outer=function(){function e(e){if(e)for(var t=Object.keys(e),n=0;n<t.length;++n)null!=e[t[n]]&&(this[t[n]]=e[t[n]])}var t;return e.prototype.a=M.emptyArray,Object.defineProperty(e.prototype,"_a",{get:M.oneOfGetter(t=["a"]),set:M.oneOfSetter(t)}),e.Inner=function(){function e(e){this.z=e}var t;return e.prototype.z=M.emptyArray,Object.defineProperty(e.prototype,"_z",{get:M.oneOfGetter(t=["z"]),set:M.oneOfSetter(t)}),e.Leaf=function(){function e(){}return e.prototype.q=1,e}(),e}(),e.Other=function(){function e(){}return e.prototype.w=2,e}(),e}();
var O=ns.Outer;
console.log(Object.keys(O).join(","),typeof O.Inner,Object.keys(O.Inner).join(","));
var i=new O.Inner(3);
console.log(i.z,i._z,new O.Inner.Leaf().q,new O.Other().w);
console.log(Object.keys(O).join(","),O.Inner===O.Inner,Object.keys(O.Inner).join(","));
