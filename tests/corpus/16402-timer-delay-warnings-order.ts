process.on('warning', (w) => console.log('LISTENER', w.name));
console.log('before');
setTimeout(() => console.log('cb'), -1);
function later(ms: number) {
  setTimeout(() => console.log('later cb'), ms);
}
later(2147483648);
console.log('after');
