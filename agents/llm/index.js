import { DeliverooApi } from "@unitn-asa/deliveroo-js-client";
import { Beliefs } from "../agent/beliefs.js";
import { createMetrics, logMetrics } from "../agent/metrics.js";
import { GoDeliver } from "../agent/plans/GoDeliver.js";
import { GoExplore } from "../agent/plans/GoExplore.js";
import { GoPickUp } from "../agent/plans/GoPickUp.js";
import { GreedyFallbackMove } from "../agent/plans/GreedyFallbackMove.js";
import { MoveByShortestPath } from "../agent/plans/MoveByShortestPath.js";
import { LlmDecisionMaker } from "./llmDecision.js";
import { LlmIntentionRevision } from "./llmIntentionRevision.js";

const SERVER_URL = process.env.DELIVEROO_HOST || "http://localhost:8080";
const TOKEN = process.env.DELIVEROO_TOKEN;

const client = new DeliverooApi(SERVER_URL, TOKEN);
const beliefs = new Beliefs();
const metrics = createMetrics();
const decisionMaker = new LlmDecisionMaker();
let connected = false;
let mapLoaded = false;

const context = {
  client,
  beliefs,
  metrics,
  planLibrary: [GoPickUp, GoDeliver, GoExplore, MoveByShortestPath, GreedyFallbackMove]
};

const agent = new LlmIntentionRevision(context, decisionMaker);

console.log(`starting LLM Deliveroo agent on ${SERVER_URL}`);
console.log(
  decisionMaker.enabled
    ? `LLM deliberation enabled: ${decisionMaker.model} at ${decisionMaker.baseURL}`
    : "LLM API key missing; using heuristic fallback with the same agent shell"
);

client.onConnect(() => {
  connected = true;
  console.log("connected to Deliveroo");
});
client.onDisconnect(() => {
  connected = false;
  console.log("disconnected from Deliveroo");
});

client.onYou((me) => beliefs.updateMe(me));
client.onMap((width, height, tiles) => {
  mapLoaded = true;
  beliefs.updateMap(width, height, tiles);
});
client.onParcelsSensing((parcels) => {
  beliefs.updateParcels(parcels);
  agent.reconsiderSoon();
});
client.onAgentsSensing((agents) => {
  beliefs.updateAgents(agents);
  agent.reconsiderSoon();
});

setInterval(() => agent.reconsiderSoon(), 500);
setInterval(() => {
  if (connected && mapLoaded) logMetrics(metrics, beliefs);
}, 30000);

setTimeout(() => {
  if (!connected) {
    console.log(`not connected yet. Make sure the Deliveroo server is running at ${SERVER_URL}`);
    console.log("the agent does not open the website; open the game page separately in your browser");
  }
}, 10000);
