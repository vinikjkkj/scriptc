console.log([1, 'x', [2], [3, 4]].filter(Array.isArray).length);
const anyArr = [1, [2], 'y'];
console.log(JSON.stringify(anyArr.filter(Array.isArray)));
