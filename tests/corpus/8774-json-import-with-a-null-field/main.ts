import bad from "./nulled.json" with { type: "json" };

console.log(bad.name);
console.log(bad);
console.log(bad.deprecated === null, Object.keys(bad), JSON.stringify(bad));
