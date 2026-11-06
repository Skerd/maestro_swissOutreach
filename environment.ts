/** swissOutreach's Kafka names (D67: core names no vertical). */
export const SWISS_OUTREACH_KAFKA = {
    TOPIC: process.env.KAFKA_TOPIC_SWISS_OUTREACH_PIPELINE || "swissOutreach.pipeline",
    CONSUMER_GROUP: process.env.KAFKA_CONSUMER_GROUP_SWISS_OUTREACH_PIPELINE || "SWISS_OUTREACH_PIPELINE",
};
