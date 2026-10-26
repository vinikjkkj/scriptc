// An untyped value that crossed a module boundary: shapes.ts returns unknown, the
// importer tests it against the imported program classes, subclass included.
import { Shape, Square, Blob, build } from "./shapes.ts";

for (const kind of ["square", "shape", "blob", "other"]) {
  const v = build(kind);
  console.log(kind, v instanceof Shape, v instanceof Square, v instanceof Blob);
}
