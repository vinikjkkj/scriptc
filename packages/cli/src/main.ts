#!/usr/bin/env node
import { runWithCeiling } from "./heap.js";

if (!runWithCeiling(new URL("./run.js", import.meta.url))) await import("./run.js");
