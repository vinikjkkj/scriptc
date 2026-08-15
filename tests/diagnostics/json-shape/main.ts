/* A JSON document whose shape doesn't bake: a null-valued field has no
 * standalone STATIC type, so the import reports the residual type fence.
 * It said SC2011 — "runs in the embedded dynamic engine" — until the fence
 * learned to prove that claim; --dynamic refuses this import too. */
import bad from "./nulled.json" with { type: "json" };

console.log(bad.name);
