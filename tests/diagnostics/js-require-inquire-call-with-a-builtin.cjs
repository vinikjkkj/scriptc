// REFUSED AT COMPILE TIME. protobufjs inquire() called with a specifier Node
// RESOLVES ('buffer', a builtin): the answer is the module as a value, which a
// compiled program does not have, so the build refuses even though the other
// specifier ('long', absent) would be Node's catchable MODULE_NOT_FOUND. One
// resolvable specifier in the closed set keeps the whole require refused (no
// partial lowering, no best effort).
"use strict";var e,t,n,o=Object.getOwnPropertyNames,r=(e,t)=>function(){return t||(0,e[o(e)[0]])((t={exports:{}}).exports,t),t.exports},
l=r({"node_modules/protobufjs/src/util/inquire.js"(e,t){t.exports=function(e){try{if("function"!=typeof require)return null;var t=require(e);return t&&(t.length||Object.keys(t).length)?t:null}catch(e){return null}}}}),
y=r({"node_modules/protobufjs/src/util/minimal.js"(e){var t=e;t.inquire=l();t.isNode=true}}),
k=r({"node_modules/protobufjs/src/roots.js"(e,t){t.exports=Object.create(null)}}),
v=r({"node_modules/protobufjs/src/index-minimal.js"(e){var t=e;t.build="minimal",t.util=y(),t.roots=k()}}),
_=r({"node_modules/protobufjs/minimal.js"(e,t){t.exports=v()}})(),M=_.util;
module.exports = {};
var U = M; var a = U.inquire("long"); var b = U.inquire("buffer");
console.log(a === null, typeof b);
