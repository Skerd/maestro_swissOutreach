import type {ParsedJob} from "armonia/src/modules/swissOutreach/types/parsedJob";
import {
    JOB_PARSE_SYSTEM_PROMPT,
    buildJobParseUserPrompt,
} from "armonia/src/modules/swissOutreach/prompts/outreachPrompts";
import type {JobParserPort, LlmPort} from "@swissOutreachModule/utilities/ports";
import {heuristicParseJob} from "@swissOutreachModule/utilities/scoring/scoreProspect";
import {getLogger} from "@coreModule/loggers/serverLog";

const logger = getLogger("swissOutreach.jobParser");

/** The text items of a list the model answered; anything that is not non-empty text is dropped. */
function textList(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim() !== "") : [];
}

/** The model's answer as a parsed job, or null when it has no keywords to search with. */
function parsedJobOf(answer: unknown): ParsedJob | null {
    if (typeof answer !== "object" || answer === null) return null;
    const job: {[K in keyof ParsedJob]?: unknown} = answer;
    const keywords = textList(job.keywords);
    if (keywords.length === 0) return null;
    return {
        industry: typeof job.industry === "string" && job.industry ? job.industry : "Unknown",
        companyTypes: textList(job.companyTypes),
        synonyms: textList(job.synonyms),
        germanEquivalents: textList(job.germanEquivalents),
        frenchEquivalents: textList(job.frenchEquivalents),
        italianEquivalents: textList(job.italianEquivalents),
        nogaCategories: textList(job.nogaCategories),
        keywords,
    };
}

export class JobParser implements JobParserPort {
    constructor(private readonly llm: LlmPort) {}

    async parse(jobDescription: string, language: string): Promise<ParsedJob> {
        try {
            const answer = await this.llm.completeJson(
                JOB_PARSE_SYSTEM_PROMPT,
                buildJobParseUserPrompt(jobDescription, language),
            );
            return parsedJobOf(answer) ?? heuristicParseJob(jobDescription);
        } catch (err) {
            logger.warn(`Job parse LLM failed, using heuristic: ${err instanceof Error ? err.message : String(err)}`);
            return heuristicParseJob(jobDescription);
        }
    }
}
