import {Schema} from "mongoose";

export function applySuppressedContactIndexes(schema: Schema): void {
    // One live entry per address and per domain; drafting and sending look them up by both.
    schema.index({company: 1, email: 1}, {unique: true, partialFilterExpression: {deletedAt: null, email: {$type: "string"}}});
    schema.index({company: 1, domain: 1}, {unique: true, partialFilterExpression: {deletedAt: null, domain: {$type: "string"}}});
}
