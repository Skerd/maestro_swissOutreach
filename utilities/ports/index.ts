import type {ParsedJob} from "armonia/src/modules/swissOutreach/types/parsedJob";

export type RegistryCompany = {
    companyName: string;
    uid?: string;
    canton?: string;
    legalForm?: string;
    registerUrl?: string;
    purpose?: string;
};

export type CompanySearchQuery = {
    keywords: string[];
    cantons: string[];
    companyName?: string;
    maxResults: number;
    language?: string;
};

export interface CompanyRegistryPort {
    search(query: CompanySearchQuery): Promise<RegistryCompany[]>;
}

export type WebSearchResult = {
    title: string;
    url: string;
    snippet?: string;
};

export interface WebSearchPort {
    search(query: string, limit?: number): Promise<WebSearchResult[]>;
}

export type CrawlPage = {
    url: string;
    html: string;
};

export type CrawlResult = {
    pages: CrawlPage[];
    emails: string[];
    phones: string[];
    city?: string;
    postalCode?: string;
    languages: string[];
    services: string[];
    textBlob: string;
};

export interface WebsiteFetchPort {
    discoverWebsite(companyName: string, canton?: string): Promise<{url?: string; confidence: number}>;
    crawl(websiteUrl: string, signal?: AbortSignal): Promise<CrawlResult>;
}

export interface LlmPort {
    completeJson<T>(system: string, user: string): Promise<T>;
    completeText(system: string, user: string): Promise<string>;
}

export type MailSendRequest = {
    companyId: string;
    to: string;
    subject: string;
    text: string;
    fromEmail: string;
    fromName: string;
    replyTo?: string;
};

export type MailSendResult = {
    messageId?: string;
    accepted: boolean;
};

export interface MailPort {
    send(request: MailSendRequest): Promise<MailSendResult>;
}

export type JobParserPort = {
    parse(jobDescription: string, language: string): Promise<ParsedJob>;
};
