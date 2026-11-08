// The Error caught by tryCatcher is stored into `errorObj.e` (declared `{ e: {} }`, the placeholder idiom) and read back as
// `ret.e` through the declaration's `{ e: Error }`. The slot used to be an empty record, so the Error was lost and the cast to
// `{ e: Error }` failed at run time.
import { lost } from "sacb/built/lost.js";
lost((line: string) => console.log(line));
