const xs = [0, 1].map((i) => JSON.parse(`{"n":${i}}`) as unknown);
console.log(xs.length, JSON.stringify(xs));
