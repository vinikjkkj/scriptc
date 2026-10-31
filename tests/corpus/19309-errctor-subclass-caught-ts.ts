class AppErr extends Error {}
function f(): void { throw new AppErr("app"); }
try { f(); } catch (e) {
  const err = e as Error;
  console.log("ctorname", err.constructor.name, err instanceof AppErr);
}
