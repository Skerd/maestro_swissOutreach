import type {ViewConfig} from "armonia/src/modules/core/api/auxiliary/private/viewConfig";
import {lifecycleSheetGroup} from "@coreModule/database/schemas/shared/lifecycleSheetGroup";

/** What the pipeline found out about a prospect: register entry, website, contacts and its fit for the job. */
export const prospectCompanySheetView: ViewConfig = {
    model: "swissoutreachprospectcompanies",
    viewType: "sheet",
    accessModel: "swissOutreachProspectCompanies",
    apiUrl: "/api/swissOutreach/prospectCompany",
    header: {
        titleField: "companyName",
        subtitleKey: "prospectCompany",
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
                            permissions: {read: "companyName"},
                            field: {name: "companyName", widget: "#DisplayCard", label: "companyName", widgetProps: {icon: "#Building"}},
                        },
                        {
                            render: "#DisplayCard",
                            dependent: "uid",
                            permissions: {read: "uid"},
                            field: {name: "uid", widget: "#DisplayCard", label: "uid", widgetProps: {icon: "#Id"}},
                        },
                        {
                            render: "#DisplayCard",
                            dependent: "legalForm",
                            permissions: {read: "legalForm"},
                            field: {name: "legalForm", widget: "#DisplayCard", label: "legalForm", widgetProps: {icon: "#Certificate"}},
                        },
                        {
                            render: "#DisplayCard",
                            dependent: "canton",
                            permissions: {read: "canton"},
                            field: {name: "canton", widget: "#DisplayCard", label: "canton", widgetProps: {icon: "#MapPin"}},
                        },
                        {
                            render: "#DisplayCard",
                            dependent: "city",
                            permissions: {read: "city"},
                            field: {name: "city", widget: "#DisplayCard", label: "city", widgetProps: {icon: "#BuildingCommunity"}},
                        },
                        {
                            render: "#DisplayCard",
                            permissions: {read: "status"},
                            field: {name: "status", widget: "#DisplayCard", label: "status", widgetProps: {icon: "#CircleDot", type: "enum", languageKeyCategory: "statusValues"}},
                        },
                    ],
                },
                {
                    render: "#SheetGrid",
                    props: {columns: 2},
                    children: [
                        {
                            render: "#DisplayCard",
                            dependent: "website",
                            permissions: {read: "website"},
                            field: {name: "website", widget: "#DisplayCard", label: "website", widgetProps: {icon: "#World", externalLink: true}},
                        },
                        {
                            render: "#DisplayCard",
                            dependent: "registerUrl",
                            permissions: {read: "registerUrl"},
                            field: {name: "registerUrl", widget: "#DisplayCard", label: "registerUrl", widgetProps: {icon: "#Link", externalLink: true}},
                        },
                    ],
                },
            ],
        },
        {
            render: "#SheetGroup",
            props: {title: "contacts"},
            permissions: {readAny: ["emails", "phones"]},
            children: [
                {
                    render: "#SheetGrid",
                    props: {columns: 2},
                    children: [
                        {
                            render: "#DisplayCard",
                            permissions: {read: "emails"},
                            field: {name: "emails", widget: "#DisplayCard", label: "emails", widgetProps: {icon: "#Mail", valueType: "stringBadgeList"}},
                        },
                        {
                            render: "#DisplayCard",
                            permissions: {read: "phones"},
                            field: {name: "phones", widget: "#DisplayCard", label: "phones", widgetProps: {icon: "#Phone", valueType: "stringBadgeList"}},
                        },
                    ],
                },
            ],
        },
        {
            render: "#SheetGroup",
            props: {title: "assessment"},
            permissions: {readAny: ["score", "scoreReason", "summary", "services"]},
            children: [
                {
                    render: "#SheetGrid",
                    props: {columns: 1},
                    children: [
                        {
                            render: "#DisplayCard",
                            dependent: "score",
                            permissions: {read: "score"},
                            field: {name: "score", widget: "#DisplayCard", label: "score", widgetProps: {icon: "#Star", type: "number"}},
                        },
                        {
                            render: "#DisplayCard",
                            dependent: "scoreReason",
                            permissions: {read: "scoreReason"},
                            field: {name: "scoreReason", widget: "#DisplayCard", label: "scoreReason", widgetProps: {icon: "#MessageCircle", expandable: true, maxLength: 250}},
                        },
                        {
                            render: "#DisplayCard",
                            dependent: "summary",
                            permissions: {read: "summary"},
                            field: {name: "summary", widget: "#DisplayCard", label: "summary", widgetProps: {icon: "#Robot", expandable: true, maxLength: 250}},
                        },
                        {
                            render: "#DisplayCard",
                            permissions: {read: "services"},
                            field: {name: "services", widget: "#DisplayCard", label: "services", widgetProps: {icon: "#Tool", valueType: "stringBadgeList"}},
                        },
                    ],
                },
            ],
        },
        lifecycleSheetGroup,
    ],
};

export const prospectCompanyViews: ViewConfig[] = [prospectCompanySheetView];
