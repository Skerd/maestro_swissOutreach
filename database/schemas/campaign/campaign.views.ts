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
                            render: "#SmallInfoCard",
                            permissions: {read: "status"},
                            field: {
                                name: "status",
                                widget: "#SmallInfoCard",
                                label: "status",
                                widgetProps: {icon: "#Tag"},
                            },
                        },
                        {
                            render: "#SmallInfoCard",
                            permissions: {read: "language"},
                            field: {
                                name: "language",
                                widget: "#SmallInfoCard",
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
