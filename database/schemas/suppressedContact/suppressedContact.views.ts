import type {ViewConfig} from "armonia/src/modules/core/api/auxiliary/private/viewConfig";
import {lifecycleSheetGroup} from "@coreModule/database/schemas/shared/lifecycleSheetGroup";
import {
    SUPPRESSED_CONTACT_DOMAIN_MAX,
    SUPPRESSED_CONTACT_REASON_MAX,
} from "armonia/src/modules/swissOutreach/api/swissOutreach/private/suppressedContact/suppressedContact.schema-def";

const API_URL = "/api/swissOutreach/suppressedContact";

export const suppressedContactSheetView: ViewConfig = {
    model: "swissoutreachsuppressedcontacts",
    viewType: "sheet",
    accessModel: "swissoutreachsuppressedcontacts",
    apiUrl: API_URL,
    header: {
        titleField: "email",
        subtitleKey: "suppressedContact",
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
                            permissions: {read: "email"},
                            field: {name: "email", widget: "#DisplayCard", label: "email", widgetProps: {icon: "#IconMail"}},
                        },
                        {
                            render: "#DisplayCard",
                            permissions: {read: "domain"},
                            field: {name: "domain", widget: "#DisplayCard", label: "domain", widgetProps: {icon: "#IconWorld"}},
                        },
                        {
                            render: "#DisplayCard",
                            permissions: {read: "source"},
                            field: {
                                name: "source",
                                widget: "#DisplayCard",
                                label: "source",
                                widgetProps: {icon: "#IconTag", type: "enum", languageKeyCategory: "sourceValues"},
                            },
                        },
                    ],
                },
                {
                    render: "#SheetGrid",
                    props: {columns: 1},
                    children: [
                        {
                            render: "#DisplayCard",
                            permissions: {read: "reason"},
                            field: {
                                name: "reason",
                                widget: "#DisplayCard",
                                label: "reason",
                                widgetProps: {icon: "#IconAlignLeft", expandable: true, maxLength: 250},
                            },
                        },
                    ],
                },
            ],
        },
        lifecycleSheetGroup,
    ],
};

/** Create only: an entry is removed and added again rather than edited. */
const suppressedContactCreateFormNodes: ViewConfig["nodes"] = [
    {
        render: "#FormGrid",
        props: {columns: 2},
        children: [
            {
                render: "#Field",
                field: {name: "email", widget: "#Input", label: "form.emailLabel", placeholder: "form.emailPlaceholder"},
            },
            {
                render: "#Field",
                field: {
                    name: "domain",
                    widget: "#Input",
                    label: "form.domainLabel",
                    placeholder: "form.domainPlaceholder",
                    widgetProps: {maxLength: SUPPRESSED_CONTACT_DOMAIN_MAX},
                },
            },
        ],
    },
    {
        render: "#Field",
        field: {
            name: "reason",
            widget: "#Textarea",
            label: "form.reasonLabel",
            placeholder: "form.reasonPlaceholder",
            widgetProps: {rows: 3, maxLength: SUPPRESSED_CONTACT_REASON_MAX},
        },
    },
];

export const suppressedContactCreateFormView: ViewConfig = {
    model: "swissoutreachsuppressedcontacts",
    viewType: "form",
    viewMode: "create",
    accessModel: "swissoutreachsuppressedcontacts",
    apiUrl: API_URL,
    method: "PUT",
    nodes: suppressedContactCreateFormNodes,
};

export const suppressedContactViews: ViewConfig[] = [suppressedContactSheetView, suppressedContactCreateFormView];
