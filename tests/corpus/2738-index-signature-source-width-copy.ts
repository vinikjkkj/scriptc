// A `Record<string, V>` accumulator filled with RUNTIME keys and then
// returned as a declared all-optional shape -- the parser idiom (zapo's
// parsePrivacySettings): the server names a category, a lookup maps it to a
// setting name, and the setting name is written through a string key.
//
// The width copy cannot COMPLETE the target's fields to undefined here (the
// overflow map may hold that very key), so it READS each one by its literal
// key: present is the value, absent is the undefined arm -- exactly what
// Node's own property read answers. Extra keys drop with the width, the
// stance every width coercion already takes.
interface Settings {
    about?: string;
    callAdd?: string;
    groupAdd?: string;
}

const NAME_MAP: Record<string, string | undefined> = {
    profile: "about",
    calls: "callAdd",
    groups: "groupAdd",
    unmapped: "somethingElse",
};

function parse(rows: readonly (readonly [string, string])[]): Settings {
    const settings: Record<string, string> = {};
    for (let i = 0; i < rows.length; i += 1) {
        const row = rows[i]!;
        const name = NAME_MAP[row[0]];
        if (name) {
            settings[name] = row[1];
        }
    }
    return settings;
}

function show(s: Settings): string {
    return `about=${s.about} callAdd=${s.callAdd} groupAdd=${s.groupAdd}`;
}

// every key present
console.log(show(parse([["profile", "all"], ["calls", "none"], ["groups", "contacts"]])));
// a key MISSING reads as the undefined arm, not as a stale neighbour
console.log(show(parse([["calls", "none"]])));
// nothing at all
console.log(show(parse([])));
// an overflow key with no home in the target drops (the width stance)
console.log(show(parse([["unmapped", "x"], ["profile", "all"]])));

// The same copy one level IN: an index-signature source as a FIELD of a
// wider width coercion.
interface Wrapped {
    readonly id: string;
    readonly settings: Settings;
}
function wrap(id: string, raw: Record<string, string>): Wrapped {
    const both: { id: string; settings: Record<string, string>; extra: number } = {
        id,
        settings: raw,
        extra: 1,
    };
    return both;
}
const w = wrap("u1", { about: "all", ignored: "y" });
console.log(w.id, show(w.settings));
