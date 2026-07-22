import type {ParsedJob} from "armonia/src/modules/swissOutreach/types/parsedJob";
import {
    JOB_PARSE_SYSTEM_PROMPT,
    buildJobParseUserPrompt,
} from "armonia/src/modules/swissOutreach/prompts/outreachPrompts";
import type {JobParserPort, LlmPort} from "@swissOutreachModule/utilities/ports";
import {heuristicParseJob} from "@swissOutreachModule/utilities/scoring/scoreProspect";
import {getLogger} from "@coreModule/loggers/serverLog";

const logger = getLogger("swissOutreach.jobParser");

export class JobParser implements JobParserPort {
    constructor(private readonly llm: LlmPort) {}

    async parse(jobDescription: string, language: string): Promise<ParsedJob> {
        try {
            const parsed = await this.llm.completeJson<ParsedJob>(
                JOB_PARSE_SYSTEM_PROMPT,
                buildJobParseUserPrompt(jobDescription, language),
            );
            if (!parsed?.keywords?.length) {
                return heuristicParseJob(jobDescription);
            }
            return {
                industry: parsed.industry || "Unknown",
                companyTypes: parsed.companyTypes || [],
                synonyms: parsed.synonyms || [],
                germanEquivalents: parsed.germanEquivalents || [],
                frenchEquivalents: parsed.frenchEquivalents || [],
                italianEquivalents: parsed.italianEquivalents || [],
                nogaCategories: parsed.nogaCategories || [],
                keywords: parsed.keywords,
            };
        } catch (err: any) {
            logger.warn(`Job parse LLM failed, using heuristic: ${err?.message || err}`);
            return heuristicParseJob(jobDescription);
        }
    }
}
