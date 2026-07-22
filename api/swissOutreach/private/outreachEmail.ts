import {Router} from "express";
import {z} from "zod";
import {buildCreateDataFromSchemaDef, buildUpdateDataFromSchemaDef} from "@coreModule/api/buildUpdateDataFromSchemaDef";
import {createCrudRouter} from "@coreModule/api/crudRouterFactory";
import {createOutreachEmailFormSchema} from "armonia/src/modules/swissOutreach/api/swissOutreach/private/outreachEmail/createOutreachEmail.form.validator";
import {editOutreachEmailFormSchema} from "armonia/src/modules/swissOutreach/api/swissOutreach/private/outreachEmail/editOutreachEmail.form.validator";
import {OutreachEmailSchemaDef} from "armonia/src/modules/swissOutreach/api/swissOutreach/private/outreachEmail/outreachEmail.schema-def";
import OutreachEmail from "@swissOutreachModule/database/schemas/outreachEmail/outreachEmail";
import {outreachEmailService} from "@swissOutreachModule/database/schemas/outreachEmail/outreachEmail.service";
import {
    outreachEmailsToDTO,
    outreachEmailToDTO,
} from "@swissOutreachModule/utilities/mappers/outreachEmail/outreachEmailMapper.dto";
import {outreachEmailsToSelect} from "@swissOutreachModule/utilities/mappers/outreachEmail/outreachEmailMapper.select";
import ProspectCompany from "@swissOutreachModule/database/schemas/prospectCompany/prospectCompany";
import Campaign from "@swissOutreachModule/database/schemas/campaign/campaign";
import authMW from "@coreModule/utilities/middlewares/authMW";
import {rateLimiter} from "@coreModule/utilities/middlewares/rateLimiter";
import {validateFormZod} from "@coreModule/utilities/middlewares/validateFormZod";
import {asyncHandler} from "@coreModule/utilities/middlewares/asyncHandler";
import {isObjectIdZod, notEmptyZod} from "armonia/src/modules/core/helpers/zodBuilder";
import {apiValidationException} from "armonia/src/modules/core/helpers/exceptions";

const {router: crudRouter} = createCrudRouter({
    collectionName: "swissoutreachemails",
    model: OutreachEmail,
    service: outreachEmailService,
    entityName: "SwissOutreachEmail",
    createSchema: createOutreachEmailFormSchema,
    editSchema: editOutreachEmailFormSchema,
    toDTO: outreachEmailToDTO,
    toDTOArray: outreachEmailsToDTO,
    toSelect: outreachEmailsToSelect,
    defaultSort: {createdAt: -1},
    buildCreateData: buildCreateDataFromSchemaDef(OutreachEmailSchemaDef),
    buildUpdateData: buildUpdateDataFromSchemaDef(OutreachEmailSchemaDef),
});

export const router = Router();
router.use(crudRouter);

function emailIdSchema(languageCode: string, form: any = null) {
    return z.object({
        emailId: isObjectIdZod(form?.["emailIdLabel"] ?? "emailId", languageCode),
    });
}

function editBodySchema(languageCode: string, form: any = null) {
    return z.object({
        emailId: isObjectIdZod(form?.["emailIdLabel"] ?? "emailId", languageCode),
        subject: notEmptyZod(form?.["subjectLabel"] ?? "subject", languageCode).max(300).optional(),
        body: notEmptyZod(form?.["bodyLabel"] ?? "body", languageCode).max(20000).optional(),
    });
}

router.post(
    "/approve",
    authMW("private"),
    rateLimiter({windowMs: 60000, max: 60}),
    validateFormZod(emailIdSchema),
    asyncHandler(async (params: any) => {
        const {company, languageCode, emailId} = params;
        const email = await OutreachEmail.findOne({_id: emailId, company: company._id, deletedAt: null});
        if (!email) throw apiValidationException("email_not_found", "emailId", null, languageCode);
        if (!email.toEmail) throw apiValidationException("email_missing_recipient", "toEmail", null, languageCode);
        const wasAlreadyApproved = email.status === "approved" || email.status === "sent" || email.status === "queued";
        email.status = "approved";
        await email.save();
        await ProspectCompany.updateOne({_id: email.prospectCompanyId}, {$set: {status: "approved"}});
        if (!wasAlreadyApproved) {
            await Campaign.updateOne({_id: email.campaignId}, {$inc: {"stats.approved": 1}});
        }
        return {data: outreachEmailToDTO(email)};
    }),
);

router.post(
    "/skip",
    authMW("private"),
    rateLimiter({windowMs: 60000, max: 60}),
    validateFormZod(emailIdSchema),
    asyncHandler(async (params: any) => {
        const {company, languageCode, emailId} = params;
        const email = await OutreachEmail.findOne({_id: emailId, company: company._id, deletedAt: null});
        if (!email) throw apiValidationException("email_not_found", "emailId", null, languageCode);
        email.status = "skipped";
        await email.save();
        await ProspectCompany.updateOne({_id: email.prospectCompanyId}, {$set: {status: "skipped"}});
        return {data: outreachEmailToDTO(email)};
    }),
);

router.post(
    "/editDraft",
    authMW("private"),
    rateLimiter({windowMs: 60000, max: 60}),
    validateFormZod(editBodySchema),
    asyncHandler(async (params: any) => {
        const {company, languageCode, emailId, subject, body} = params;
        const email = await OutreachEmail.findOne({_id: emailId, company: company._id, deletedAt: null});
        if (!email) throw apiValidationException("email_not_found", "emailId", null, languageCode);
        if (subject) email.subject = subject;
        if (body) email.body = body;
        email.status = "edited";
        await email.save();
        return {data: outreachEmailToDTO(email)};
    }),
);
