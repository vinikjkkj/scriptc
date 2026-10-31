process.on('unhandledRejection', (r: any, p: any) => console.log('UR', r.message));
process.on('rejectionHandled', (p: any) => console.log('RH'));
const p: Promise<number> = Promise.reject(new Error('L'));
setTimeout(() => { p.catch((e: any) => console.log('late catch', e.message)); }, 5);
setTimeout(() => console.log('later timer'), 20);
console.log('main end');
