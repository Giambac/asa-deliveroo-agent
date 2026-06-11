import { MISSION_INTERPRETER_SYSTEM_PROMPT } from './prompts.js';
import { extractJsonObject } from '../utils/serialization.js';

/**
 * High-level mission interpretation: turns mission-agent messages into
 * the structured mission objects consumed by BeliefBase.setMission and
 * shared with the teammate via mission-update messages.
 *
 * Two paths:
 *  - LLM path (when a provider is configured): one prompt extracts kind,
 *    coordinates, bonus sign, thresholds. Output is validated before use.
 *  - Deterministic fallback: regex parsing covering the Challenge 2
 *    mission catalog (game_knowledge 04). Always used for RED/GREEN
 *    light state changes, which are latency-critical.
 *
 * The LLM never acts: it only produces a mission object that the
 * symbolic layer validates and applies.
 */

const VALID_KINDS = new Set([
  'go_to', 'deliver_at', 'question_answer', 'deliver_exactly_n',
  'deliver_less_value_than', 'one_pickup_another_deliver',
  'red_light_green_light', 'light_state', 'unknown',
]);

const NUMBER_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5 };

export class MissionInterpreter {
  /**
   * @param {object} deps
   * @param {import('./LlmClient.js').LlmClient|null} [deps.llmClient]
   * @param {import('../metrics/MetricsCollector.js').MetricsCollector} [deps.metrics]
   * @param {import('../metrics/RunLogger.js').RunLogger} [deps.logger]
   */
  constructor({ llmClient = null, metrics = null, logger = null }) {
    this.llmClient = llmClient;
    this.metrics = metrics;
    this.logger = logger;
  }

  /**
   * Interpret one incoming message.
   * @param {string} text   raw message content
   * @param {string} fromId sender agent id (the mission agent)
   * @returns {Promise<object>} structured mission ({kind: 'unknown'} when unparseable)
   */
  async interpret(text, fromId) {
    this.metrics?.increment('llmInterpretations');

    // Light-state switches must never wait for a network round-trip.
    const light = MissionInterpreter.parseLightState(text);
    if (light) return this.#finalize(light, text, fromId, 'fallback');

    if (this.llmClient?.isConfigured()) {
      try {
        const output = await this.llmClient.chat([
          { role: 'system', content: MISSION_INTERPRETER_SYSTEM_PROMPT },
          { role: 'user', content: text },
        ]);
        const mission = this.#validate(extractJsonObject(output));
        if (mission) return this.#finalize(mission, text, fromId, 'llm');
        this.logger?.log('llm_invalid_output', { output: output.slice(0, 500) });
      } catch (error) {
        this.logger?.log('llm_error', { error: String(error?.message ?? error) });
      }
    }

    return this.#finalize(MissionInterpreter.fallbackParse(text), text, fromId, 'fallback');
  }

