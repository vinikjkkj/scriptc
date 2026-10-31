try { throw new TypeError("tboom"); } catch (e) { console.log("name", e.name); console.log("ctorname", e.constructor.name); }
