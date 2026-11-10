import type {ViewConfig} from "armonia/src/modules/core/api/auxiliary/private/viewConfig";
import {lifecycleSheetGroup} from "@coreModule/database/schemas/shared/lifecycleSheetGroup";

/** One drafted email as sent (or to be sent): recipient, text, and how its sending went. */
export const outreachEmailSheetView: ViewConfig = {
    model: "swissoutreachemails",
    viewType: "sheet",
    accessModel: "swissOutreachEmails",
    apiUrl: "/api/swissOutreach/outreachEmail",
    header: {
        titleField: "subject",
        subtitleKey: "outreachEmail",
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
                            dependent: "toEmail",
                            permissions: {read: "toEmail"},
                            field: {name: "toEmail", widget: "#DisplayCard", label: "toEmail", widgetProps: {icon: "#Mail", type: "email"}},
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
                            dependent: "sentAt",
                            permissions: {read: "sentAt"},
                            field: {name: "sentAt", widget: "#DisplayCard", label: "sentAt", widgetProps: {icon: "#Calendar", format: "dateTime"}},
                        },
                    ],
                },
                {
                    render: "#SheetGrid",
                    props: {columns: 1},
                    children: [
                        {
                            render: "#DisplayCard",
                            permissions: {read: "subject"},
                            field: {name: "subject", widget: "#DisplayCard", label: "subject", widgetProps: {icon: "#Tag"}},
                        },
                        {
                            render: "#DisplayCard",
                            permissions: {read: "body"},
                            field: {name: "body", widget: "#DisplayCard", label: "body", widgetProps: {icon: "#AlignLeft", expandable: true, maxLength: 250}},
                        },
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

export const outreachEmailViews: ViewConfig[] = [outreachEmailSheetView];
