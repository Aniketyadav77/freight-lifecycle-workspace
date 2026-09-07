/**
 * Temporary: one pass through the whole lifecycle after the restyle, to confirm
 * nothing broke functionally. Procure -> Execute -> Track -> Settle -> Analytics.
 */
import { useFreightStore } from "./src/store/useFreightStore";
import { getTrackedLoads } from "./src/shared-components/trackedLoads";
import {
  computeLaneCosts,
  computeOnTime,
  computeRateVariance,
  selectSettledLoads,
} from "./src/store/analytics";

let failures = 0;
const check = (name: string, pass: boolean, detail = "") => {
  if (!pass) failures += 1;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` -- ${detail}` : ""}`);
};
const s = () => useFreightStore.getState();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const waitUntil = async (fn: () => boolean, ms: number) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return true;
    await sleep(50);
  }
  return false;
};

await s().init();
check("socket connects", await waitUntil(() => s().connection === "open", 4000), s().connection);
check("loads arrive", s().loads.size > 15, `${s().loads.size} loads`);
check("invoices arrive", s().invoices.size > 10, `${s().invoices.size} invoices`);

// Each module has something to show (so no view is stuck in its empty state).
const byStatus = (st: string) => [...s().loads.values()].filter((l) => l.status === st).length;
check("Procurement has loads", byStatus("bidding") > 0, `${byStatus("bidding")} bidding`);
check("Active Shipments has loads", byStatus("assigned") + byStatus("in_transit") > 0, `${byStatus("assigned")} assigned + ${byStatus("in_transit")} in transit`);
check("Tracking has positioned loads", getTrackedLoads().size > 0, `${getTrackedLoads().size} tracked`);
check("Settlement has invoices", byStatus("delivered") > 0, `${byStatus("delivered")} delivered`);
check("Analytics has a settled book", selectSettledLoads(s()).length >= 10, `${selectSettledLoads(s()).length} settled`);

// --- full walk of one load, Procurement through Analytics
const target = [...s().loads.values()].find((l) => l.status === "bidding")!;
s().selectLoad(target.id);
await waitUntil(() => (s().bids.get(target.id)?.length ?? 0) >= 0, 2000);

s().submitBid(target.id, "Final Check Carriers", 11111);
const pending = s().bids.get(target.id)!.find((b) => b.transporterName === "Final Check Carriers");
check("1. bid is optimistic immediately", pending?.sync === "pending");
check("1. bid confirms", await waitUntil(() => s().bids.get(target.id)!.some((b) => b.transporterName === "Final Check Carriers" && b.sync === "confirmed"), 3000));

const winner = s().bids.get(target.id)!.find((b) => b.transporterName === "Final Check Carriers")!;
s().acceptBid(target.id, winner.id);
check("2. load is assigned", await waitUntil(() => s().loads.get(target.id)!.status === "assigned", 3000));
check("2. contracted rate recorded", s().loads.get(target.id)!.contractedRate === 11111);

check("3. departs on its own", await waitUntil(() => s().loads.get(target.id)!.status === "in_transit", 9000));
check("3. appears on the tracking map", await waitUntil(() => getTrackedLoads().has(target.id), 4000));

s().markDelivered(target.id);
check("4. delivery lands", await waitUntil(() => s().loads.get(target.id)!.status === "delivered", 3000));
check("4. invoice raised", await waitUntil(() => s().invoices.has(target.id), 3000));

const settledBefore = selectSettledLoads(s()).length;
s().resolveInvoice(target.id, "approve");
check("5. approving settles it", await waitUntil(() => s().loads.get(target.id)!.status === "settled", 3000));

// --- analytics picks the new load up
check("6. settled book grew", selectSettledLoads(s()).length === settledBefore + 1);
const settled = selectSettledLoads(s());
const lanes = computeLaneCosts(settled, s().invoices);
const onTime = computeOnTime(settled);
const variance = computeRateVariance(settled, s().invoices);
check("6. lane costs recompute", lanes.length > 0 && lanes.some((l) => l.lane.includes(target.origin)), `${lanes.length} lanes`);
check("6. on-time stays a real mix", onTime.onTimePct > 0 && onTime.onTimePct < 100, `${onTime.onTimePct}%`);
check("6. variance covers every settled load", variance.length === settled.length);
check("6. full lifecycle recorded", s().loads.get(target.id)!.history.map((h) => h.status).join(" -> ") === "posted -> bidding -> assigned -> in_transit -> delivered -> settled", s().loads.get(target.id)!.history.map((h) => h.status).join(" -> "));

s().teardown();
console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
