import {describe, expect, it, vi} from "vitest";

// No real mail: core's sendMail is replaced, and email is on.
const mocks = vi.hoisted(() => ({sendMail: vi.fn(async () => ({messageId: "<4f2a@smtp.example.ch>"}))}));
vi.mock("@coreModule/utilities/emails/mailDeliveryService", () => ({sendMail: mocks.sendMail}));
vi.mock("@coreModule/environment", () => ({EMAIL: {ENABLED: true}, CONSTANTS: {DEFAULT_LANGUAGE: "en-US"}}));

import {mailDeliveryAdapter} from "@swissOutreachModule/utilities/adapters/mailAdapter";

describe("outreach mail adapter (TD-B126)", () => {
    it("returns the transport's message id, which replies and bounces carry", async () => {
        const result = await mailDeliveryAdapter.send({companyId: "6512f0a1b2c3d4e5f6a7b8c9", to: "info@a.ch", subject: "Offerte", text: "Guten Tag", fromEmail: "ada@buyer.ch", fromName: "Ada"});

        expect(result).toEqual({accepted: true, messageId: "<4f2a@smtp.example.ch>"});
        expect(mocks.sendMail).toHaveBeenCalledWith("6512f0a1b2c3d4e5f6a7b8c9", expect.objectContaining({to: "info@a.ch", replyTo: "ada@buyer.ch"}));
    });
});
