console.log(typeof process.version, process.version === "v" + process.versions.node);
console.log(process.version.charCodeAt(0), process.version.charCodeAt(1) < 55 && process.version.charCodeAt(2) === 46);
const parts = process.version.slice(1).split(".");
console.log(parts.length, Number(parts[0]) >= 18);
