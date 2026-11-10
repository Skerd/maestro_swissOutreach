/**
 * Retries campaigns stuck mid-pipeline, or left in `draft` when their first run never started, each claimed in one
 * write so a start racing it gets one run. A campaign is stuck only when nobody holds its lease (TD-B128): a run or
 * send renews its lease while it works, however slowly, so a live worker is never given a twin. Emails left `queued`
 * go back to `approved` only when their campaign's lease is gone too (the sender that queued them is dead), and sends
 * whose sender died are resumed. Each email is claimed atomically, so a resumed send never mails one twice.
 * The 15 minutes without a campaign write still apply: a run claimed but not yet started holds no lease.
 */
import type {ObjectId} from "mongodb";
import type {CampaignStatusValue} from "armonia/src/modules/swissOutreach/types/constants";
import {getLogger} from "@coreModule/loggers/serverLog";
import {campaignOrchestrator} from "@swissOutreachModule/utilities/pipeline/campaignOrchestrator";

import {outreachEmailService} from "@swissOutreachModule/database/schemas/outreachEmail/outreachEmail.service";
import {campaignService, withoutLiveLease} from "@swissOutreachModule/database/schemas/campaign/campaign.service";
const logger = getLogger("swissOutreach.cron");

const STUCK_MS = 15 * 60 * 1000;
const RETRYABLE: CampaignStatusValue[] = ["draft", "parsing", "searching", "enriching", "scoring"];

export async function retryStuckSwissOutreachCampaigns(company: ObjectId): Promise<void> {
    const now = new Date();
    const cutoff = new Date(now.getTime() - STUCK_MS);

    // A live sender may hold its queued email for long (a hung SMTP socket): that email stays queued.
    const held = await campaignService.find({company, "lease.until": {$gt: now}}, {withDeleted: false}, undefined, "_id");
    const reclaimed = await outreachEmailService.updateMany(
        {company, status: "queued", updatedAt: {$lt: cutoff}, campaignId: {$nin: held.map((campaign) => campaign._id)}},
        {$set: {status: "approved"}},
        {withDeleted: false},
    );
    if (reclaimed.modifiedCount > 0) {
        logger.info(`Reclaimed ${reclaimed.modifiedCount} stuck queued emails back to approved`);
    }

    const unheldSince = {company, updatedAt: {$lt: cutoff}, ...withoutLiveLease(now)};
    const stuck = await campaignService.find({...unheldSince, status: {$in: RETRYABLE}}, {withDeleted: false}, undefined, undefined, undefined, 20);

    for (const campaign of stuck) {
        // Claimed only while it is still as found: a user's start, or a worker taking the lease, since then wins.
        const claimed = await campaignOrchestrator.claimAndEnqueue(campaign._id.toString(), [campaign.status], unheldSince);
        if (claimed) logger.info(`Re-enqueued stuck campaign ${campaign._id} status=${campaign.status}`);
    }

    const stalledSends = await campaignService.find({...unheldSince, status: "sending"}, {withDeleted: false}, undefined, "_id", undefined, 20);
    for (const campaign of stalledSends) {
        const claimed = await campaignOrchestrator.claimAndSend(campaign._id.toString(), ["sending"], unheldSince);
        if (claimed) logger.info(`Resumed the stalled send of campaign ${campaign._id}`);
    }
}
