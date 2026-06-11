import { keyOf } from '../utils/serialization.js';
import { DELIVEROO_DOMAIN, DOMAIN_NAME, ACTION_TO_DIRECTION } from './pddlDomain.js';

/**
 * Wrapper around the online PDDL solver (@unitn-asa/pddl-client).
 *
 * Role in the architecture: the PDDL planner is a *plan library member*.
 * The `go_to` intention can be served either by the fast BFS plan or by a
 * PDDL plan generated from current beliefs — both produce the same kind
 * of deterministic move sequence, executed by the same ActionExecutor.
 * This keeps PDDL meaningful (it genuinely plans the means of an
 * intention) without putting a slow network call in the outer loop.
 *
 * The integration is optional at runtime: when PDDL_ENABLED is false or
 * the pddl-client package / solver is unavailable, agents silently fall
 * back to BFS. Every call and failure is logged for the report.
 */
export class PddlPlanner {
  /**
   * @param {object} deps
   * @param {import('../core/BeliefBase.js').BeliefBase} deps.beliefs
   * @param {object} deps.config full runtime config (reads config.pddl)
   * @param {import('../metrics/MetricsCollector.js').MetricsCollector} [deps.metrics]
   * @param {import('../metrics/RunLogger.js').RunLogger} [deps.logger]
   */
  constructor({ beliefs, config, metrics = null, logger = null }) {
    this.beliefs = beliefs;
    this.config = config;
    this.metrics = metrics;
    this.logger = logger;
    this.#solver = null;
  }

  #solver;

  isEnabled() {
    return !!this.config.pddl?.enabled;
  }

  /**
   * Plan a move sequence from `from` to `to` using the online solver.
   * @returns {Promise<string[]>} directions ('up'|'down'|'left'|'right')
   * @throws on solver failure / unreachable target / oversized problem
   */
  async planPath(from, to) {
    this.metrics?.increment('plannerCalls');
    const startedAt = Date.now();
    try {
      const problem = this.buildProblem(from, to);
      const solver = await this.#loadSolver();
      const steps = await solver(DELIVEROO_DOMAIN, problem);
      if (!steps || steps.length === 0) {
        throw new Error('solver returned no plan');
      }
      const directions = steps
        .map((s) => ACTION_TO_DIRECTION[String(s.action).toLowerCase()])
        .filter(Boolean);
      this.logger?.log('pddl_plan', {
        from, to,
        steps: directions.length,
        durationMs: Date.now() - startedAt,
      });
      return directions;
    } catch (error) {
      this.metrics?.increment('plannerFailures');
      this.logger?.log('pddl_failure', {
        from, to,
        error: String(error?.message ?? error),
        durationMs: Date.now() - startedAt,
      });
      throw error;
    }
  }

  /**
   * Generate a PDDL problem string from current beliefs: the reachable
   * region around the agent becomes the object set, allowed movements
   * become directed edge predicates.
   */
  buildProblem(from, to) {
    const graph = this.beliefs.graph;
    if (!graph) throw new Error('map not loaded yet');

    const startKey = keyOf(from.x, from.y);
    const goalKey = keyOf(to.x, to.y);
    const maxTiles = this.config.pddl?.maxTiles ?? 1600;

    // Reachable region BFS (static blocks respected, soft blocks ignored:
    // a PDDL plan is meant to be re-validated during execution anyway).
    const region = new Set([startKey]);
    const queue = [startKey];
    let head = 0;
    while (head < queue.length && region.size <= maxTiles) {
      const key = queue[head++];
      const { x, y } = graph.tiles.get(key);
      for (const edge of graph.neighbors(x, y, false)) {
        if (!region.has(edge.key)) {
          region.add(edge.key);
          queue.push(edge.key);
        }
      }
    }
    if (region.size > maxTiles) throw new Error(`problem too large (> ${maxTiles} tiles)`);
    if (!region.has(goalKey)) throw new Error(`target ${goalKey} unreachable from ${startKey}`);

    const objectOf = (key) => `t_${key.replace(',', '_')}`;
    const objects = [...region].map(objectOf).join(' ');

    const init = [`(at ${objectOf(startKey)})`];
    for (const key of region) {
      const { x, y } = graph.tiles.get(key);
      for (const edge of graph.neighbors(x, y, false)) {
        if (!region.has(edge.key)) continue;
        init.push(`(${edge.direction} ${objectOf(key)} ${objectOf(edge.key)})`);
      }
    }

    return `
(define (problem deliveroo-path)
  (:domain ${DOMAIN_NAME})
  (:objects ${objects})
  (:init ${init.join(' ')})
  (:goal (at ${objectOf(goalKey)}))
)
`.trim();
  }

  /** Lazy-load the solver so missing deps only matter when PDDL is used. */
  async #loadSolver() {
    if (this.#solver) return this.#solver;
    try {
      const { onlineSolver } = await import('@unitn-asa/pddl-client');
      this.#solver = onlineSolver;
      return this.#solver;
    } catch {
      throw new Error('@unitn-asa/pddl-client not installed — run npm install or set PDDL_ENABLED=false');
    }
  }
}
