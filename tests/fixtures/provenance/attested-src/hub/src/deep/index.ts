/* 'hub/deep' is the FOURTH level: reached from spoke/extra, which is
 * itself reached from hub/util, which is reached from spoke's root. One
 * pass over the located packages maps hub/util and spoke/extra; only a
 * second pass reaches here. It is the difference between "revisit once"
 * and "iterate to a fixed point". */
export const DEEP = "deep4";
