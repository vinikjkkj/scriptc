// Two esbuild wrapper modules that require each other (the wrapper hands the
// half-built exports object back to a re-entrant call), plus an inquire module
// that is stored and never invoked. The proof must still pin inquire down.
"use strict";var e,t,n,o=Object.getOwnPropertyNames,r=(e,t)=>function(){return t||(0,e[o(e)[0]])((t={exports:{}}).exports,t),t.exports},
iq=r({"inquire.js"(e,t){t.exports=function(e){try{var t=require(e);return t&&Object.keys(t).length?t:null}catch(e){return null}}}}),
a=r({"a.js"(e,t){var u=e;u.name="a";u.inquire=iq();u.peer=function(){return b().name}}}),
b=r({"b.js"(e,t){var u=e;u.name="b";u.other=function(){return a().name}}}),
main=r({"main.js"(e,t){t.exports={a:a(),b:b()}}});
var out=main();
console.log(out.a.name, out.b.name, out.a.peer(), out.b.other());
