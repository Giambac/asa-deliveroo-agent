import { DeliverooApi } from "@unitn-asa/deliveroo-js-client";
import { Beliefs } from "./beliefs.js";
import { IntentionRevisionRevise } from "./intentionRevision.js";
import { createMetrics, logMetrics } from "./metrics.js";
import { GoDeliver } from "./plans/GoDeliver.js";
import { GoExplore } from "./plans/GoExplore.js";
import { GoPickUp } from "./plans/GoPickUp.js";
import { GreedyFallbackMove } from "./plans/GreedyFallbackMove.js";
import { MoveByShortestPath } from "./plans/MoveByShortestPath.js";

const SERVER_URL = process.env.DELIVEROO_HOST || "http://localhost:8080";
const TOKEN = process.env.DELIVEROO_TOKEN;

const client = new DeliverooApi(SERVER_URL, TOKEN);
const beliefs = new Beliefs();
const metrics = createMetrics();
let connected = false;
let mapLoaded = false;
const context = {
  client,
  beliefs,
  metrics,
  planLibrary: [GoPickUp, GoDeliver, GoExplore, MoveByShortestPath, GreedyFallbackMove]
};

const agent = new IntentionRevisionRevise(context);

console.log(`starting Deliveroo agent on ${SERVER_URL}`);

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
  agent.reconsider();
});
client.onAgentsSensing((agents) => {
  beliefs.updateAgents(agents);
  agent.reconsider();
});

setInterval(() => agent.reconsider(), 500);
setInterval(() => {
  if (connected && mapLoaded) logMetrics(metrics, beliefs);
}, 30000);

setTimeout(() => {
  if (!connected) {
    console.log(`not connected yet. Make sure the Deliveroo server is running at ${SERVER_URL}`);
    console.log("the agent does not open the website; open the game page separately in your browser");
  }
}, 10000);
