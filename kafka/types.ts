export type SwissOutreachPipelineEvent = {
    eventType: "swiss_outreach_pipeline";
    campaignId: string;
    companyId: string;
    timestamp: number;
    action: "run" | "send_approved";
};
