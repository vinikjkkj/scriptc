const xs: unknown[] = [];
for (let i = 0; i < 2; i++) xs.push(JSON.parse(`{"n":${i}}`) as unknown);
console.log(xs.length, JSON.stringify(xs));
