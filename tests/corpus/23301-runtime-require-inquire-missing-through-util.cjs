// The same bundle shape, but util.inquire IS called, through the exported util
// object: every specifier that reaches the run-time require is one Node cannot
// resolve (long is not installed, the other two do not exist), so each call is
// Node's catchable MODULE_NOT_FOUND, which inquire swallows into null.
"use strict";var e,t,n,o=Object.getOwnPropertyNames,r=(e,t)=>function(){return t||(0,e[o(e)[0]])((t={exports:{}}).exports,t),t.exports},
l=r({"node_modules/protobufjs/src/util/inquire.js"(e,t){t.exports=function(e){try{if("function"!=typeof require)return null;var t=require(e);return t&&(t.length||Object.keys(t).length)?t:null}catch(e){return null}}}}),
y=r({"node_modules/protobufjs/src/util/minimal.js"(e){var t=e;t.inquire=l();t.Long=t.inquire("long");t.other=t.inquire("no-such-module-xyz");t.again=t.inquire("long");t.rel=t.inquire("./not-there-xyz")}}),
k=r({"node_modules/protobufjs/src/roots.js"(e,t){t.exports=Object.create(null)}}),
v=r({"node_modules/protobufjs/src/index-minimal.js"(e){var t=e;t.build="minimal",t.util=y(),t.roots=k()}}),
_=r({"node_modules/protobufjs/minimal.js"(e,t){t.exports=v()}})(),M=_.util,j=_.roots.default||(_.roots.default={});
j.info=function(){return [M.Long, M.other, M.again, M.rel, typeof M.inquire]};
module.exports=j;
console.log(j.info());
console.log(M.inquire("long"), M.inquire("@scope/pkg-xyz"), M.inquire("vites"));
console.log(String(M.inquire("long") === null), String(M.inquire("zzz-1") == null));
