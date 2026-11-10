/**
 * Retries campaigns stuck mid-pipeline, or left in `draft` when their first run never started, each claimed in one
 * write so a start racing it gets one run. Reclaims emails left in `queued` after a crash (safe: claim is atomic), then
 * resumes sends whose process died: a live send writes its campaign after every email, so a `sending` campaign
 * untouched for 15 minutes has no sender. Each email is claimed atomically, so a resumed send never mails one twice
 * while the old sender is gone (a sender only stalled past 15 minutes is TD-B128's lease).
 */
import type {ObjectId} from "mongodb";
import type {CampaignStatusValue} from "armonia/src/modules/swissOutreach/types/constants";
import {getLogger} from "@coreModule/loggers/serverLog";
import {campaignOrchestrator} from "@swissOutreachModule/utilities/pipeline/campaignOrchestrator";

import {outreachEmailService} from "@swissOutreachModule/database/schemas/outreachEmail/outreachEmail.service";
import {campaignService} from "@swissOutreachModule/database/schemas/campaign/campaign.service";
const logger = getLogger("swissOutreach.cron");

const STUCK_MS = 15 * 60 * 1000;
const RETRYABLE: CampaignStatusValue[] = ["draft", "parsing", "searching", "enriching", "scoring"];

export async function retryStuckSwissOutreachCampaigns(company: ObjectId): Promise<void> {
    const cutoff = new Date(Date.now() - STUCK_MS);

    const reclaimed = await outreachEmailService.updateMany({company, status: "queued", updatedAt: {$lt: cutoff}}, {$set: {status: "approved"}}, {withDeleted: false});
    if (reclaimed.modifiedCount > 0) {
        logger.info(`Reclaimed ${reclaimed.modifiedCount} stuck queued emails back to approved`);
    }

    const stuck = await campaignService.find({
        company,
        status: {$in: RETRYABLE},
        updatedAt: {$lt: cutoff},
    }, {withDeleted: false}, undefined, undefined, undefined, 20);

    for (const campaign of stuck) {
        // Claimed only while it is still as found: a user's start since then wins.
        const claimed = await campaignOrchestrator.claimAndEnqueue(campaign._id.toString(), [campaign.status], {company, updatedAt: {$lt: cutoff}});
        if (claimed) logger.info(`Re-enqueued stuck campaign ${campaign._id} status=${campaign.status}`);
    }

    const stalledSends = await campaignService.find({
        company,
        status: "sending",
        updatedAt: {$lt: cutoff},
    }, {withDeleted: false}, undefined, "_id", undefined, 20);
    for (const campaign of stalledSends) {
        const claimed = await campaignOrchestrator.claimAndSend(campaign._id.toString(), ["sending"], {company, updatedAt: {$lt: cutoff}});
        if (claimed) logger.info(`Resumed the stalled send of campaign ${campaign._id}`);
    }
}
