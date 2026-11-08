// The record tryCatcher answers is the shared `errorObj` (declared `{ e: {} }`), and its declaration says `void | { e: Error }`:
// the caught Error must survive in the slot, `ret === errorObj` is identity, and a write through either name is the other's read.
import { probe } from "sacb/built/probe.js";
probe((line: string) => console.log(line));
