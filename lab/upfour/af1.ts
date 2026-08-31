const xs = Array.from({ length: 2 }, (_v, i) => new URL(`https://example.invalid/${i}`));
console.log(xs.length, xs[0].pathname);
