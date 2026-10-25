// `new Array(n).fill(v)` takes its element type from the annotated
// declaration, for reference elements (string and record). The fill writes
// every slot, so no hole is ever read; the length reads and element reads
// are the whole observable surface.
interface Pt { x: number; y: number }

const words: string[] = new Array(3).fill("ab");
words[1] = "cd";
console.log(words.length, words[0], words[1], words[2]);

const origin: Pt = { x: 0, y: 0 };
const pts: Pt[] = new Array(2).fill(origin);
pts[1] = { x: 5, y: 6 };
console.log(pts.length, pts[0].x, pts[1].y);

function fresh(n: number): string[] {
  const out: string[] = new Array(n).fill("-");
  out[0] = "head";
  return out;
}
console.log(fresh(2), fresh(0).length);
