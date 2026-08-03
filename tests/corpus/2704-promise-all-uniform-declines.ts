// A UNIFORM Promise.all -- the shape the heterogeneous path must DECLINE so
// the array path can own it.
//
// Worth a case of its own because the decline path had no coverage: the
// heterogeneous corpus case only exercises success, and the helper that
// reports a decline was returning through itself, so the first real
// decline blew the compiler's stack instead of reaching the fence.

// Forma que o Promise.all heterogeneo tem que RECUSAR sem derrubar o
// compilador: entradas uniformes (o caminho de array e' que trata).
async function a(): Promise<number> { return 1; }
async function b(): Promise<number> { return 2; }
async function main(): Promise<void> {
  const [x, y] = await Promise.all([a(), b()]);
  console.log(x + y);
}
void main();
