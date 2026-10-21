// Assigning a member of the stdlib `process` has no static lowering: a
// compile error (it used to compile and throw when the statement ran).
async function main() {
  throw new Error('x');
}
main().then(
  () => console.log('done'),
  () => {
    process.exitCode = 1;
  },
);
