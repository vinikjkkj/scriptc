// An AMBIENT enum whose declaration file HAS a runtime .js twin in the
// program. The enum object is never emitted — an ambient enum has no body to
// lower — so a member read can only be served by folding it to the constant
// the declaration gives, and that fold is allowed exactly because the twin
// makes the value real at run time (this is protobufjs's shape, and zapo's
// spec/proto is the program that made it matter).
//
// The twin-less spelling of the same construct is 1832-enum-modules, which
// pins the OTHER stance: a ReferenceError, matching Node.
import { pb } from "./pb.js";

// Forward member reads: numeric and string enums, folded to constants.
console.log(`UNKNOWN=${pb.Msg.Kind.UNKNOWN}`);
console.log(`TEXT=${pb.Msg.Kind.TEXT}`);
console.log(`AUDIO=${pb.Msg.Kind.AUDIO}`);
console.log(`PLAIN=${pb.Msg.Flavor.PLAIN}`);
console.log(`RICH=${pb.Msg.Flavor.RICH}`);

// A member read in a value position that survives into an array — the shape
// zapo's WA_BOT_DEFAULT_CAPABILITIES has (a module-level const initialized
// from ambient enum members).
const DEFAULTS: readonly pb.Msg.Kind[] = [pb.Msg.Kind.TEXT, pb.Msg.Kind.IMAGE, pb.Msg.Kind.AUDIO];
console.log(`defaults=${DEFAULTS.join(",")}`);
console.log(`sum=${DEFAULTS[0] + DEFAULTS[1] + DEFAULTS[2]}`);

// The folded constant compares equal to the twin's own runtime value, which
// is the property that makes the fold sound.
console.log(`agrees=${pb.Msg.Kind.IMAGE === 2 ? "yes" : "no"}`);

// A member read under a function, so the fold is not just a top-level one.
function nameOf(k: pb.Msg.Kind): string {
  if (k === pb.Msg.Kind.TEXT) return "text";
  if (k === pb.Msg.Kind.IMAGE) return "image";
  return "other";
}
console.log(`nameOf(1)=${nameOf(pb.Msg.Kind.TEXT)}`);
console.log(`nameOf(2)=${nameOf(pb.Msg.Kind.IMAGE)}`);
console.log(`nameOf(3)=${nameOf(pb.Msg.Kind.AUDIO)}`);
