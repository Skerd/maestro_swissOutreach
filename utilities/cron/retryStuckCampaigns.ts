/**
 * Retries campaigns stuck mid-pipeline. Does NOT restart active sends
 * (avoids double-send); only re-enqueues discovery stages.
 * Also reclaims emails left in `queued` after a crash (safe: claim is atomic).
 */
import type {ObjectId} from "mongodb";
import {getLogger} from "@coreModule/loggers/serverLog";
import {campaignOrchestrator} from "@swissOutreachModule/utilities/pipeline/campaignOrchestrator";

import {outreachEmailService} from "@swissOutreachModule/database/schemas/outreachEmail/outreachEmail.service";
import {campaignService} from "@swissOutreachModule/database/schemas/campaign/campaign.service";
const logger = getLogger("swissOutreach.cron");

const STUCK_MS = 15 * 60 * 1000;

export async function retryStuckSwissOutreachCampaigns(company: ObjectId): Promise<void> {
    const cutoff = new Date(Date.now() - STUCK_MS);

    const reclaimed = await outreachEmailService.updateMany({company, status: "queued", updatedAt: {$lt: cutoff}}, {$set: {status: "approved"}}, {withDeleted: false});
    if (reclaimed.modifiedCount > 0) {
        logger.info(`Reclaimed ${reclaimed.modifiedCount} stuck queued emails back to approved`);
    }

    const stuck = await campaignService.find({
        company,
        status: {$in: ["parsing", "searching", "enriching", "scoring"]},
        updatedAt: {$lt: cutoff},
    }, {withDeleted: false}, undefined, undefined, undefined, 20);

    for (const campaign of stuck) {
        logger.info(`Re-enqueue stuck campaign ${campaign._id} status=${campaign.status}`);
        campaignOrchestrator.enqueue(campaign._id.toString(), campaign.company.toString());
    }
}
