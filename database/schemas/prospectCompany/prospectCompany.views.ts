import type {ViewConfig} from "armonia/src/modules/core/api/auxiliary/private/viewConfig";

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
    nodes: [],
};

export const prospectCompanyViews: ViewConfig[] = [prospectCompanySheetView];
