process.on('unhandledRejection', (r: any) => console.log('UR', r.message));
process.on('rejectionHandled', (p: any) => console.log('RH'));
const a: Promise<number> = Promise.reject(new Error('A'));
const b: Promise<number> = Promise.reject(new Error('B'));
setTimeout(() => { a.catch((e: any) => console.log('catch A')); console.log('t1'); }, 5);
setTimeout(() => { b.catch((e: any) => console.log('catch B')); console.log('t2'); }, 10);
setTimeout(() => console.log('later'), 30);
console.log('main end');
