try { throw new Error("boom"); } catch (e) { console.log("name", e.name); console.log("ctorname", e.constructor.name); }
