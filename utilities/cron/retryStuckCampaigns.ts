/**
 * Retries campaigns stuck mid-pipeline. Does NOT restart active sends
 * (avoids double-send); only re-enqueues discovery stages.
 * Also reclaims emails left in `queued` after a crash (safe: claim is atomic).
 */
import {getLogger} from "@coreModule/loggers/serverLog";
import Campaign from "@swissOutreachModule/database/schemas/campaign/campaign";
import OutreachEmail from "@swissOutreachModule/database/schemas/outreachEmail/outreachEmail";
import {campaignOrchestrator} from "@swissOutreachModule/utilities/pipeline/campaignOrchestrator";

const logger = getLogger("swissOutreach.cron");

const STUCK_MS = 15 * 60 * 1000;

export async function retryStuckSwissOutreachCampaigns(): Promise<void> {
    const cutoff = new Date(Date.now() - STUCK_MS);

    const reclaimed = await OutreachEmail.updateMany(
        {deletedAt: null, status: "queued", updatedAt: {$lt: cutoff}},
        {$set: {status: "approved"}},
    );
    if (reclaimed.modifiedCount > 0) {
        logger.info(`Reclaimed ${reclaimed.modifiedCount} stuck queued emails back to approved`);
    }

    const stuck = await Campaign.find({
        deletedAt: null,
        status: {$in: ["parsing", "searching", "enriching", "scoring"]},
        updatedAt: {$lt: cutoff},
    }).limit(20);

    for (const campaign of stuck) {
        logger.info(`Re-enqueue stuck campaign ${campaign._id} status=${campaign.status}`);
        campaignOrchestrator.enqueue(campaign._id.toString(), campaign.company.toString());
    }
}
