console.log(['x', 1, true].map(JSON.stringify).join('|'));
const g = JSON.stringify;
console.log(g({ b: [true, null] }), typeof g);
