import {getLogger} from "@coreModule/loggers/serverLog";

const logger = getLogger("swissOutreach.metrics");

export type SwissOutreachMetricCounters = {
    campaignsStarted: number;
    companiesDiscovered: number;
    websitesFound: number;
    emailsDrafted: number;
    emailsSent: number;
    emailsFailed: number;
    pipelineErrors: number;
};

const counters: SwissOutreachMetricCounters = {
    campaignsStarted: 0,
    companiesDiscovered: 0,
    websitesFound: 0,
    emailsDrafted: 0,
    emailsSent: 0,
    emailsFailed: 0,
    pipelineErrors: 0,
};

export function incrementMetric(key: keyof SwissOutreachMetricCounters, by = 1): void {
    counters[key] += by;
    logger.debug(`metric ${key}=${counters[key]}`);
}

export function getSwissOutreachMetrics(): SwissOutreachMetricCounters {
    return {...counters};
}

export function resetSwissOutreachMetricsForTests(): void {
    for (const key of Object.keys(counters) as (keyof SwissOutreachMetricCounters)[]) {
        counters[key] = 0;
    }
}
