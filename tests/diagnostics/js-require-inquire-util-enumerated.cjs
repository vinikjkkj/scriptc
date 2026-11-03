// REFUSED AT COMPILE TIME. The inquire-holding util object read through a
// computed key (the enumeration idiom): any key, `inquire` included, could be
// asked for, so the proof must not close it.
"use strict";var e,t,n,o=Object.getOwnPropertyNames,r=(e,t)=>function(){return t||(0,e[o(e)[0]])((t={exports:{}}).exports,t),t.exports},
l=r({"node_modules/protobufjs/src/util/inquire.js"(e,t){t.exports=function(e){try{if("function"!=typeof require)return null;var t=require(e);return t&&(t.length||Object.keys(t).length)?t:null}catch(e){return null}}}}),
y=r({"node_modules/protobufjs/src/util/minimal.js"(e){var t=e;t.inquire=l();t.isNode=true}}),
k=r({"node_modules/protobufjs/src/roots.js"(e,t){t.exports=Object.create(null)}}),
v=r({"node_modules/protobufjs/src/index-minimal.js"(e){var t=e;t.build="minimal",t.util=y(),t.roots=k()}}),
_=r({"node_modules/protobufjs/minimal.js"(e,t){t.exports=v()}})(),M=_.util;
module.exports = {};
var seen = 0; Object.keys(M).forEach(function (k) { if (typeof M[k] === "function") seen++; });
console.log(seen);
