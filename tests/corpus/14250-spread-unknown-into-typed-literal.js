// A spread of a checked-dynamic iterable into an array literal whose other
// elements are typed string. The literal's static element type is string, but
// the spread source has no static home: it iterates by its run-time kind
// (array, string code points), keeps the raw values (join stringifies
// null/undefined to ""), and the typed result joins exactly like Node.
const arr = JSON.parse('["x", null, 3, true, [1]]');
const typeName = "BIGINT";
console.log([typeName, ...arr].join(" "));
console.log([typeName, ...arr].length);

const emptyArr = JSON.parse("[]");
console.log(["only", ...emptyArr].join("|"));

const str = JSON.parse('"ab\\ud83d\\ude00"');
console.log(["p", ...str].join(","));

const nums = JSON.parse("[10, 20]");
console.log(["a", ...nums, "z"].join("-"));

// The typed literal whose spread source is an evolving string array in the
// source (typed string[] by the checker, dyn in the lowering).
const flags = [];
flags.push("PRIMARY KEY");
flags.push("NOT NULL");
console.log(`\`c\` ${["INT", ...flags].join(" ")}`);
