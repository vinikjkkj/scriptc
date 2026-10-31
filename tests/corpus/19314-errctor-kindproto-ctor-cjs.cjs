try { JSON.parse("null").x; } catch (e) { console.log("kp", e.constructor.prototype.constructor.name); }
