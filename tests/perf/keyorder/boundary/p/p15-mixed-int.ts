interface T { z: string; "2": string; "10": string }
const t: T = { z: "Z", "10": "ten", "2": "two" }
console.log("keys=" + Object.keys(t).join(","))
