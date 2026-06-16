export class Intention {
  stopped = false;
  currentPlan = null;

  constructor(predicate, context, option = null) {
    this.predicate = predicate;
    this.context = context;
    this.option = option;
  }

  samePredicate(predicate) {
    return this.predicate.join(" ") === predicate.join(" ");
  }

  stop() {
    this.stopped = true;
    this.currentPlan?.stop();
  }

  async achieve() {
    for (const PlanClass of this.context.planLibrary) {
      if (this.stopped) throw "stopped";
      if (!PlanClass.isApplicableTo(...this.predicate)) continue;

      this.currentPlan = new PlanClass(this.context);
      console.log("achieving", this.predicate.join(" "), "with", PlanClass.name);

      try {
        return await this.currentPlan.execute(...this.predicate);
      } catch (error) {
        if (this.stopped) throw "stopped";
        this.context.metrics.planFailures += 1;
        console.log("plan failed:", PlanClass.name, error);
      }
    }

    throw `no applicable plan for ${this.predicate.join(" ")}`;
  }
}
