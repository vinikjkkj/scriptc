// protobufjs inquire() bundled by esbuild (zapo's spec/proto shape): the
// function holding `require(e)` is stored into a __commonJS module object,
// read back and returned by the wrapper, and stored into a field of the util
// object, which the rest of the bundle uses (but never reads `inquire` from).
// Nothing ever calls it, so the run-time-specifier require never runs: the
// build proves that from the whole file and the program compiles exactly.
"use strict";var e,t,n,o=Object.getOwnPropertyNames,r=(e,t)=>function(){return t||(0,e[o(e)[0]])((t={exports:{}}).exports,t),t.exports},
l=r({"node_modules/protobufjs/src/util/inquire.js"(e,t){t.exports=function(e){try{if("function"!=typeof require)return null;var t=require(e);return t&&(t.length||Object.keys(t).length)?t:null}catch(e){return null}}}}),
y=r({"node_modules/protobufjs/src/util/minimal.js"(e){var t=e;function lc(s){return s.charAt(0).toLowerCase()+s.substring(1)}t.inquire=l();t.isNode=Boolean("undefined"!=typeof global&&global&&global.process&&global.process.versions&&global.process.versions.node);t.global=t.isNode&&global||e;t.lcFirst=lc;t.Buffer=function(){try{var b=t.global.Buffer;return b.prototype.utf8Write?b:null}catch(b){return null}}();t._Buffer_from=null;t.makeProp=function(e,t,n){Object.defineProperty(e,t,{enumerable:void 0===n||n,configurable:!0,writable:!0})};t.oneOfGetter=function(e){for(var t={},n=0;n<e.length;++n)t[e[n]]=1;return function(){for(var e=Object.keys(this),n=e.length-1;n>-1;--n)if(1===t[e[n]]&&void 0!==this[e[n]]&&null!==this[e[n]])return e[n]}};t._configure=function(){var b=t.Buffer;b?(t._Buffer_from=b.from!==Uint8Array.from&&b.from||function(x,y){return new b(x,y)}):t._Buffer_from=null}}}),
w=r({"node_modules/protobufjs/src/writer.js"(e,t){t.exports=s;var n,o=y(),a=o.lcFirst;function s(){this.x=a("Hello")}s.create=function(){return new s};s.fromString=function(str){return o._Buffer_from(str)}}}),
k=r({"node_modules/protobufjs/src/roots.js"(e,t){t.exports=Object.create(null)}}),
v=r({"node_modules/protobufjs/src/index-minimal.js"(e){var t=e;t.build="minimal",t.Writer=w(),t.util=y(),t.roots=k(),t.configure=function(){t.util._configure()},t.configure()}}),
_=r({"node_modules/protobufjs/minimal.js"(e,t){t.exports=v()}})(),S=_.Writer,M=_.util,j=_.roots.default||(_.roots.default={});
j.waproto=(function(){var n={};n.Msg=function(){function C(p){}C.prototype.hello="";C.create=function(p){return new C(p)};M.makeProp(C.prototype,"hello",false);Object.defineProperty(C.prototype,"which",{get:M.oneOfGetter(["hello"]),set:M.oneOfGetter(["hello"])});return C}();return n})();
module.exports=j;
console.log(typeof j.waproto.Msg, typeof S.create, M.lcFirst("Abc"), typeof M.isNode);
var m=new j.waproto.Msg();
console.log(Object.keys(m).length, m.which, typeof M.inquire);
console.log(typeof S.fromString, typeof M.lcFirst);
