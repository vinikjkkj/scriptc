process.on('unhandledRejection', (r: any) => console.log('UR', r.message));
process.on('rejectionHandled', (p: any) => console.log('RH listener'));
const p: Promise<number> = Promise.reject(new Error('R'));
setTimeout(() => { p.catch((e: any) => console.log('late catch', e.message)); console.log('timer body end'); }, 5);
setTimeout(() => console.log('later timer'), 20);
console.log('main end');
