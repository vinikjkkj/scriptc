// An Error subclass that declares `code` keeps it in the instance's own field; a catch binding cast to
// NodeJS.ErrnoException reads that field (pg-protocol's DatabaseError, thrown by a rejected query).
class DbErr extends Error {
  code: string | undefined;
  severity: string | undefined;
  constructor(message: string) { super(message); this.name = "error"; }
}
function mk(): any { const e = new DbErr("dup"); e.code = "23505"; e.severity = "ERROR"; return e; }
async function main() {
  try { throw mk(); } catch (e) {
    const err = e as NodeJS.ErrnoException;
    console.log("error", err.code, err.message, (err as any).severity, err instanceof Error);
  }
  try { throw new Error("plain"); } catch (e) {
    console.log((e as NodeJS.ErrnoException).code);
  }
}
main();
