import {BaseCrudService} from "@coreModule/database/services/baseCrudService";
import OutreachEmail, {IOutreachEmail} from "./outreachEmail";
import type {FilterQuery, UpdateQuery} from "mongoose";

export class OutreachEmailService extends BaseCrudService<IOutreachEmail, typeof OutreachEmail> {
    constructor() {
        super(OutreachEmail, "SwissOutreachEmail");
    }

    /** Writes the draft for a prospect, creating its email row the first time. */
    upsertDraft(filter: FilterQuery<IOutreachEmail>, update: UpdateQuery<IOutreachEmail>) {
        return this.model.findOneAndUpdate(filter, update, {upsert: true});
    }

    /** Claims the next sendable email (status queued, one more attempt) and returns it. */
    claimNext(filter: FilterQuery<IOutreachEmail>) {
        return this.model.findOneAndUpdate(filter, {$set: {status: "queued"}, $inc: {attempts: 1}}, {new: true}).noDeleted();
    }
}

export const outreachEmailService = new OutreachEmailService();
