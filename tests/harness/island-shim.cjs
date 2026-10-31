/* The Node-side island oracle. __island_eval(code) in the native binary
 * evaluates `code` in the embedded engine's global scope and returns
 * String(result); plain-JS semantics for the same operation are an indirect
 * (global-scope) eval plus String(). Defining it globally keeps Node the
 * differential oracle for island corpus programs — VALUE results only:
 * engine error-message text is never compared (the scriptc-only island
 * tests own that). Loaded via `--require` for every corpus run; inert for
 * programs that never mention the island. */
globalThis.__island_eval = (code) => String((0, eval)(code));
