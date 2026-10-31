process.on('unhandledRejection', (r: any) => console.log('UR', r.message));
process.on('rejectionHandled', (p: any) => console.log('RH'));
async function waiter(p: Promise<number>): Promise<void> {
  try { await p; } catch (e: any) { console.log('await caught', e.message); }
}
const p: Promise<number> = Promise.reject(new Error('W'));
setTimeout(() => { waiter(p); console.log('t'); }, 5);
setTimeout(() => console.log('later'), 20);
