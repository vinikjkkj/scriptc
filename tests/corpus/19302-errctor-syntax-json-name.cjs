try { JSON.parse("{bad"); } catch (e) { console.log("name", e.name); console.log("ctorname", e.constructor.name); }
