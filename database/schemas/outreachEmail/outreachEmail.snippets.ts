import type {OutreachEmailSimple} from "armonia/src/modules/swissOutreach/dto/outreachEmail.dto";
import type {IOutreachEmail} from "@swissOutreachModule/database/schemas/outreachEmail/outreachEmail";
import {defineSnippet} from "@coreModule/database/utilities/snippet";

export const OutreachEmailSimpleSnippet = defineSnippet<IOutreachEmail, OutreachEmailSimple>()({
    keys: {
        subject: {},
        status: {},
        toEmail: {},
    },
});
