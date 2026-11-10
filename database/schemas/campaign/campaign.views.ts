import type {ViewConfig} from "armonia/src/modules/core/api/auxiliary/private/viewConfig";
import {
    emailToneValues,
    outreachLanguageValues,
    swissCantonCodes,
    swissCantonNames,
} from "armonia/src/modules/swissOutreach/types/constants";
import {CAMPAIGN_NAME_MAX} from "armonia/src/modules/swissOutreach/api/swissOutreach/private/campaign/campaign.schema-def";
import {lifecycleSheetGroup} from "@coreModule/database/schemas/shared/lifecycleSheetGroup";

/** The campaign's settings, sender and results; its pipeline and emails live on the detail and approval pages. */
export const campaignSheetView: ViewConfig = {
    model: "swissoutreachcampaigns",
    viewType: "sheet",
    accessModel: "swissOutreachCampaigns",
    apiUrl: "/api/swissOutreach/campaign",
    header: {
        titleField: "name",
        subtitleKey: "campaign",
        showCloseButton: true,
    },
    nodes: [
        {
            render: "#SheetGroup",
            props: {title: "overview"},
            children: [
                {
                    render: "#SheetGrid",
                    props: {columns: 3},
                    children: [
                        {
                            render: "#DisplayCard",
                            permissions: {read: "name"},
                            field: {name: "name", widget: "#DisplayCard", label: "name", widgetProps: {icon: "#Tag"}},
                        },
                        {
                            render: "#DisplayCard",
                            permissions: {read: "status"},
                            field: {name: "status", widget: "#DisplayCard", label: "status", widgetProps: {icon: "#CircleDot", type: "enum", languageKeyCategory: "statusValues"}},
                        },
                        {
                            render: "#DisplayCard",
                            permissions: {read: "language"},
                            field: {name: "language", widget: "#DisplayCard", label: "language", widgetProps: {icon: "#Language", type: "enum", languageKeyCategory: "languageValues"}},
                        },
                        {
                            render: "#DisplayCard",
                            permissions: {read: "emailTone"},
                            field: {name: "emailTone", widget: "#DisplayCard", label: "emailTone", widgetProps: {icon: "#MoodSmile", type: "enum", languageKeyCategory: "emailToneValues"}},
                        },
                        {
                            render: "#DisplayCard",
                            permissions: {read: "country"},
                            field: {name: "country", widget: "#DisplayCard", label: "country", widgetProps: {icon: "#World"}},
                        },
                        {
                            render: "#DisplayCard",
                            permissions: {read: "maxCompanies"},
                            field: {name: "maxCompanies", widget: "#DisplayCard", label: "maxCompanies", widgetProps: {icon: "#Hash", type: "number"}},
                        },
                        {
                            render: "#DisplayCard",
                            permissions: {read: "sendAutomatically"},
                            field: {name: "sendAutomatically", widget: "#DisplayCard", label: "sendAutomatically", widgetProps: {icon: "#Send", type: "boolean"}},
                        },
                    ],
                },
                {
                    render: "#SheetGrid",
                    props: {columns: 1},
                    children: [
                        {
                            render: "#DisplayCard",
                            dependent: "cantons",
                            permissions: {read: "cantons"},
                            field: {name: "cantons", widget: "#DisplayCard", label: "cantons", widgetProps: {icon: "#MapPin", valueType: "stringBadgeList"}},
                        },
                        {
                            render: "#DisplayCard",
                            permissions: {read: "jobDescription"},
                            field: {name: "jobDescription", widget: "#DisplayCard", label: "jobDescription", widgetProps: {icon: "#AlignLeft", expandable: true, maxLength: 250}},
                        },
                        {
                            render: "#DisplayCard",
                            dependent: "additionalNotes",
                            permissions: {read: "additionalNotes"},
                            field: {name: "additionalNotes", widget: "#DisplayCard", label: "additionalNotes", widgetProps: {icon: "#Notes", expandable: true, maxLength: 250}},
                        },
                    ],
                },
            ],
        },
        {
            render: "#SheetGroup",
            props: {title: "sender"},
            children: [
                {
                    render: "#SheetGrid",
                    props: {columns: 2},
                    children: [
                        {
                            render: "#DisplayCard",
                            permissions: {read: "senderCompanyName"},
                            field: {name: "senderCompanyName", widget: "#DisplayCard", label: "senderCompanyName", widgetProps: {icon: "#Building"}},
                        },
                        {
                            render: "#DisplayCard",
                            permissions: {read: "senderName"},
                            field: {name: "senderName", widget: "#DisplayCard", label: "senderName", widgetProps: {icon: "#User"}},
                        },
                        {
                            render: "#DisplayCard",
                            permissions: {read: "senderEmail"},
                            field: {name: "senderEmail", widget: "#DisplayCard", label: "senderEmail", widgetProps: {icon: "#Mail", type: "email"}},
                        },
                        {
                            render: "#DisplayCard",
                            dependent: "senderPhone",
                            permissions: {read: "senderPhone"},
                            field: {name: "senderPhone", widget: "#DisplayCard", label: "senderPhone", widgetProps: {icon: "#Phone"}},
                        },
                        {
                            render: "#DisplayCard",
                            dependent: "senderWebsite",
                            permissions: {read: "senderWebsite"},
                            field: {name: "senderWebsite", widget: "#DisplayCard", label: "senderWebsite", widgetProps: {icon: "#Link", externalLink: true}},
                        },
                    ],
                },
            ],
        },
        {
            render: "#SheetGroup",
            props: {title: "results"},
            permissions: {readAny: ["stats", "lastError"]},
            children: [
                {
                    render: "#SheetGrid",
                    props: {columns: 3},
                    children: [
                        {
                            render: "#DisplayCard",
                            permissions: {read: "stats.found"},
                            field: {name: "stats.found", widget: "#DisplayCard", label: "stats.found", widgetProps: {icon: "#Search", type: "number"}},
                        },
                        {
                            render: "#DisplayCard",
                            permissions: {read: "stats.enriched"},
                            field: {name: "stats.enriched", widget: "#DisplayCard", label: "stats.enriched", widgetProps: {icon: "#AddressBook", type: "number"}},
                        },
                        {
                            render: "#DisplayCard",
                            permissions: {read: "stats.scored"},
                            field: {name: "stats.scored", widget: "#DisplayCard", label: "stats.scored", widgetProps: {icon: "#Star", type: "number"}},
                        },
                        {
                            render: "#DisplayCard",
                            permissions: {read: "stats.approved"},
                            field: {name: "stats.approved", widget: "#DisplayCard", label: "stats.approved", widgetProps: {icon: "#CircleCheck", type: "number"}},
                        },
                        {
                            render: "#DisplayCard",
                            permissions: {read: "stats.sent"},
                            field: {name: "stats.sent", widget: "#DisplayCard", label: "stats.sent", widgetProps: {icon: "#MailForward", type: "number"}},
                        },
                        {
                            render: "#DisplayCard",
                            permissions: {read: "stats.failed"},
                            field: {name: "stats.failed", widget: "#DisplayCard", label: "stats.failed", widgetProps: {icon: "#AlertTriangle", type: "number"}},
                        },
                    ],
                },
                {
                    render: "#SheetGrid",
                    props: {columns: 1},
                    children: [
                        {
                            render: "#DisplayCard",
                            dependent: "lastError",
                            permissions: {read: "lastError"},
                            field: {name: "lastError", widget: "#DisplayCard", label: "lastError", widgetProps: {icon: "#AlertTriangle"}},
                        },
                    ],
                },
            ],
        },
        lifecycleSheetGroup,
    ],
};

