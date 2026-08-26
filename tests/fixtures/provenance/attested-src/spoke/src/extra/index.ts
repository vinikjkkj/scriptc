/* 'spoke/extra' is discovered from hub/util's source — a subpath of a
 * package already mapped, found while mapping a subpath of ANOTHER
 * package already mapped. */
import { DEEP } from "hub/deep";

export const EXTRA = "-" + DEEP;
