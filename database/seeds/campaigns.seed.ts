/**
 * Swiss outreach campaigns.
 *
 * GENERATED from the live database — regenerate with tools/genSwissOutreach.js rather
 * than hand-editing. Sender identity is the `Test Company` placeholder throughout.
 */
import type {CampaignSeedRow} from "./types";

export const campaignsSeed: readonly CampaignSeedRow[] = [
    {
        "id": "6a604ae47e5c12f7ab9d86cc",
        "jobDescription": "I need to find electrician that can lay the whole electrical work in the 120msq unit.",
        "country": "Switzerland",
        "cantons": [
            "BS",
            "BL"
        ],
        "maxCompanies": 20,
        "language": "en",
        "emailTone": "professional",
        "sendAutomatically": false,
        "senderCompanyName": "Test Company",
        "senderName": "Test User",
        "senderEmail": "test@test.com",
        "senderPhone": "+23322323",
        "senderWebsite": "http://test.com",
        "additionalNotes": "aSDJALDSKA :dkal; klkdalsd ",
        "status": "cancelled",
        "parsedJob": {
            "industry": "electrician",
            "companyTypes": [
                "GmbH",
                "AG",
                "SA",
                "Sagl"
            ],
            "synonyms": [
                "electrician",
                "Elektro",
                "Elektroinstallationen",
                "installation électrique",
                "elettricista"
            ],
            "germanEquivalents": [
                "Elektro",
                "Elektroinstallationen"
            ],
            "frenchEquivalents": [
                "installation électrique"
            ],
            "italianEquivalents": [
                "elettricista"
            ],
            "nogaCategories": [],
            "keywords": [
                "electrician",
                "Elektro",
                "Elektroinstallationen",
                "installation électrique",
                "elettricista"
            ]
        },
        "stats": {
            "found": 3,
            "enriched": 3,
            "scored": 3,
            "approved": 0,
            "sent": 0,
            "failed": 0
        }
    },
    {
        "id": "6a604d7d31c32b576e5bb709",
        "jobDescription": "I need electrical done to install 100m of neon lighting",
        "country": "Switzerland",
        "cantons": [
            "BS",
            "BL",
            "AG"
        ],
        "maxCompanies": 20,
        "language": "de",
        "emailTone": "professional",
        "sendAutomatically": false,
        "senderCompanyName": "Test Company",
        "senderName": "Test Company",
        "senderEmail": "test@test.com",
        "senderPhone": "+12312",
        "senderWebsite": "http://test.com",
        "additionalNotes": "ASDASD ASD ASD ",
        "status": "awaiting_approval",
        "parsedJob": {
            "industry": "electrician",
            "companyTypes": [
                "GmbH",
                "AG",
                "SA",
                "Sagl"
            ],
            "synonyms": [
                "electrician",
                "Elektro",
                "Elektroinstallationen",
                "installation électrique",
                "elettricista"
            ],
            "germanEquivalents": [
                "Elektro",
                "Elektroinstallationen"
            ],
            "frenchEquivalents": [
                "installation électrique"
            ],
            "italianEquivalents": [
                "elettricista"
            ],
            "nogaCategories": [],
            "keywords": [
                "electrician",
                "Elektro",
                "Elektroinstallationen",
                "installation électrique",
                "elettricista"
            ]
        },
        "stats": {
            "found": 7,
            "enriched": 7,
            "scored": 7,
            "approved": 0,
            "sent": 0,
            "failed": 0
        }
    },
    {
        "id": "6a6051bc3512dbe4f4adf7f4",
        "jobDescription": "I need flooring work done. I need to lay about 300 square emters of wood flooring.",
        "country": "Switzerland",
        "cantons": [
            "BS",
            "BL"
        ],
        "maxCompanies": 20,
        "language": "de",
        "emailTone": "professional",
        "sendAutomatically": false,
        "senderCompanyName": "Test Company",
        "senderName": "Test User",
        "senderEmail": "test@test.com",
        "senderPhone": "+23322323",
        "senderWebsite": "http://test.com",
        "additionalNotes": "Please i need it asap",
        "status": "awaiting_approval",
        "parsedJob": {
            "industry": "flooring",
            "companyTypes": [
                "GmbH",
                "AG",
                "SA",
                "Sagl"
            ],
            "synonyms": [
                "flooring",
                "about",
                "square",
                "emters"
            ],
            "germanEquivalents": [],
            "frenchEquivalents": [],
            "italianEquivalents": [],
            "nogaCategories": [],
            "keywords": [
                "flooring",
                "about",
                "square",
                "emters"
            ]
        },
        "stats": {
            "found": 20,
            "enriched": 20,
            "scored": 20,
            "approved": 0,
            "sent": 0,
            "failed": 0
        }
    }
];
