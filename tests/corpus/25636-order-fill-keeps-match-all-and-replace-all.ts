const cold = process.env.COLD === "1";
const s = "k1=v1;k2=v2;k3=v3";
const pairs = [...s.matchAll(/(\w+)=(\w+)/g)].map((m) => m[1] + ">" + m[2]);
console.log(pairs.join(" "), s.replaceAll(";", cold ? ", " : ";"), s.replaceAll(/k(\d)/g, "K$1"));
