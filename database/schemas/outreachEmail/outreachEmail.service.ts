import {BaseCrudService} from "@coreModule/database/services/baseCrudService";
import OutreachEmail, {IOutreachEmail} from "./outreachEmail";

export class OutreachEmailService extends BaseCrudService<IOutreachEmail, typeof OutreachEmail> {
    constructor() {
        super(OutreachEmail, "SwissOutreachEmail");
    }
}

export const outreachEmailService = new OutreachEmailService();
