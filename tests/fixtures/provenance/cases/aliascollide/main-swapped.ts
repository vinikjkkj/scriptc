/* main.ts with the two imports SWAPPED, and nothing else changed.
 *
 * The import order is what decides which attested checkout the pipeline maps
 * FIRST, which is what decided the shared "paths" table's answer. A program
 * that prints different values depending on the order two of its imports are
 * written in is not a program the compiler may accept; this file is the other
 * arm of the differential that proves it no longer does.
 *
 * Both files must print the same two lines, and both must match Node. */
import { twirl } from "aliaspkg2";
import { spin } from "aliaspkg";

console.log(spin("hi"));
console.log(twirl("Yo"));
