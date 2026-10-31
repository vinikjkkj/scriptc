function f(x) { return x.y; }
try { f(JSON.parse("null")); } catch (e) { console.log("ctorname", e.constructor.name, e instanceof TypeError); }
