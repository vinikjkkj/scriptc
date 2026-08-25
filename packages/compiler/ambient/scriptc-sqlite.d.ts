/* scriptc's shipped declarations for `better-sqlite3` — the ONE npm
 * package the static lane serves itself.
 *
 * Why this file exists at all. Every other npm package a static build
 * imports meets SC2013: the package's shipped JavaScript has exactly one
 * execution home, the embedded engine. better-sqlite3 has no shipped
 * JavaScript worth running — 653 lines of argument validation over
 * `require('bindings')('better_sqlite3.node')`, with 2,186 lines of C++
 * behind it and an ABI-locked binary that loads on Node 22 and refuses on
 * Node 25. Compiling the package would compile the validation and arrive
 * at a require of machine code. So the compiler serves the surface
 * itself, over a vendored SQLite amalgamation, and these are the types
 * that surface is spelled with.
 *
 * It ships ONLY when the project resolves no better-sqlite3 types of its
 * own — the scriptc-node-fallback.d.ts arrangement, and for its reason:
 * with `@types/better-sqlite3` installed, TypeScript resolves the import
 * to that package and this ambient module would be dead weight at best
 * and a merge conflict at worst. The lowering recognizes EITHER
 * declaration source by provenance (frontend/types.ts).
 *
 * ── the two divergences from @types/better-sqlite3, both deliberate ────
 *
 * 1. `run` / `get` / `all` / `pragma` / `columns` answer `unknown`, where
 *    @types/better-sqlite3 answers a generic row type the caller chooses.
 *    A row's members are a property of the SQL TEXT, not of the program's
 *    types, so a declared row shape would be an unchecked assertion the
 *    compiler cannot stand behind. `unknown` is the same boundary
 *    `JSON.parse` takes here (scriptc-overrides.d.ts), and the same
 *    checked cast gets a typed value back out of it:
 *
 *        const row = stmt.get(id) as { name: string; age: number };
 *
 *    The cast VALIDATES at runtime and throws on mismatch — which is
 *    strictly more than the generic parameter buys under Node, where it
 *    is erased.
 *
 * 2. Members with no lowering are DECLARED here anyway (transaction,
 *    function, aggregate, table, backup, serialize, loadExtension,
 *    unsafeMode, defaultSafeIntegers, iterate, bind). Declaring them is
 *    what makes their refusal read "db.transaction has no lowering"
 *    instead of "property 'transaction' does not exist on type
 *    'Database'" — a diagnostic that would send the reader looking for a
 *    typo in a name that is perfectly real.
 */

declare module "better-sqlite3" {
  /* The options object. `verbose` and `nativeBinding` are declared and
   * refused: verbose wants a JS callback invoked from inside the engine,
   * and nativeBinding names a .node file that a compiled binary has no
   * loader for. */
  export interface Options {
    readonly?: boolean;
    fileMustExist?: boolean;
    timeout?: number;
    verbose?: (message?: unknown, ...additionalArgs: unknown[]) => void;
    nativeBinding?: string;
  }

  export interface Statement {
    /* The three executors. Parameters bind exactly as they do under
     * better-sqlite3: a bare value binds positionally, an ARRAY spreads
     * positionally, and one plain OBJECT supplies every named parameter
     * (`:x`, `@x`, `$x`). All three forms may be mixed in one call, and
     * at most one object may appear. */
    run(...params: unknown[]): unknown;
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown;
    /* The four mode setters answer THIS statement, which is what makes
     * `db.prepare(sql).pluck().get()` one object and not three. */
    pluck(toggle?: boolean): Statement;
    raw(toggle?: boolean): Statement;
    expand(toggle?: boolean): Statement;
    safeIntegers(toggle?: boolean): Statement;
    columns(): unknown;
    readonly reader: boolean;
    readonly readonly: boolean;
    readonly busy: boolean;
    readonly source: string;
    /* Declared, refused by name — see the header. */
    iterate(...params: unknown[]): unknown;
    bind(...params: unknown[]): Statement;
  }

  export interface Database {
    prepare(source: string): Statement;
    exec(source: string): Database;
    close(): Database;
    pragma(source: string, options?: { simple?: boolean }): unknown;
    readonly name: string;
    readonly open: boolean;
    readonly inTransaction: boolean;
    readonly readonly: boolean;
    readonly memory: boolean;
    /* Declared, refused by name — see the header. */
    transaction(fn: (...args: never[]) => unknown): (...args: never[]) => unknown;
    function(name: string, fn: (...args: never[]) => unknown): Database;
    aggregate(name: string, options: object): Database;
    table(name: string, definition: object): Database;
    backup(destination: string, options?: object): Promise<unknown>;
    serialize(options?: object): Uint8Array;
    loadExtension(path: string, entryPoint?: string): Database;
    unsafeMode(enabled?: boolean): Database;
    defaultSafeIntegers(toggle?: boolean): Database;
    explain(source?: string): Statement;
  }

  /* The module's default export: better-sqlite3's `Database` works with
   * and without `new` (its constructor re-enters itself when
   * `new.target` is null), so both signatures are declared. */
  const DatabaseConstructor: {
    new (filename?: string, options?: Options): Database;
    (filename?: string, options?: Options): Database;
  };
  export default DatabaseConstructor;
}
