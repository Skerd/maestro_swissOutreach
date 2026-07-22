import Campaign from "@swissOutreachModule/database/schemas/campaign/campaign";

const abortControllers = new Map<string, AbortController>();

export function getCampaignAbortSignal(campaignId: string): AbortSignal {
    let controller = abortControllers.get(campaignId);
    if (!controller) {
        controller = new AbortController();
        abortControllers.set(campaignId, controller);
    }
    return controller.signal;
}

export function abortCampaign(campaignId: string): void {
    const existing = abortControllers.get(campaignId);
    if (existing) {
        existing.abort();
        abortControllers.delete(campaignId);
    }
    // Fresh controller for a future restart.
    abortControllers.set(campaignId, new AbortController());
}

export function clearCampaignAbort(campaignId: string): void {
    abortControllers.delete(campaignId);
}

export async function isCampaignCancelled(campaignId: string): Promise<boolean> {
    const campaign = await Campaign.findById(campaignId).select("status").lean();
    return campaign?.status === "cancelled";
}

export class CampaignCancelledError extends Error {
    constructor(campaignId: string) {
        super(`Campaign ${campaignId} was cancelled`);
        this.name = "CampaignCancelledError";
    }
}

export async function throwIfCancelled(campaignId: string, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted || (await isCampaignCancelled(campaignId))) {
        throw new CampaignCancelledError(campaignId);
    }
}
