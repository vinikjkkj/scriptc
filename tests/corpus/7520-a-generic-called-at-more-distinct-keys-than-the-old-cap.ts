// One generic method called at MORE DISTINCT KEYS than the instantiation
// cap used to allow. Every call below is a separate monomorphization: the
// key parameter binds a different string literal and the payload parameter
// a different record shape, so the instance key differs at every site and
// 110 instances are minted. The cap that stood here was a POPULATION count
// of 100 per generic function, so sites 101..110 were refused with
// `unbounded generic instantiation (... exceeded 100 instances --
// polymorphic recursion?)` and this program did not compile at all.
//
// It is not polymorphic recursion. Every one of these instances is at
// chain depth 1 -- requested from a call site the program spells, never
// from inside the body of another instance -- and the set is finite and
// closed the moment the file ends. The divergence test now bounds the
// CHAIN (MAX_GENERIC_INSTANCE_DEPTH), which is the thing that can grow
// without bound; breadth like this one is what a monomorphizing compiler
// exists to do.
//
// WHERE THIS SHAPE COMES FROM. @zapo-js/wam declares
// `commit<K extends WaWamEventName>(name: K, payload: WaWamEventArgs<K>)`
// and calls it at 142 sites naming 134 distinct WhatsApp telemetry events,
// each with its own payload record. The package reached a binary and was
// refused at the 101st event for a defect it does not have.
//
// PINNED IN TIER_REGRESSIONS (tests/harness/llvm-differential.test.ts): a
// revert of the cap change does not FAIL this program, it stops compiling
// it, and a refused program is scored as a skip. The pin is what makes the
// LLVM lane say so.

interface Events {
  E0: { n0: number; s0: string };
  E1: { n1: number; s1: string };
  E2: { n2: number; s2: string };
  E3: { n3: number; s3: string };
  E4: { n4: number; s4: string };
  E5: { n5: number; s5: string };
  E6: { n6: number; s6: string };
  E7: { n7: number; s7: string };
  E8: { n8: number; s8: string };
  E9: { n9: number; s9: string };
  E10: { n10: number; s10: string };
  E11: { n11: number; s11: string };
  E12: { n12: number; s12: string };
  E13: { n13: number; s13: string };
  E14: { n14: number; s14: string };
  E15: { n15: number; s15: string };
  E16: { n16: number; s16: string };
  E17: { n17: number; s17: string };
  E18: { n18: number; s18: string };
  E19: { n19: number; s19: string };
  E20: { n20: number; s20: string };
  E21: { n21: number; s21: string };
  E22: { n22: number; s22: string };
  E23: { n23: number; s23: string };
  E24: { n24: number; s24: string };
  E25: { n25: number; s25: string };
  E26: { n26: number; s26: string };
  E27: { n27: number; s27: string };
  E28: { n28: number; s28: string };
  E29: { n29: number; s29: string };
  E30: { n30: number; s30: string };
  E31: { n31: number; s31: string };
  E32: { n32: number; s32: string };
  E33: { n33: number; s33: string };
  E34: { n34: number; s34: string };
  E35: { n35: number; s35: string };
  E36: { n36: number; s36: string };
  E37: { n37: number; s37: string };
  E38: { n38: number; s38: string };
  E39: { n39: number; s39: string };
  E40: { n40: number; s40: string };
  E41: { n41: number; s41: string };
  E42: { n42: number; s42: string };
  E43: { n43: number; s43: string };
  E44: { n44: number; s44: string };
  E45: { n45: number; s45: string };
  E46: { n46: number; s46: string };
  E47: { n47: number; s47: string };
  E48: { n48: number; s48: string };
  E49: { n49: number; s49: string };
  E50: { n50: number; s50: string };
  E51: { n51: number; s51: string };
  E52: { n52: number; s52: string };
  E53: { n53: number; s53: string };
  E54: { n54: number; s54: string };
  E55: { n55: number; s55: string };
  E56: { n56: number; s56: string };
  E57: { n57: number; s57: string };
  E58: { n58: number; s58: string };
  E59: { n59: number; s59: string };
  E60: { n60: number; s60: string };
  E61: { n61: number; s61: string };
  E62: { n62: number; s62: string };
  E63: { n63: number; s63: string };
  E64: { n64: number; s64: string };
  E65: { n65: number; s65: string };
  E66: { n66: number; s66: string };
  E67: { n67: number; s67: string };
  E68: { n68: number; s68: string };
  E69: { n69: number; s69: string };
  E70: { n70: number; s70: string };
  E71: { n71: number; s71: string };
  E72: { n72: number; s72: string };
  E73: { n73: number; s73: string };
  E74: { n74: number; s74: string };
  E75: { n75: number; s75: string };
  E76: { n76: number; s76: string };
  E77: { n77: number; s77: string };
  E78: { n78: number; s78: string };
  E79: { n79: number; s79: string };
  E80: { n80: number; s80: string };
  E81: { n81: number; s81: string };
  E82: { n82: number; s82: string };
  E83: { n83: number; s83: string };
  E84: { n84: number; s84: string };
  E85: { n85: number; s85: string };
  E86: { n86: number; s86: string };
  E87: { n87: number; s87: string };
  E88: { n88: number; s88: string };
  E89: { n89: number; s89: string };
  E90: { n90: number; s90: string };
  E91: { n91: number; s91: string };
  E92: { n92: number; s92: string };
  E93: { n93: number; s93: string };
  E94: { n94: number; s94: string };
  E95: { n95: number; s95: string };
  E96: { n96: number; s96: string };
  E97: { n97: number; s97: string };
  E98: { n98: number; s98: string };
  E99: { n99: number; s99: string };
  E100: { n100: number; s100: string };
  E101: { n101: number; s101: string };
  E102: { n102: number; s102: string };
  E103: { n103: number; s103: string };
  E104: { n104: number; s104: string };
  E105: { n105: number; s105: string };
  E106: { n106: number; s106: string };
  E107: { n107: number; s107: string };
  E108: { n108: number; s108: string };
  E109: { n109: number; s109: string };
}

