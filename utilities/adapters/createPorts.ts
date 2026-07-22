/**
 * Composition root for swissOutreach ports — single place to swap adapters.
 */
import type {
    CompanyRegistryPort,
    LlmPort,
    MailPort,
    WebsiteFetchPort,
    WebSearchPort,
} from "@swissOutreachModule/utilities/ports";
import {zefixRestClient} from "@swissOutreachModule/utilities/adapters/zefixRestClient";
import {
    cantonCommercialRegisterClient,
    CompositeCompanyRegistry,
} from "@swissOutreachModule/utilities/adapters/cantonRegisterClient";
import {openAiCompatibleLlm} from "@swissOutreachModule/utilities/adapters/llmClient";
import {createWebSearchPort} from "@swissOutreachModule/utilities/adapters/webSearch";
import {HttpWebsiteFetcher} from "@swissOutreachModule/utilities/adapters/websiteFetcher";
import {createMailPort} from "@swissOutreachModule/utilities/adapters/mailProviderFactory";

export type SwissOutreachPorts = {
    registry: CompanyRegistryPort;
    webSearch: WebSearchPort;
    website: WebsiteFetchPort;
    llm: LlmPort;
    mail: MailPort;
};

export function createSwissOutreachPorts(): SwissOutreachPorts {
    const webSearch = createWebSearchPort();
    return {
        registry: new CompositeCompanyRegistry(zefixRestClient, cantonCommercialRegisterClient),
        webSearch,
        website: new HttpWebsiteFetcher(webSearch),
        llm: openAiCompatibleLlm,
        mail: createMailPort(),
    };
}
