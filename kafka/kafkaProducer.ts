import {getProducerInstance} from "@coreModule/connections/connectToKafka";
import {KAFKA} from "@coreModule/environment";
import {canPublish, publishWithRetry} from "@coreModule/kafka/kafkaProducer";
import {getLogger} from "@coreModule/loggers/serverLog";
import type {SwissOutreachPipelineEvent} from "@swissOutreachModule/kafka/types";

const logger = getLogger("swissOutreach_kafka_producer");

export async function publishSwissOutreachPipelineEvent(
    params: Omit<SwissOutreachPipelineEvent, "eventType" | "timestamp"> & {timestamp?: number},
): Promise<boolean> {
    if (!canPublish(logger)) {
        return false;
    }

    const producer = getProducerInstance();
    const topic = KAFKA.TOPICS.SWISS_OUTREACH_PIPELINE;
    if (!producer || !topic) {
        logger.warn("Kafka producer or swiss outreach topic not available");
        return false;
    }

    const event: SwissOutreachPipelineEvent = {
        eventType: "swiss_outreach_pipeline",
        campaignId: params.campaignId,
        companyId: params.companyId,
        action: params.action,
        timestamp: params.timestamp ?? Date.now(),
    };

    try {
        await publishWithRetry(
            topic,
            {
                key: params.campaignId,
                value: JSON.stringify(event),
                headers: {
                    "event-type": "swiss_outreach_pipeline",
                    timestamp: new Date(event.timestamp).toISOString(),
                },
            },
            KAFKA.PRODUCER_MAX_RETRIES,
            logger,
        );
        logger.debug(`Published swissOutreach pipeline event campaign=${params.campaignId} action=${params.action}`);
        return true;
    } catch (error: any) {
        logger.err(`Failed to publish swissOutreach pipeline event: ${error?.message || error}`);
        return false;
    }
}
