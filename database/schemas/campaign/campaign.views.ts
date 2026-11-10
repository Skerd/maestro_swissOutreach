import type {ViewConfig} from "armonia/src/modules/core/api/auxiliary/private/viewConfig";
import {
    emailToneValues,
    outreachLanguageValues,
    swissCantonCodes,
    swissCantonNames,
} from "armonia/src/modules/swissOutreach/types/constants";

export const campaignSheetView: ViewConfig = {
    model: "swissoutreachcampaigns",
    viewType: "sheet",
    accessModel: "swissOutreachCampaigns",
    apiUrl: "/api/swissOutreach/campaign",
    header: {
        titleField: "senderCompanyName",
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
                    props: {columns: 2},
                    children: [
                        {
                            render: "#DisplayCard",
                            permissions: {read: "status"},
                            field: {
                                name: "status",
                                widget: "#DisplayCard",
                                label: "status",
                                widgetProps: {icon: "#Tag"},
                            },
                        },
                        {
                            render: "#DisplayCard",
                            permissions: {read: "language"},
                            field: {
                                name: "language",
                                widget: "#DisplayCard",
                                label: "language",
                                widgetProps: {icon: "#Globe"},
                            },
                        },
                    ],
                },
            ],
        },
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
