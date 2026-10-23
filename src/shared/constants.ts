export const RULESET_VERSION = 2;

export const CHANNEL_CARDS = "otto.cards";
export const CHANNEL_ADVISOR = "otto.advisor";
export const CHANNEL_BAKEOFF = "otto.bakeoff";
export const CHANNEL_GUARD = "otto.guard";
export const CHANNEL_PIPELINE = "otto.pipeline";

export const CLAIM_TEXT_CAP = 4000;
export const COMMAND_CAP = 2000;
export const OUTPUT_TAIL_CAP = 1500;
export const EVIDENCE_CAP = 60;
export const FINDINGS_CAP = 100;

// The server rejects limit > 100 with HTTP 400 (found live at M2), so ask for exactly 100.
export const EVENTS_PAGE_LIMIT = 100;
export const EVENTS_MAX_PAGES = 50;
