import {getLogger} from "@coreModule/loggers/serverLog";
import {CircuitBreaker} from "@coreModule/utilities/circuitBreaker";
import type {LlmPort} from "@swissOutreachModule/utilities/ports";
import {getSwissOutreachConfig} from "@swissOutreachModule/utilities/config";

const logger = getLogger("swissOutreach.llm");

/** The LLM failing again and again (down, overloaded) fails the next calls fast; callers fall back to heuristics (BE-09). */
export const llmCircuitBreaker = new CircuitBreaker({name: "swissOutreach.llm", logger});

/** The JSON in a model's answer: the whole text, or the first `{…}` in it. Unknown until the caller checks its shape. */
function extractJsonObject(text: string): unknown {
    const trimmed = text.trim();
    try {
        return JSON.parse(trimmed);
    } catch {
        const match = trimmed.match(/\{[\s\S]*\}/);
        if (!match) throw new Error("LLM response did not contain JSON");
        return JSON.parse(match[0]);
    }
}

export class OpenAiCompatibleLlm implements LlmPort {
    async completeJson(system: string, user: string): Promise<unknown> {
        const text = await this.completeText(system, `${user}\n\nRespond with JSON only.`);
        return extractJsonObject(text);
    }

    async completeText(system: string, user: string): Promise<string> {
        const config = getSwissOutreachConfig();
        try {
            return await llmCircuitBreaker.execute(async () => {
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), config.requestTimeoutMs);
                try {
                    if (config.llmProvider === "ollama" && !config.llmApiKey) {
                        return await this.callOllama(system, user, controller.signal);
                    }
                    return await this.callOpenAi(system, user, controller.signal);
                } finally {
                    clearTimeout(timer);
                }
            });
        } catch (err) {
            logger.warn(`LLM call failed: ${err instanceof Error ? err.message : String(err)}`);
            throw err;
        }
    }

    private async callOpenAi(system: string, user: string, signal: AbortSignal): Promise<string> {
        const config = getSwissOutreachConfig();
        const base = config.llmBaseUrl.replace(/\/$/, "");
        const url = base.includes("/v1") ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...(config.llmApiKey ? {Authorization: `Bearer ${config.llmApiKey}`} : {}),
            },
            body: JSON.stringify({
                model: config.llmModel,
                temperature: 0.3,
                messages: [
                    {role: "system", content: system},
                    {role: "user", content: user},
                ],
            }),
            signal,
        });
        if (!response.ok) throw new Error(`OpenAI-compatible LLM HTTP ${response.status}`);
        const json: {choices?: Array<{message?: {content?: unknown}}>} | null = await response.json();
        const content = json?.choices?.[0]?.message?.content;
        if (typeof content !== "string" || !content) throw new Error("Empty LLM content");
        return content;
    }

    private async callOllama(system: string, user: string, signal: AbortSignal): Promise<string> {
        const config = getSwissOutreachConfig();
        const url = `${config.llmBaseUrl.replace(/\/$/, "")}/api/chat`;
        const response = await fetch(url, {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({
                model: config.llmModel,
                stream: false,
                messages: [
                    {role: "system", content: system},
                    {role: "user", content: user},
                ],
                options: {temperature: 0.3},
            }),
            signal,
        });
        if (!response.ok) throw new Error(`Ollama HTTP ${response.status}`);
        const json: {message?: {content?: unknown}} | null = await response.json();
        const content = json?.message?.content;
        if (typeof content !== "string" || !content) throw new Error("Empty Ollama content");
        return content;
    }
}

export const openAiCompatibleLlm = new OpenAiCompatibleLlm();