const seen: string[] = [];

class Sink {
  // The generic the breadth lands on. `K` binds one string literal per
  // call and `Events[K]` the record that literal names, so no two sites
  // share an instance key.
  commit<K extends keyof Events>(name: K, payload: Events[K]): void {
    seen.push(`${String(name)}=${JSON.stringify(payload)}`);
  }
}

const sink = new Sink();
sink.commit("E0", { n0: 0, s0: "v0" });
sink.commit("E1", { n1: 1, s1: "v1" });
sink.commit("E2", { n2: 2, s2: "v2" });
sink.commit("E3", { n3: 3, s3: "v3" });
sink.commit("E4", { n4: 4, s4: "v4" });
sink.commit("E5", { n5: 5, s5: "v5" });
sink.commit("E6", { n6: 6, s6: "v6" });
sink.commit("E7", { n7: 7, s7: "v7" });
sink.commit("E8", { n8: 8, s8: "v8" });
sink.commit("E9", { n9: 9, s9: "v9" });
sink.commit("E10", { n10: 10, s10: "v10" });
sink.commit("E11", { n11: 11, s11: "v11" });
sink.commit("E12", { n12: 12, s12: "v12" });
sink.commit("E13", { n13: 13, s13: "v13" });
sink.commit("E14", { n14: 14, s14: "v14" });
sink.commit("E15", { n15: 15, s15: "v15" });
sink.commit("E16", { n16: 16, s16: "v16" });
sink.commit("E17", { n17: 17, s17: "v17" });
sink.commit("E18", { n18: 18, s18: "v18" });
sink.commit("E19", { n19: 19, s19: "v19" });
sink.commit("E20", { n20: 20, s20: "v20" });
sink.commit("E21", { n21: 21, s21: "v21" });
sink.commit("E22", { n22: 22, s22: "v22" });
sink.commit("E23", { n23: 23, s23: "v23" });
sink.commit("E24", { n24: 24, s24: "v24" });
sink.commit("E25", { n25: 25, s25: "v25" });
sink.commit("E26", { n26: 26, s26: "v26" });
sink.commit("E27", { n27: 27, s27: "v27" });
sink.commit("E28", { n28: 28, s28: "v28" });
sink.commit("E29", { n29: 29, s29: "v29" });
sink.commit("E30", { n30: 30, s30: "v30" });
sink.commit("E31", { n31: 31, s31: "v31" });
sink.commit("E32", { n32: 32, s32: "v32" });
sink.commit("E33", { n33: 33, s33: "v33" });
sink.commit("E34", { n34: 34, s34: "v34" });
sink.commit("E35", { n35: 35, s35: "v35" });
sink.commit("E36", { n36: 36, s36: "v36" });
sink.commit("E37", { n37: 37, s37: "v37" });
sink.commit("E38", { n38: 38, s38: "v38" });
sink.commit("E39", { n39: 39, s39: "v39" });
sink.commit("E40", { n40: 40, s40: "v40" });
sink.commit("E41", { n41: 41, s41: "v41" });
sink.commit("E42", { n42: 42, s42: "v42" });
sink.commit("E43", { n43: 43, s43: "v43" });
sink.commit("E44", { n44: 44, s44: "v44" });
sink.commit("E45", { n45: 45, s45: "v45" });
sink.commit("E46", { n46: 46, s46: "v46" });
sink.commit("E47", { n47: 47, s47: "v47" });
sink.commit("E48", { n48: 48, s48: "v48" });
sink.commit("E49", { n49: 49, s49: "v49" });
sink.commit("E50", { n50: 50, s50: "v50" });
sink.commit("E51", { n51: 51, s51: "v51" });
sink.commit("E52", { n52: 52, s52: "v52" });
sink.commit("E53", { n53: 53, s53: "v53" });
sink.commit("E54", { n54: 54, s54: "v54" });
sink.commit("E55", { n55: 55, s55: "v55" });
sink.commit("E56", { n56: 56, s56: "v56" });
sink.commit("E57", { n57: 57, s57: "v57" });
sink.commit("E58", { n58: 58, s58: "v58" });
sink.commit("E59", { n59: 59, s59: "v59" });
sink.commit("E60", { n60: 60, s60: "v60" });
sink.commit("E61", { n61: 61, s61: "v61" });
sink.commit("E62", { n62: 62, s62: "v62" });
sink.commit("E63", { n63: 63, s63: "v63" });
sink.commit("E64", { n64: 64, s64: "v64" });
sink.commit("E65", { n65: 65, s65: "v65" });
sink.commit("E66", { n66: 66, s66: "v66" });
sink.commit("E67", { n67: 67, s67: "v67" });
sink.commit("E68", { n68: 68, s68: "v68" });
sink.commit("E69", { n69: 69, s69: "v69" });
sink.commit("E70", { n70: 70, s70: "v70" });
sink.commit("E71", { n71: 71, s71: "v71" });
sink.commit("E72", { n72: 72, s72: "v72" });
sink.commit("E73", { n73: 73, s73: "v73" });
sink.commit("E74", { n74: 74, s74: "v74" });
sink.commit("E75", { n75: 75, s75: "v75" });
sink.commit("E76", { n76: 76, s76: "v76" });
sink.commit("E77", { n77: 77, s77: "v77" });
sink.commit("E78", { n78: 78, s78: "v78" });
sink.commit("E79", { n79: 79, s79: "v79" });
sink.commit("E80", { n80: 80, s80: "v80" });
sink.commit("E81", { n81: 81, s81: "v81" });
sink.commit("E82", { n82: 82, s82: "v82" });
sink.commit("E83", { n83: 83, s83: "v83" });
sink.commit("E84", { n84: 84, s84: "v84" });
sink.commit("E85", { n85: 85, s85: "v85" });
sink.commit("E86", { n86: 86, s86: "v86" });
sink.commit("E87", { n87: 87, s87: "v87" });
sink.commit("E88", { n88: 88, s88: "v88" });
sink.commit("E89", { n89: 89, s89: "v89" });
sink.commit("E90", { n90: 90, s90: "v90" });
sink.commit("E91", { n91: 91, s91: "v91" });
sink.commit("E92", { n92: 92, s92: "v92" });
sink.commit("E93", { n93: 93, s93: "v93" });
sink.commit("E94", { n94: 94, s94: "v94" });
sink.commit("E95", { n95: 95, s95: "v95" });
sink.commit("E96", { n96: 96, s96: "v96" });
sink.commit("E97", { n97: 97, s97: "v97" });
sink.commit("E98", { n98: 98, s98: "v98" });
sink.commit("E99", { n99: 99, s99: "v99" });
sink.commit("E100", { n100: 100, s100: "v100" });
sink.commit("E101", { n101: 101, s101: "v101" });
sink.commit("E102", { n102: 102, s102: "v102" });
sink.commit("E103", { n103: 103, s103: "v103" });
sink.commit("E104", { n104: 104, s104: "v104" });
sink.commit("E105", { n105: 105, s105: "v105" });
sink.commit("E106", { n106: 106, s106: "v106" });
sink.commit("E107", { n107: 107, s107: "v107" });
sink.commit("E108", { n108: 108, s108: "v108" });
sink.commit("E109", { n109: 109, s109: "v109" });

console.log(`instances=${String(seen.length)}`);
console.log(seen[0] ?? "<none>");
console.log(seen[99] ?? "<none>");
console.log(seen[109] ?? "<none>");
// The 100th and 110th are the two the old cap refused: printing them is
// what makes a silent re-cap fail here instead of going quiet.
let total = 0;
for (const s of seen) total += s.length;
console.log(`chars=${String(total)}`);
