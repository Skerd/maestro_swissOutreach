import type {ViewConfig} from "armonia/src/modules/core/api/auxiliary/private/viewConfig";

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
    nodes: [],
};

export const outreachEmailViews: ViewConfig[] = [outreachEmailSheetView];
