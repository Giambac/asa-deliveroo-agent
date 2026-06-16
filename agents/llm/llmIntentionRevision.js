import { generateOptions } from "../agent/options.js";
import { Intention } from "../agent/intention.js";

const LLM_DECISION_INTERVAL_MS = 2500;

export class LlmIntentionRevision {
  current = null;
  deciding = false;
  lastDecisionAt = 0;

  constructor(context, decisionMaker) {
    this.context = context;
    this.decisionMaker = decisionMaker;
  }

  reconsiderSoon() {
    void this.reconsider();
  }

  async reconsider() {
    if (this.deciding) return;

    const options = generateOptions(this.context.beliefs);
    if (!options.length) return;

    const bestHeuristic = options[0];
    const currentAction = this.current?.predicate.at(0);
    const nextAction = bestHeuristic.predicate.at(0);

    if (currentAction === "go_explore" && nextAction === "go_explore") return;
    if (this.current?.samePredicate(bestHeuristic.predicate)) return;

    const now = Date.now();
    const shouldUseLlm =
      nextAction !== "go_explore" ||
      now - this.lastDecisionAt >= LLM_DECISION_INTERVAL_MS;

    this.deciding = true;
    try {
      const decision = shouldUseLlm
        ? await this.decisionMaker.chooseOption(this.context.beliefs, options)
        : { option: bestHeuristic, source: "heuristic", reason: "decision interval" };

      this.lastDecisionAt = Date.now();
      if (!decision?.option) return;

      this.start(decision.option, decision);
    } finally {
      this.deciding = false;
    }
  }

  start(option, decision) {
    if (this.current?.samePredicate(option.predicate)) return;

    const currentAction = this.current?.predicate.at(0);
    const nextAction = option.predicate.at(0);
    if (currentAction === "go_explore" && nextAction === "go_explore") return;

    this.current?.stop();
    this.current = new Intention(option.predicate, this.context, option);
    const launched = this.current;
    this.context.metrics.intentionsStarted += 1;

    console.log(
      "llm selected:",
      option.reason,
      `via=${decision.source}`,
      `utility=${option.utility.toFixed(1)}`,
      `why=${decision.reason}`
    );

    launched
      .achieve()
      .then(() => {
        this.context.metrics.intentionsSucceeded += 1;
      })
      .catch((error) => {
        this.context.metrics.intentionsFailed += 1;
        console.log("llm intention failed:", error);
      })
      .finally(() => {
        if (this.current === launched) this.current = null;
      });
  }
}
