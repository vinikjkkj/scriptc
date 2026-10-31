process.on('unhandledRejection', (r: any) => console.log('UR', r.message));
process.on('rejectionHandled', (p: any) => console.log('RH'));
const a: Promise<number> = Promise.reject(new Error('A'));
setTimeout(() => {
  a.catch((e: any) => console.log('catch A'));
  const d: Promise<number> = Promise.reject(new Error('D'));
  console.log('t body');
}, 5);
setTimeout(() => console.log('later'), 20);
