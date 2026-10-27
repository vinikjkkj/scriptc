const K: "\uFEFF" = "\uFEFF";
const L = K;
console.log(K.length, L.charCodeAt(0), typeof K);
function pick(x: "\uFEFF" | "q"): number { return x.length; }
console.log(pick("\uFEFF"), pick("q"));
