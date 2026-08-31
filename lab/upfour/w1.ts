const xs: unknown[] = Array.from({ length: 2 }, (_v, i) => JSON.parse(`{"n":${i}}`) as unknown);
console.log(xs.length);
