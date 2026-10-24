const order = [];
setImmediate((a, b) => order.push('imm ' + a + b), 'x', 'y');
setTimeout(() => console.log(order.join('|')), 5);
