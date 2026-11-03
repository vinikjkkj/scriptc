// REFUSED AT COMPILE TIME. A run-time specifier that is NOT a build-time
// constant at its call sites (picked from a table at run time): the set of
// specifiers that reach the require is not a literal list, so the proof cannot
// close it and the refusal stays.
"use strict";var e,t,n,o=Object.getOwnPropertyNames,r=(e,t)=>function(){return t||(0,e[o(e)[0]])((t={exports:{}}).exports,t),t.exports},
l=r({"node_modules/protobufjs/src/util/inquire.js"(e,t){t.exports=function(e){try{if("function"!=typeof require)return null;var t=require(e);return t&&(t.length||Object.keys(t).length)?t:null}catch(e){return null}}}}),
y=r({"node_modules/protobufjs/src/util/minimal.js"(e){var t=e;t.inquire=l();t.isNode=true}}),
k=r({"node_modules/protobufjs/src/roots.js"(e,t){t.exports=Object.create(null)}}),
v=r({"node_modules/protobufjs/src/index-minimal.js"(e){var t=e;t.build="minimal",t.util=y(),t.roots=k()}}),
_=r({"node_modules/protobufjs/minimal.js"(e,t){t.exports=v()}})(),M=_.util;
module.exports = {};
var names = ["long", "no-such-module-xyz"]; var out = [];
for (var i = 0; i < names.length; i++) out.push(M.inquire(names[i]));
console.log(out.length);
