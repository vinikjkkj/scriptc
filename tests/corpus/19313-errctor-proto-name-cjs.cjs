try { JSON.parse("null").x; } catch (e) { console.log("protoname", e.constructor.prototype.name); console.log("ctorstr", String(e.constructor.prototype.name)); }