  #finalize(mission, raw, fromId, source) {
    const result = { ...mission, raw, from: fromId, ts: Date.now(), source };
    this.logger?.log('mission_interpreted', result);
    return result;
  }

  /** Validate/coerce an LLM-produced mission object; null when unusable. */
  #validate(obj) {
    if (!obj || typeof obj !== 'object') return null;
    if (!VALID_KINDS.has(obj.kind)) return null;
    const targets = Array.isArray(obj.targets)
      ? obj.targets
          .filter((t) => Number.isFinite(Number(t?.x)) && Number.isFinite(Number(t?.y)))
          .map((t) => ({ x: Math.round(Number(t.x)), y: Math.round(Number(t.y)) }))
      : [];
    return {
      kind: obj.kind,
      targets,
      bonus: Number.isFinite(Number(obj.bonus)) ? Number(obj.bonus) : null,
      forbidden: obj.forbidden === true || (Number(obj.bonus) < 0),
      count: Number.isFinite(Number(obj.count)) ? Number(obj.count) : null,
      threshold: Number.isFinite(Number(obj.threshold)) ? Number(obj.threshold) : null,
      expression: typeof obj.expression === 'string' ? obj.expression : null,
      answer: obj.answer != null ? String(obj.answer) : null,
      holdAtTarget: obj.holdAtTarget === true,
      movementAllowed: typeof obj.movementAllowed === 'boolean' ? obj.movementAllowed : null,
    };
  }

  // -------------------------------------------------------------------------
  // Deterministic fallback parsing (Challenge 2 mission catalog)
  // -------------------------------------------------------------------------

  /** "RED LIGHT" / "GREEN LIGHT" state switches. */
  static parseLightState(text) {
    const lower = String(text).toLowerCase().trim();
    // A pure state message is short; the rules announcement mentions both
    // colors and is handled as red_light_green_light by fallbackParse.
    if (/red\s*light/.test(lower) && !/green\s*light/.test(lower)) {
      return { kind: 'light_state', movementAllowed: false };
    }
    if (/green\s*light/.test(lower) && !/red\s*light/.test(lower)) {
      return { kind: 'light_state', movementAllowed: true };
    }
    return null;
  }

  /** Regex-based interpretation of the known mission templates. */
  static fallbackParse(text) {
    const raw = String(text);
    const lower = raw.toLowerCase();

    const targets = [...raw.matchAll(/\(\s*(\d+)\s*,\s*(\d+)\s*\)/g)]
      .map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));

    const bonusMatch =
      raw.match(/(-?\d+)\s*(?:pts|points?|punti)/i) ?? raw.match(/bonus[^-\d]*(-?\d+)/i);
    const bonus = bonusMatch ? Number(bonusMatch[1]) : null;

    const negative =
      /\b(do not|don't|never|avoid|forbidden|penali[sz]ed?)\b/.test(lower) || (bonus ?? 0) < 0;

    const base = {
      targets, bonus, forbidden: false, count: null, threshold: null,
      expression: null, answer: null, holdAtTarget: false, movementAllowed: null,
    };

    // Rules announcement of the red/green light game.
    if (/red\s*light/.test(lower) && /green\s*light/.test(lower)) {
      return { ...base, kind: 'red_light_green_light' };
    }

    // Pure reasoning request (26c2_3): compute the answer locally.
    if (/\b(calculate|compute|how much is|what is)\b/.test(lower)) {
      const exprMatch = raw.match(/[\d][\d\s+\-*/().]*/);
      const expression = exprMatch ? exprMatch[0].trim() : null;
      return {
        ...base,
        kind: 'question_answer',
        expression,
        answer: expression ? MissionInterpreter.evaluateArithmetic(expression) : null,
      };
    }

    // Delivery-policy missions.
    const exactlyMatch = lower.match(/exactly\s+(one|two|three|four|five|\d+)/);
    if (exactlyMatch && /deliver/.test(lower)) {
      const count = NUMBER_WORDS[exactlyMatch[1]] ?? Number(exactlyMatch[1]);
      return { ...base, kind: 'deliver_exactly_n', count };
    }

    const thresholdMatch = lower.match(/(?:≤|<=|less than|at most|no more than)\s*(\d+)/);
    if (thresholdMatch && /deliver/.test(lower)) {
      return { ...base, kind: 'deliver_less_value_than', threshold: Number(thresholdMatch[1]) };
    }

    if (/picked?(?:\s+up)?\s+(?:first\s+)?by\s+(?:one|an?)\s+agent.*deliver|one agent.*deliver.*(?:other|another)/.test(lower)) {
      return { ...base, kind: 'one_pickup_another_deliver' };
    }

    // Positional missions (need coordinates from here on).
    if (targets.length > 0) {
      if (/deliver|drop|put\s*down|package|parcel/.test(lower)) {
        return { ...base, kind: 'deliver_at', forbidden: negative };
      }
      if (/go|reach|move|through|visit/.test(lower)) {
        return {
          ...base,
          kind: 'go_to',
          forbidden: negative,
          holdAtTarget: /wait/.test(lower),
        };
      }
    }

    return { ...base, kind: 'unknown' };
  }

  /**
   * Safe arithmetic evaluation for question_answer missions: only
   * digits, operators and parentheses are accepted (no identifiers, so
   * no code injection surface).
   */
  static evaluateArithmetic(expression) {
    if (!/^[\d\s+\-*/().]+$/.test(expression)) return null;
    try {
      const value = Function(`"use strict"; return (${expression});`)();
      return Number.isFinite(value) ? String(value) : null;
    } catch {
      return null;
    }
  }
}
