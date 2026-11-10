import type {FilterQuery} from "mongoose";
import {BaseCrudService} from "@coreModule/database/services/baseCrudService";
import type {CampaignStatusValue} from "armonia/src/modules/swissOutreach/types/constants";
import Campaign, {ICampaign} from "./campaign";

/** How long a run or send may go without renewing its lease before another worker may take the campaign over. */
export const CAMPAIGN_LEASE_MS = 5 * 60 * 1000;

/** Matches a campaign nobody holds at `now`: it has no lease, or its lease has run out. */
export function withoutLiveLease(now: Date): FilterQuery<ICampaign> {
    return {"lease.until": {$not: {$gt: now}}};
}

export class CampaignService extends BaseCrudService<ICampaign, typeof Campaign> {
    constructor() {
        super(Campaign, "SwissOutreachCampaign");
    }

    /** The campaign with only the `select`ed fields, as a plain object. */
    findByIdLean(campaignId: string, select: string) {
        return this.model.findById(campaignId).select(select).lean();
    }

    /** Marks the campaign cancelled and returns it. */
    markCancelled(campaignId: string) {
        return this.model.findByIdAndUpdate(campaignId, {$set: {status: "cancelled"}}, {new: true});
    }

    /**
     * Claims a pipeline run: moves the campaign to `parsing` only while it is still in one of `from` (and matches
     * `extra`), in one write. Two triggers racing for the same campaign get it once; the loser gets null.
     */
    claimRun(campaignId: string, from: CampaignStatusValue[], extra: FilterQuery<ICampaign> = {}) {
        return this.claim(campaignId, from, "parsing", extra);
    }

    /** Claims a send the same way: moves the campaign to `sending` only while it is still in one of `from`. */
    claimSend(campaignId: string, from: CampaignStatusValue[], extra: FilterQuery<ICampaign> = {}) {
        return this.claim(campaignId, from, "sending", extra);
    }

    /**
     * Takes the campaign's lease for `holder` in one write, while the campaign matches `filter` and nobody else holds a
     * live lease (the holder's own lease is renewed). Returns null when another worker holds it.
     */
    acquireLease(campaignId: string, holder: string, leaseMs: number, filter: FilterQuery<ICampaign>) {
        const now = new Date();
        return this.model.findOneAndUpdate(
            {...filter, _id: campaignId, $or: [withoutLiveLease(now), {"lease.holder": holder}]},
            {$set: {lease: {holder, until: new Date(now.getTime() + leaseMs)}}},
            {new: true},
        ).noDeleted();
    }

    /** Extends the holder's lease; false when the holder no longer has it (it ran out and another worker took it). */
    async renewLease(campaignId: string, holder: string, leaseMs: number): Promise<boolean> {
        const renewed = await this.model.updateOne(
            {_id: campaignId, "lease.holder": holder},
            {$set: {"lease.until": new Date(Date.now() + leaseMs)}},
        );
        return renewed.matchedCount > 0;
    }

    /** Gives the lease up, if the holder still has it. */
    async releaseLease(campaignId: string, holder: string): Promise<void> {
        await this.model.updateOne({_id: campaignId, "lease.holder": holder}, {$unset: {lease: ""}});
    }

    private claim(campaignId: string, from: CampaignStatusValue[], to: CampaignStatusValue, extra: FilterQuery<ICampaign>) {
        return this.model.findOneAndUpdate(
            {...extra, _id: campaignId, status: {$in: from}},
            {$set: {status: to}, $unset: {lastError: ""}},
            {new: true},
        ).noDeleted();
    }
}

export const campaignService = new CampaignService();
