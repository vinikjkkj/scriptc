/* The order file's tiers (packages/compiler/src/backend/layout-profile.ts layoutOrderText).
 *
 *   two epochs   -- the long-standing rule: last epoch highest first, first-reached order inside a tier;
 *   three epochs -- steady (epochs between the first and the last) first, then the END tier (the last epoch only: shutdown, the final requests), then
 *                   startup-only; a steady function that also runs at shutdown stays in the steady tier (the positive control: the old
 *                   "last epoch first" rule would put it ahead of the steady-only ones and merge it with the shutdown-only functions). */
import { describe, expect, test } from "vitest";
import { layoutOrderText } from "../../packages/compiler/src/backend/layout-profile.js";
import { parseLayoutOrder } from "../../packages/compiler/src/backend/layout-order.js";

const names = (text: string): string[] => text.split("\n").filter((l) => l !== "" && !l.startsWith("#"));
const tiers = (text: string): string[] => text.split("\n").filter((l) => l.startsWith("# tier:"));

describe("layoutOrderText", () => {
  test("two epochs keep the last-epoch rule", () => {
    const t = layoutOrderText(
      [
        { epoch: 0, name: "boot" },
        { epoch: 0, name: "both" },
        { epoch: 1, name: "steady" },
        { epoch: 1, name: "both" },
      ],
      2,
    );
    expect(names(t)).toEqual(["steady", "both", "boot"]);
    expect(tiers(t)).toEqual(["# tier: last executed in epoch 1", "# tier: last executed in epoch 0"]);
  });

  test("three epochs: steady, then the end tier, then startup-only", () => {
    const t = layoutOrderText(
      [
        { epoch: 0, name: "boot" },
        { epoch: 0, name: "stays" },
        { epoch: 1, name: "steadyA" },
        { epoch: 1, name: "stays" },
        { epoch: 1, name: "steadyB" },
        { epoch: 2, name: "shutdownOnly" },
        { epoch: 2, name: "steadyA" }, // a steady function that runs again at shutdown is still steady
        { epoch: 2, name: "bootAgain" },
        { epoch: 0, name: "bootAgain" },
      ],
      3,
    );
    expect(tiers(t)).toEqual(["# tier: steady", "# tier: end", "# tier: startup-only"]);
    expect(names(t)).toEqual(["steadyA", "stays", "steadyB", "shutdownOnly", "bootAgain", "boot"]);
  });

  test("four epochs: every middle epoch is steady", () => {
    const t = layoutOrderText(
      [
        { epoch: 1, name: "a" },
        { epoch: 2, name: "b" },
        { epoch: 3, name: "end" },
        { epoch: 0, name: "boot" },
      ],
      4,
    );
    expect(names(t)).toEqual(["a", "b", "end", "boot"]);
  });

  test("the consumer reads the tiered file back (comments are ignored)", () => {
    const t = layoutOrderText([{ epoch: 1, name: "sc_f_a" }, { epoch: 2, name: "sc_f_b" }, { epoch: 0, name: "sc_f_c" }], 3);
    const { rank } = parseLayoutOrder(t);
    expect([...rank.keys()]).toEqual(["sc_f_a", "sc_f_b", "sc_f_c"]);
  });
});
