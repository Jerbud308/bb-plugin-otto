// Advisor: a hidden agent thread that judges whether a card's evidence is enough (BUILD_SPEC 13).
import { randomBytes } from "node:crypto";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { buildAdvisorPrompt, parseAdvisorText } from "../proof/advisor";
import { CHANNEL_ADVISOR } from "../shared/constants";
import type { AdvisorReview } from "../shared/contract";
import type { OttoStore } from "./db";
import type { OttoSettings } from "./state";

export const OPERATOR_ONLY_ADVISOR = "Advisor needs Operator mode. Change Mode in Settings, Installed plugins, Otto.";

const EVENTS_PAGE = "100";
const EVENTS_MAX_PAGES = 50;

export function randomId(prefix: string): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = randomBytes(10);
  return prefix + Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

export interface Advisor {
  request(cardId: string): Promise<{ reviewId: string }>;
  // Returns true when the thread was an advisor thread that Otto handled.
  handleIdle(threadId: string, lastAssistantText: string | null): Promise<boolean>;
  handleFailed(threadId: string, error: string | null): Promise<boolean>;
  sweepTimeouts(): Promise<number>;
  assertOperator(): Promise<void>;
}

export function createAdvisor(
  bb: BbPluginApi,
  store: OttoStore,
  getSettings: () => Promise<OttoSettings>,
  now: () => number = () => Date.now(),
): Advisor {
  const publish = (r: AdvisorReview): void => {
    bb.realtime.publish(CHANNEL_ADVISOR, { cardId: r.cardId, reviewId: r.id });
  };

  // Hidden threads keep running until stopped: always archive, then stop, each in its own try.
  async function release(threadId: string): Promise<void> {
    try {
      await bb.sdk.threads.archive({ threadId });
    } catch (cause) {
      bb.log.warn(`advisor archive failed for ${threadId}: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
    try {
      await bb.sdk.threads.stop({ threadId });
    } catch (cause) {
      bb.log.warn(`advisor stop failed for ${threadId}: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }

  // True when the advisor thread changed any file (its review is then invalid).
  async function advisorChangedFiles(threadId: string): Promise<boolean> {
    let last = 0;
    for (let page = 0; page < EVENTS_MAX_PAGES; page++) {
      const batch = await bb.sdk.threads.events.list({
        threadId,
        types: ["item/completed"] as const,
        afterSeq: String(last),
        limit: EVENTS_PAGE,
        order: "asc",
      });
      if (batch.length === 0) return false;
      for (const row of batch) {
        if (row.seq > last) last = row.seq;
        const item = (row.data as { item?: { type?: unknown } } | undefined)?.item;
        if (item?.type === "fileChange") return true;
      }
    }
    return false;
  }

  async function finish(review: AdvisorReview, patch: Partial<AdvisorReview>): Promise<void> {
    store.updateReview(review.id, { ...patch, finishedAt: now() });
    const fresh = store.getReview(review.id);
    if (fresh) publish(fresh);
  }

  async function finalize(review: AdvisorReview, text: string | null): Promise<void> {
    const advisorThreadId = review.advisorThreadId;
    try {
      const answer = parseAdvisorText(text ?? "");
      if (answer) {
        await finish(review, {
          status: "done",
          sufficient: answer.sufficient,
          confidence: answer.confidence,
          missing: answer.missing,
          suggestedCheck: answer.suggestedCheck === "" ? null : answer.suggestedCheck,
          reasoning: answer.reasoning,
        });
      } else {
        await finish(review, { status: "unparseable", rawText: (text ?? "").slice(0, 8000) });
      }
      if (advisorThreadId !== null && (await advisorChangedFiles(advisorThreadId))) {
        store.updateReview(review.id, { tainted: true });
        const fresh = store.getReview(review.id);
        if (fresh) publish(fresh);
      }
    } finally {
      if (advisorThreadId !== null) await release(advisorThreadId);
    }
  }

  return {
    async assertOperator() {
      const s = await getSettings();
      if (s.mode !== "operator") throw new Error(OPERATOR_ONLY_ADVISOR);
    },

    async request(cardId) {
      const settings = await getSettings();
      if (settings.mode !== "operator") throw new Error(OPERATOR_ONLY_ADVISOR);
      const card = store.getCard(cardId);
      if (!card) throw new Error("Card not found.");
      const running = store.runningReviewForCard(cardId);
      if (running) return { reviewId: running.id };

      const thread = await bb.sdk.threads.get({ threadId: card.threadId });
      const environmentId = thread.environmentId;
      if (!environmentId) throw new Error("This thread has no workspace to review.");

      const review: AdvisorReview = {
        id: randomId("rev_"),
        cardId: card.id,
        threadId: card.threadId,
        advisorThreadId: null,
        providerId: settings.advisorProviderId,
        model: settings.advisorModel === "" ? null : settings.advisorModel,
        status: "running",
        sufficient: null,
        confidence: null,
        missing: [],
        suggestedCheck: null,
        reasoning: null,
        rawText: null,
        tainted: false,
        createdAt: now(),
        finishedAt: null,
      };
      store.insertReview(review);
      publish(review);
      try {
        // No parentThreadId: a hidden child would report into the user's thread.
        const advisor = await bb.sdk.threads.spawn({
          projectId: card.projectId,
          environment: { type: "reuse", environmentId },
          providerId: settings.advisorProviderId,
          ...(settings.advisorModel ? { model: settings.advisorModel } : {}),
          title: `Otto advisor: ${card.threadTitle ?? card.threadId}`.slice(0, 120),
          visibility: "hidden",
          prompt: buildAdvisorPrompt(card),
          pluginMetadata: { ottoRole: "advisor", reviewId: review.id, cardId: card.id },
        });
        store.updateReview(review.id, { advisorThreadId: advisor.id });
        publish({ ...review, advisorThreadId: advisor.id });
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        await finish(review, { status: "failed", rawText: message });
      }
      return { reviewId: review.id };
    },

    async handleIdle(threadId, lastAssistantText) {
      const review = store.reviewByAdvisorThread(threadId);
      if (!review) return false;
      if (review.status !== "running") return true; // already finalized; the event overlapped
      await finalize(review, lastAssistantText);
      return true;
    },

    async handleFailed(threadId, error) {
      const review = store.reviewByAdvisorThread(threadId);
      if (!review) return false;
      if (review.status !== "running") return true;
      try {
        await finish(review, { status: "failed", rawText: error ?? "The advisor thread failed." });
      } finally {
        await release(threadId);
      }
      return true;
    },

    async sweepTimeouts() {
      const { advisorTimeoutMinutes } = await getSettings();
      const stale = store.runningReviewsOlderThan(now() - advisorTimeoutMinutes * 60_000);
      for (const review of stale) {
        try {
          await finish(review, { status: "timed_out" });
        } finally {
          if (review.advisorThreadId !== null) await release(review.advisorThreadId);
        }
      }
      return stale.length;
    },
  };
}
