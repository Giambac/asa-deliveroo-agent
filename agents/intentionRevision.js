import { Intention } from "./intention.js";
import { generateOptions } from "./options.js";

const SWITCH_UTILITY_MARGIN = 3;

export class IntentionRevisionRevise {
  current = null;
  queue = [];

  constructor(context) {
    this.context = context;
  }

  reconsider() {
    const options = generateOptions(this.context.beliefs);
    this.queue = options.slice(1);

    const bestOption = options.at(0);
    if (!bestOption) return;

    if (this.current?.samePredicate(bestOption.predicate)) return;
    const currentAction = this.current?.predicate.at(0);
    const nextAction = bestOption.predicate.at(0);
    if (currentAction === "go_explore" && nextAction === "go_explore") return;

    const shouldKeepCurrent =
      this.current?.option &&
      currentAction === nextAction &&
      bestOption.utility < this.current.option.utility + SWITCH_UTILITY_MARGIN;
    if (shouldKeepCurrent) return;

    this.current?.stop();
    this.current = new Intention(bestOption.predicate, this.context, bestOption);
    const launched = this.current;
    this.context.metrics.intentionsStarted += 1;
    console.log("selected option:", bestOption.reason, "utility", bestOption.utility.toFixed(1));

    launched
      .achieve()
      .then(() => {
        this.context.metrics.intentionsSucceeded += 1;
      })
      .catch((error) => {
        this.context.metrics.intentionsFailed += 1;
        console.log("intention failed:", error);
      })
      .finally(() => {
        if (this.current === launched) this.current = null;
      });
  }
}

export const IntentionRevisionReplace = IntentionRevisionRevise;
