'use strict'
// dyn receiver: pg-shaped lazy getter that converts itself into a data property
const src: any = JSON.parse('{"a":1,"b":"two"}');
let calls = 0;
Object.defineProperty(src, 'native', {
  configurable: true,
  enumerable: false,
  get() {
    calls++;
    const v = { hello: 'world' } as any;
    Object.defineProperty(src, 'native', { value: v });
    return v;
  },
});
console.log('keys', Object.keys(src).join(','), 'calls', calls);
console.log(JSON.stringify(src));
console.log(src);
console.log('in', 'native' in src, 'calls', calls);
console.log('first', src.native.hello, 'calls', calls);
console.log('second', src.native.hello, 'calls', calls);
try {
  src.native = 5;
  console.log('assigned', src.native.hello);
} catch (e) {
  console.log('assign threw', (e as Error).message);
}
