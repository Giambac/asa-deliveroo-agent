const DEFAULT_BASE_URL = "https://llm.bears.disi.unitn.it/v1";
const DEFAULT_MODEL = "llama-3.3-70b-lmstudio";

function safeJsonParse(text) {
  const cleaned = text.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

function clipOptions(options) {
  return options.slice(0, 6).map((option, index) => ({
    index,
    action: option.predicate[0],
    predicate: option.predicate,
    utility: Number(option.utility.toFixed(2)),
    reward: Number(option.reward.toFixed(2)),
    distance: option.distance,
    reason: option.reason
  }));
}

function worldState(beliefs) {
  return {
    me: beliefs.me,
    carried: beliefs.carriedParcels().length,
    visibleParcels: beliefs.availableParcels().length,
    visibleAgents: beliefs.visibleAgents().length,
    deliveries: beliefs.deliveryTiles.length,
    spawners: beliefs.spawnTiles.length,
    lastSeenParcels: beliefs.lastPerceivedParcelsCount
  };
}

export class LlmDecisionMaker {
  constructor() {
    this.baseURL = process.env.LITELLM_BASE_URL || process.env.OPENAI_BASE_URL || DEFAULT_BASE_URL;
    this.apiKey = process.env.LITELLM_API_KEY || process.env.OPENAI_API_KEY;
    this.model = process.env.LOCAL_MODEL || process.env.OPENAI_MODEL || DEFAULT_MODEL;
    this.enabled = Boolean(this.apiKey);
  }

  async chooseOption(beliefs, options) {
    if (!options.length) return null;
    if (!this.enabled) return this.fallback(options, "missing LLM API key");

    const candidates = clipOptions(options);
    const prompt = [
      {
        role: "system",
        content:
          "You are the deliberation module of a Deliveroo grid-world agent. " +
          "Choose exactly one candidate option. Prefer scoring: deliver carried parcels, pick reachable high-value parcels, otherwise explore. " +
          "Return only JSON with this shape: {\"index\":0,\"reason\":\"short reason\"}."
      },
      {
        role: "user",
        content: JSON.stringify({
          world: worldState(beliefs),
          candidates
        })
      }
    ];

    try {
      const response = await fetch(`${this.baseURL.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model: this.model,
          messages: prompt,
          temperature: 0.1
        })
      });

      if (!response.ok) {
        return this.fallback(options, `LLM HTTP ${response.status}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content ?? "";
      const parsed = safeJsonParse(content);
      const index = Number(parsed?.index);

      if (!Number.isInteger(index) || index < 0 || index >= candidates.length) {
        return this.fallback(options, "LLM returned invalid index");
      }

      return {
        option: options[index],
        source: "llm",
        reason: parsed.reason || candidates[index].reason
      };
    } catch (error) {
      return this.fallback(options, error.message);
    }
  }

  fallback(options, reason) {
    return {
      option: options[0],
      source: "heuristic",
      reason
    };
  }
}
