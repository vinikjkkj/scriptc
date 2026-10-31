try { JSON.parse("null").x; } catch (e) { console.log("eq", e.constructor === TypeError); console.log("inst", e instanceof TypeError); }
