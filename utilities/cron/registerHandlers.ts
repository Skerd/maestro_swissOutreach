import {registerCronHandler} from "@coreModule/cronjobs/registry/handlerRegistry";
import {retryStuckSwissOutreachCampaigns} from "@swissOutreachModule/utilities/cron/retryStuckCampaigns";

export function registerSwissOutreachCronHandlers(): void {
    registerCronHandler({
        code: "swissOutreach.retryStuckCampaigns",
        handler: async () => {
            await retryStuckSwissOutreachCampaigns();
        },
        version: "1",
        defaultJob: {
            name: "Swiss outreach retry stuck campaigns",
            type: "cron",
            cronExpression: "0 */15 * * * *",
            timezone: "UTC",
            singleton: true,
            executionStrategy: "distributed",
            scope: "global",
            priority: 12,
        },
    });
}
