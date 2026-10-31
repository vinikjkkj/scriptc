const fs = require("fs");
try { fs.readFileSync("/nonexistent-errctor-19305-xyz"); } catch (e) { console.log("code", e.code); console.log("ctorname", e.constructor.name); }
