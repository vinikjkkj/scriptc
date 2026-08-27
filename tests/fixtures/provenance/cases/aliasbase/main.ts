/* The driver names one package. Everything under test is INSIDE that
 * package's attested source: it imports `@core`, an alias whose table
 * lives one directory above it and whose "baseUrl" is spelled relative to
 * THAT file, not to the package. */
import { spin } from "aliaspkg";

console.log(spin("hi"));
