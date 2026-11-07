const dep = require("./dep.cjs");
console.log(dep.seed, dep.count, dep.same0, dep.same1, dep.before, dep.after);
console.log(dep.bump(), dep.bump(), dep.tick(), dep.count);
console.log(dep.env.before, dep.env.after, dep.env.seed, dep === dep.env);
dep.extra = "written by the requirer";
console.log(require("./dep.cjs").extra, require("./dep.cjs") === dep, Object.keys(dep).join(","));
const inline = require("./make.cjs")(1, null);
console.log(inline.seed, inline.env, typeof inline.bump);
