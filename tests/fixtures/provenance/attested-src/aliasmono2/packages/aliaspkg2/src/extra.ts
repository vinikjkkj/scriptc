/* The real `aliaspkg2/extra`: a SUBPATH of a package the driver has
 * installed, published from aliaspkg2's own repo. Node resolves
 * `aliaspkg2/extra` here, from anywhere, because that is what an installed
 * package's subpath export means. */
export function extra(s: string): string {
  return "REAL/" + s.toUpperCase();
}
