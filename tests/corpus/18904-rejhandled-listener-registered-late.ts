process.on('unhandledRejection', (r: any) => console.log('UR', r.message));
const p: Promise<number> = Promise.reject(new Error('Q'));
setTimeout(() => {
  p.catch((e: any) => console.log('late catch'));
  process.on('rejectionHandled', () => console.log('RH late-registered'));
  console.log('t');
}, 5);
setTimeout(() => console.log('later'), 20);
