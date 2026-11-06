import {describe, expect, it} from "vitest";
import {editOutreachEmailDraftFormSchema as editBodySchema} from "armonia/src/modules/swissOutreach/api/swissOutreach/private/outreachEmail/outreachEmailAction.form.validator";

// TD-B22: `.max()` chained on `notEmptyZod` threw while building the schema, so `/editDraft` answered 500 on every call.
describe("outreach email /editDraft schema", () => {
    const emailId = "64b000000000000000000001";

    it("builds and accepts a draft edit", () => {
        const result = editBodySchema("en-US").safeParse({emailId, subject: "Hello", body: "Text"});
        expect(result.success).toBe(true);
    });

    it("keeps subject and body optional", () => {
        expect(editBodySchema("en-US").safeParse({emailId}).success).toBe(true);
    });

    it("refuses an empty or too long subject with a validation error", () => {
        const schema = editBodySchema("en-US");
        expect(schema.safeParse({emailId, subject: ""}).success).toBe(false);
        expect(schema.safeParse({emailId, subject: "x".repeat(301)}).success).toBe(false);
        expect(schema.safeParse({emailId, body: "x".repeat(20001)}).success).toBe(false);
    });
});
