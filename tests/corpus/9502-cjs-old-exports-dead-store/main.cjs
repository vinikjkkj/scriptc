let n = 0;
const count = () => ++n;
console.log(require('./node.cjs').value, count());
