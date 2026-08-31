const xs = Array.from({ length: 2 }, (_v, i) => new Map<string, number>([["a", i]]));
console.log(xs.length, xs[0].get("a"), xs[1].get("a"));
