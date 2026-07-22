import {registerCronHandler} from "@coreModule/cronjobs/registry/handlerRegistry";
import {retryStuckSwissOutreachCampaigns} from "@swissOutreachModule/utilities/cron/retryStuckCampaigns";

export function registerSwissOutreachCronHandlers(): void {
    registerCronHandler({
        code: "swissOutreach.retryStuckCampaigns",
        handler: async () => {
            await retryStuckSwissOutreachCampaigns();
        },
        version: "1",
    });
}
