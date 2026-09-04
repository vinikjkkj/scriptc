// A two-module ESM cycle where a member builds a singleton at class-
// declaration time. mongodb's cmap/wire_protocol/responses.ts:112,
// reduced:
//
//     export class MongoDBResponse extends OnDemandDocument {
//       static empty = new MongoDBResponse(new Uint8Array([13, 0, …]))
//     }
//
// Surveying what that construction RUNS is hopeless: the base
// constructor calls bson's element parser, a while loop over a byte
// buffer that no whitelist of inert expressions will ever admit -- and
// the base here is deliberately written the same way, with a loop, a
// throw and a push.
//
// What the construction can NAME is the answerable question. The cluster
// is a strongly connected component, and `doc.ts` is import-reachable
// from it; if doc.ts could reach any cluster member the two would be
// mutually reachable and doc.ts would BE one. So nothing in doc.ts can
// name a cluster binding, whatever it computes. The subclass itself
// declares no constructor and no instance field, so it contributes no
// code of its own to the construction at all.
import { run } from "./a.ts";

run();
