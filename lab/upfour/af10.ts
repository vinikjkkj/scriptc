const raw: unknown = JSON.parse('{"a":1}');
const xs = Array.from({ length: 2 }, (_v, i) => (i === 0 ? raw : raw));
console.log(xs.length);
