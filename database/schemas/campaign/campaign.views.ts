import type {ViewConfig} from "armonia/src/modules/core/api/auxiliary/private/viewConfig";

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

export const campaignViews: ViewConfig[] = [campaignSheetView];
