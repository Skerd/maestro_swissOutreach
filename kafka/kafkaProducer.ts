import {KAFKA} from "@coreModule/environment";
import {publishEvent} from "@coreModule/kafka/kafkaProducer";
import {getLogger} from "@coreModule/loggers/serverLog";
import type {SwissOutreachPipelineEvent} from "@swissOutreachModule/kafka/types";

const logger = getLogger("swissOutreach_kafka_producer");

export function publishSwissOutreachPipelineEvent(
    params: Omit<SwissOutreachPipelineEvent, "eventType" | "timestamp"> & {timestamp?: number},
): Promise<boolean> {
    const event: SwissOutreachPipelineEvent = {
        eventType: "swiss_outreach_pipeline",
        campaignId: params.campaignId,
        companyId: params.companyId,
        action: params.action,
        timestamp: params.timestamp ?? Date.now(),
    };

    return publishEvent(KAFKA.TOPICS.SWISS_OUTREACH_PIPELINE, params.campaignId, event, logger);
}
