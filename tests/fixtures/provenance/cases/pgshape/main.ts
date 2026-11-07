// pg's shape: a mapped package whose export object holds `Pool`, a class minted by a factory (class BoundPool extends Pool, closing over
// the Client), constructed by a TypeScript caller through the import() namespace member (Node resolves import("pgshape") to its ESM wrapper).
async function main(): Promise<void> {
  const pg = await import("pgshape");
  const a = new pg.Pool({ host: "h1", port: 5432, max: 3 });
  const b = new pg.Pool({ host: "h2" });
  console.log(a.describe(), "|", b.describe());
  console.log(a instanceof pg.Pool, b instanceof pg.Pool, pg.Pool === pg.Pool, pg.Pool.name, typeof pg.Pool);
  console.log(a.ended);
  await a.end();
  console.log(a.ended, b.ended);
}
main().catch((e) => console.log("failed", (e as Error).message));