/** The create form for a Swiss outreach campaign (TD-F06), rendered by the generic create page. */
const languageOptions = outreachLanguageValues.map((value) => ({value, label: `form.language.${value}`}));
const emailToneOptions = emailToneValues.map((value) => ({value, label: `form.emailTone.${value}`}));
/** Proper names, not language keys: a canton is shown by its own name in every UI language. */
const cantonOptions = swissCantonCodes.map((value) => ({value, label: `${swissCantonNames[value]} (${value})`}));

const campaignCreateFormNodes: ViewConfig["nodes"] = [
    {
        render: "#Field",
        field: {
            name: "name",
            widget: "#Input",
            label: "form.nameLabel",
            placeholder: "form.namePlaceholder",
            required: true,
            widgetProps: {maxLength: CAMPAIGN_NAME_MAX},
        },
    },
    {
        render: "#Field",
        field: {
            name: "jobDescription",
            widget: "#Textarea",
            label: "form.jobDescriptionLabel",
            placeholder: "form.jobDescriptionPlaceholder",
            required: true,
            widgetProps: {rows: 5, maxLength: 8000},
        },
    },
    {
        render: "#FormGrid",
        props: {columns: 2},
        children: [
            {
                render: "#Field",
                field: {
                    name: "country",
                    widget: "#Input",
                    label: "form.countryLabel",
                    placeholder: "form.countryPlaceholder",
                    required: true,
                    widgetProps: {maxLength: 80},
                },
            },
            {
                render: "#Field",
                field: {
                    name: "cantons",
                    widget: "#Select",
                    label: "form.cantonsLabel",
                    placeholder: "form.cantonsPlaceholder",
                    widgetProps: {options: cantonOptions, className: "grow w-full", multiple: true},
                },
            },
            {
                render: "#Field",
                field: {
                    name: "maxCompanies",
                    widget: "#Input",
                    label: "form.maxCompaniesLabel",
                    placeholder: "form.maxCompaniesPlaceholder",
                    required: true,
                    widgetProps: {type: "number", min: 1, max: 500},
                },
            },
            {
                render: "#Field",
                field: {
                    name: "language",
                    widget: "#SimpleSelect",
                    label: "form.languageLabel",
                    placeholder: "form.languagePlaceholder",
                    required: true,
                    widgetProps: {options: languageOptions, className: "grow w-full"},
                },
            },
            {
                render: "#Field",
                field: {
                    name: "emailTone",
                    widget: "#SimpleSelect",
                    label: "form.emailToneLabel",
                    placeholder: "form.emailTonePlaceholder",
                    required: true,
                    widgetProps: {options: emailToneOptions, className: "grow w-full"},
                },
            },
            {
                render: "#Field",
                field: {name: "sendAutomatically", widget: "#Switch", label: "form.sendAutomaticallyLabel"},
            },
        ],
    },
    {
        render: "#FormGrid",
        props: {columns: 2},
        children: [
            {
                render: "#Field",
                field: {
                    name: "senderCompanyName",
                    widget: "#Input",
                    label: "form.senderCompanyNameLabel",
                    placeholder: "form.senderCompanyNamePlaceholder",
                    required: true,
                    widgetProps: {maxLength: 200},
                },
            },
            {
                render: "#Field",
                field: {
                    name: "senderName",
                    widget: "#Input",
                    label: "form.senderNameLabel",
                    placeholder: "form.senderNamePlaceholder",
                    required: true,
                    widgetProps: {maxLength: 200},
                },
            },
            {
                render: "#Field",
                field: {
                    name: "senderEmail",
                    widget: "#Input",
                    label: "form.senderEmailLabel",
                    placeholder: "form.senderEmailPlaceholder",
                    required: true,
                    widgetProps: {type: "email"},
                },
            },
            {
                render: "#Field",
                field: {
                    name: "senderPhone",
                    widget: "#Input",
                    label: "form.senderPhoneLabel",
                    placeholder: "form.senderPhonePlaceholder",
                    widgetProps: {maxLength: 40},
                },
            },
            {
                render: "#Field",
                field: {
                    name: "senderWebsite",
                    widget: "#Input",
                    label: "form.senderWebsiteLabel",
                    placeholder: "form.senderWebsitePlaceholder",
                    widgetProps: {type: "url"},
                },
            },
        ],
    },
    {
        render: "#Field",
        field: {
            name: "additionalNotes",
            widget: "#Textarea",
            label: "form.additionalNotesLabel",
            placeholder: "form.additionalNotesPlaceholder",
            widgetProps: {rows: 3, maxLength: 4000},
        },
    },
];

export const campaignCreateFormView: ViewConfig = {
    model: "swissoutreachcampaigns",
    viewType: "form",
    viewMode: "create",
    accessModel: "swissOutreachCampaigns",
    apiUrl: "/api/swissOutreach/campaign",
    method: "PUT",
    nodes: campaignCreateFormNodes,
};

export const campaignViews: ViewConfig[] = [campaignSheetView, campaignCreateFormView];
