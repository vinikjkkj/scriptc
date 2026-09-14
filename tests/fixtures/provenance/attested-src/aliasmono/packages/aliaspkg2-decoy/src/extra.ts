/* The decoy `aliaspkg2/extra`, and the half of the shadowing question the
 * `aliaspkg2` decoy beside it does not reach.
 *
 * `aliaspkg2` (the bare package) is spelled by the DRIVER, so the pipeline
 * maps it as a package ENTRY and the entry beats the alias. This subpath is
 * spelled ONLY inside aliasmono's own source, so it never becomes an entry:
 * the prescan resolved it through aliasmono's alias table, walked into this
 * file, and never recorded `aliaspkg2/extra` as a bare import at all. The
 * package it names was therefore never looked up, never attested, never
 * mapped, and nothing anywhere said so.
 *
 * Same name, same signature, different answer — a binary that exits 0 and
 * prints the wrong string. */
export function extra(s: string): string {
  return "DECOY/" + s.toUpperCase();
}
