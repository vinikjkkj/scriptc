// The thunk of a member reads M.emptyArray when it is installed; a later reassignment must not change what the first read builds.
var M={emptyArray:[1,2,3],oneOfGetter:function(e){for(var t=/** @type {any} */ ({}),n=0;n<e.length;++n)t[e[n]]=1;return function(){for(var e=Object.keys(this),n=e.length-1;n>-1;--n)if(1===t[e[n]]&&void 0!==this[e[n]]&&null!==this[e[n]])return e[n]}},oneOfSetter:function(e){return function(t){for(var n=0;n<e.length;++n)e[n]!==t&&delete this[e[n]]}}};
var ns={};
ns.A=function(){function e(e){if(e)for(var t=Object.keys(e),n=0;n<t.length;++n)null!=e[t[n]]&&(this[t[n]]=e[t[n]])}var t;return e.prototype.f=M.emptyArray,Object.defineProperty(e.prototype,"_f",{get:M.oneOfGetter(t=["f"]),set:M.oneOfSetter(t)}),e}();
Object.defineProperty(M,"emptyArray",{value:[9],writable:true,enumerable:true,configurable:true});
var a=new ns.A();
console.log(a.f.length,a.f.join(","),M.emptyArray.join(","));
var b=new ns.A({f:[1,2]});
console.log(b.f.length,b._f);
