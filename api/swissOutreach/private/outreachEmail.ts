import {Router} from "express";
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
import {prospectCompanyService} from "@swissOutreachModule/database/schemas/prospectCompany/prospectCompany.service";
import {campaignService} from "@swissOutreachModule/database/schemas/campaign/campaign.service";
import authMW from "@coreModule/utilities/middlewares/authMW";
import {rateLimiter} from "@coreModule/utilities/middlewares/rateLimiter";
import {validateFormZod} from "@coreModule/utilities/middlewares/validateFormZod";
import {asyncHandler} from "@coreModule/utilities/middlewares/asyncHandler";
import {transactionHandler} from "@coreModule/utilities/middlewares/transactionUtils";
import {
    editOutreachEmailDraftFormSchema,
    outreachEmailIdFormSchema,
} from "armonia/src/modules/swissOutreach/api/swissOutreach/private/outreachEmail/outreachEmailAction.form.validator";
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
    selectSearchField: "subject",
    defaultSort: {createdAt: -1},
    buildCreateData: buildCreateDataFromSchemaDef(OutreachEmailSchemaDef),
    buildUpdateData: buildUpdateDataFromSchemaDef(OutreachEmailSchemaDef),
});

export const router = Router();
router.use(crudRouter);

router.post(
    "/approve",
    authMW("private"),
    rateLimiter({windowMs: 60000, max: 60}),
    transactionHandler(),
    validateFormZod(outreachEmailIdFormSchema),
    asyncHandler(async (params: any) => {
        const {company, languageCode, emailId, session} = params;
        const email = await outreachEmailService.findOne({_id: emailId, company: company._id}, {withDeleted: false, languageCode, session});
        if (!email) throw apiValidationException("email_not_found", "emailId", null, languageCode);
        if (!email.toEmail) throw apiValidationException("email_missing_recipient", "toEmail", null, languageCode);
        const wasAlreadyApproved = email.status === "approved" || email.status === "sent" || email.status === "queued";
        email.status = "approved";
        await email.save({session});
        await prospectCompanyService.updateOne({_id: email.prospectCompanyId}, {$set: {status: "approved"}}, {session});
        if (!wasAlreadyApproved) {
            await campaignService.updateOne({_id: email.campaignId}, {$inc: {"stats.approved": 1}}, {session});
        }
        return {data: outreachEmailToDTO(email)};
    }),
);

router.post(
    "/skip",
    authMW("private"),
    rateLimiter({windowMs: 60000, max: 60}),
    transactionHandler(),
    validateFormZod(outreachEmailIdFormSchema),
    asyncHandler(async (params: any) => {
        const {company, languageCode, emailId, session} = params;
        const email = await outreachEmailService.findOne({_id: emailId, company: company._id}, {withDeleted: false, languageCode, session});
        if (!email) throw apiValidationException("email_not_found", "emailId", null, languageCode);
        email.status = "skipped";
        await email.save({session});
        await prospectCompanyService.updateOne({_id: email.prospectCompanyId}, {$set: {status: "skipped"}}, {session});
        return {data: outreachEmailToDTO(email)};
    }),
);

router.post(
    "/editDraft",
    authMW("private"),
    rateLimiter({windowMs: 60000, max: 60}),
    transactionHandler(),
    validateFormZod(editOutreachEmailDraftFormSchema),
    asyncHandler(async (params: any) => {
        const {company, languageCode, emailId, subject, body, session} = params;
        const email = await outreachEmailService.findOne({_id: emailId, company: company._id}, {withDeleted: false, languageCode, session});
        if (!email) throw apiValidationException("email_not_found", "emailId", null, languageCode);
        if (subject) email.subject = subject;
        if (body) email.body = body;
        email.status = "edited";
        await email.save({session});
        return {data: outreachEmailToDTO(email)};
    }),
);
