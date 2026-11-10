import type {DefaultRoleDefinition} from "@coreModule/database/schemas/role/role.defaults";

// RolePermission groups are the capitalised collection names; the outreach models are loose, so their tags carry no scope.
const CAMPAIGNS = "Swissoutreachcampaigns";
const EMAILS = "Swissoutreachemails";
const PROSPECTS = "Swissoutreachprospectcompanies";
const PIPELINE_LOGS = "Swissoutreachpipelinerunlogs";
const DO_NOT_CONTACT = "Swissoutreachsuppressedcontacts";

/** Campaigns and emails are history: only an administrator deletes or restores them. */
const deleteRestore = [
    "swissoutreachcampaigns[delete:swissoutreachcampaigns]",
    "swissoutreachcampaigns[restore:swissoutreachcampaigns]",
    "swissoutreachemails[delete:swissoutreachemails]",
    "swissoutreachemails[restore:swissoutreachemails]",
];
/** Deciding what goes out, and who must never be written to again, is the approver's (D113). */
const approvalActions = [
    "swissoutreachcampaigns[action:approveAll]",
    "swissoutreachcampaigns[action:sendApproved]",
    "swissoutreachemails[action:approve]",
    "swissoutreachemails[action:skip]",
    "swissoutreachemails[action:doNotContact]",
];

function outreachRole(
    name: string,
    slug: string,
    description: string,
    permissionGroups: string[],
    readPermissionGroups: string[],
    excludedPermissions: string[],
): DefaultRoleDefinition {
    return {
        name,
        slug,
        description,
        isAdmin: false,
        isSignupDefault: false,
        canEdit: true,
        canDelete: false,
        permissionGroups,
        readPermissionGroups,
        excludedPermissions,
    };
}

export const swissOutreachDefaultRoles: DefaultRoleDefinition[] = [
    outreachRole(
        "Outreach operator",
        "outreach_operator",
        "Runs outreach campaigns: creates and edits them, starts and cancels them, and rewrites drafted emails. Reads prospects, emails, the pipeline log and the do-not-contact list. Cannot approve, skip or send emails.",
        [CAMPAIGNS, EMAILS],
        [PROSPECTS, PIPELINE_LOGS, DO_NOT_CONTACT],
        [...deleteRestore, ...approvalActions],
    ),
    outreachRole(
        "Outreach approver",
        "outreach_approver",
        "Everything the operator does, and decides what goes out: approves or skips emails, sends the approved ones, and keeps the do-not-contact list.",
        [CAMPAIGNS, EMAILS, DO_NOT_CONTACT],
        [PROSPECTS, PIPELINE_LOGS],
        deleteRestore,
    ),
];
