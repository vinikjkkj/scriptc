// Reflection over the namespace before any member is read, after one is read, and after all: a slot that is not yet built must look like the data property it becomes.
var M={emptyArray:Object.freeze([]),oneOfGetter:function(e){for(var t=/** @type {any} */ ({}),n=0;n<e.length;++n)t[e[n]]=1;return function(){for(var e=Object.keys(this),n=e.length-1;n>-1;--n)if(1===t[e[n]]&&void 0!==this[e[n]]&&null!==this[e[n]])return e[n]}},oneOfSetter:function(e){return function(t){for(var n=0;n<e.length;++n)e[n]!==t&&delete this[e[n]]}}};
var ns={};
ns.A=function(){function e(e){if(e)for(var t=Object.keys(e),n=0;n<t.length;++n)null!=e[t[n]]&&(this[t[n]]=e[t[n]])}var t;return e.prototype.f=M.emptyArray,Object.defineProperty(e.prototype,"_f",{get:M.oneOfGetter(t=["f"]),set:M.oneOfSetter(t)}),e}();
ns.B=function(){function e(e){if(e)for(var t=Object.keys(e),n=0;n<t.length;++n)null!=e[t[n]]&&(this[t[n]]=e[t[n]])}var t;return e.prototype.g=M.emptyArray,Object.defineProperty(e.prototype,"_g",{get:M.oneOfGetter(t=["g"]),set:M.oneOfSetter(t)}),e}();
ns.C=function(){function e(e){if(e)for(var t=Object.keys(e),n=0;n<t.length;++n)null!=e[t[n]]&&(this[t[n]]=e[t[n]])}var t;return e.prototype.h=M.emptyArray,Object.defineProperty(e.prototype,"_h",{get:M.oneOfGetter(t=["h"]),set:M.oneOfSetter(t)}),e}();
function show(tag){
  var d=Object.getOwnPropertyDescriptor(ns,"B");
  console.log(tag,"desc",typeof d.value,d.writable,d.enumerable,d.configurable,typeof d.get,typeof d.set);
  console.log(tag,"keys",Object.keys(ns).join(","));
  var s=[];for(var k in ns)s.push(k);console.log(tag,"forin",s.join(","));
  console.log(tag,"json",JSON.stringify(ns),JSON.stringify(Object.keys(ns)));
  console.log(tag,"names",Object.getOwnPropertyNames(ns).join(","));
  console.log(tag,"hasown",Object.prototype.hasOwnProperty.call(ns,"A"),"C" in ns);
}
show("0");
console.log(ns);
var a=new ns.A();
show("1");
console.log(Object.keys(ns).length,typeof ns.C);
show("2");
