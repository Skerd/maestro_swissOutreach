/** One `Allow`/`Disallow` line of the robots.txt group that applies to the crawler. */
export type RobotsRule = {allow: boolean; pattern: string};

/**
 * The rules a robots.txt sets for a crawler (RFC 9309): the groups naming its product token, or else the `*` groups.
 * An empty `Disallow:` allows everything, so it adds no rule.
 */
export function robotsRulesFor(text: string, productToken: string): RobotsRule[] {
    const groups: Array<{agents: string[]; rules: RobotsRule[]}> = [];
    let current: {agents: string[]; rules: RobotsRule[]} | undefined;
    let previousWasAgent = false;

    for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.replace(/#.*$/, "").trim();
        const separator = line.indexOf(":");
        if (separator < 0) continue;
        const field = line.slice(0, separator).trim().toLowerCase();
        const value = line.slice(separator + 1).trim();

        if (field === "user-agent") {
            // Consecutive User-agent lines share one group; one after a rule starts the next group.
            if (!current || !previousWasAgent) {
                current = {agents: [], rules: []};
                groups.push(current);
            }
            current.agents.push(value.toLowerCase());
            previousWasAgent = true;
            continue;
        }
        if (field === "allow" || field === "disallow") {
            previousWasAgent = false;
            if (current && value) current.rules.push({allow: field === "allow", pattern: value});
        }
    }

    const token = productToken.toLowerCase();
    const own = groups.filter((group) => group.agents.includes(token));
    const applying = own.length > 0 ? own : groups.filter((group) => group.agents.includes("*"));
    return applying.flatMap((group) => group.rules);
}

/** A rule's path pattern as a prefix match: `*` matches any characters, a final `$` ends the path. */
function patternMatches(pattern: string, path: string): boolean {
    const anchored = pattern.endsWith("$");
    const body = (anchored ? pattern.slice(0, -1) : pattern)
        .split("*")
        .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
        .join(".*");
    return new RegExp(`^${body}${anchored ? "$" : ""}`).test(path);
}

/** Whether a path may be crawled: the longest matching rule decides, and `Allow` wins a tie; no match allows. */
export function isPathAllowed(rules: RobotsRule[], path: string): boolean {
    let decision: RobotsRule | undefined;
    for (const rule of rules) {
        if (!patternMatches(rule.pattern, path)) continue;
        if (!decision || rule.pattern.length > decision.pattern.length || (rule.pattern.length === decision.pattern.length && rule.allow)) {
            decision = rule;
        }
    }
    return decision ? decision.allow : true;
}
