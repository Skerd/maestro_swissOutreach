import {KAFKA} from "@coreModule/environment";
import {addKafkaTopicConsumer} from "@coreModule/kafka/kafkaConsumer";
import {getLogger, serverLogger} from "@coreModule/loggers/serverLog";
import type {SwissOutreachPipelineEvent} from "@swissOutreachModule/kafka/types";
import {campaignOrchestrator} from "@swissOutreachModule/utilities/pipeline/campaignOrchestrator";

const logger = getLogger("swissOutreach_kafka_consumer");

async function processPipelineEvent(event: SwissOutreachPipelineEvent): Promise<void> {
    try {
        if (event.action === "send_approved") {
            await campaignOrchestrator.sendApproved(event.campaignId, false);
            return;
        }
        await campaignOrchestrator.run(event.campaignId);
    } catch (error: any) {
        logger.err(`Failed swissOutreach pipeline event: ${error?.message || error}`);
        throw error;
    }
}

export async function startSwissOutreachKafkaConsumers(parentLogger?: serverLogger): Promise<void> {
    if (!KAFKA.ENABLED) {
        const log = getLogger("swissOutreach_kafka_consumers", parentLogger);
        log.warn("Kafka is disabled; skipping swissOutreach consumers.");
        return;
    }

    const umbrellaLog = getLogger("swissOutreach_kafka_consumers", parentLogger);
    umbrellaLog.start("Starting swissOutreach Kafka consumers");

    try {
        await addKafkaTopicConsumer(parentLogger, {
            registryKey: "swissOutreachPipeline",
            displayName: "Swiss outreach pipeline",
            groupId: KAFKA.CONSUMER_GROUP.SWISS_OUTREACH_PIPELINE,
            topic: KAFKA.TOPICS.SWISS_OUTREACH_PIPELINE,
            expectedEventType: "swiss_outreach_pipeline",
            processEvent: (d) => processPipelineEvent(d as SwissOutreachPipelineEvent),
        });
    } catch (err: any) {
        umbrellaLog.err(`swissOutreach Kafka consumer failed: ${err?.message}`);
    }

    umbrellaLog.finish("swissOutreach Kafka consumers startup pass complete");
}
