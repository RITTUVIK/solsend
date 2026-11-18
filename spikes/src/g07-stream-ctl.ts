// G0.7 stream control: get | pause | activate | delete  (stream named solsend-cp0b-devnet)
// Keep the stream PAUSED except during tests/demo: Streams bill per processed block, and the free trial is finite.
import { record } from "./lib/evidence.js";
import { activateStream, listOurStreams, pauseStream, qn } from "./lib/quicknode.js";
const cmd = process.argv[2] ?? "get";
for (const s of await listOurStreams()) {
  const r = cmd === "pause" ? await pauseStream(s.id) : cmd === "activate" ? await activateStream(s.id) : cmd === "delete" ? await qn("DELETE", `/streams/${s.id}`) : await qn("GET", `/streams/${s.id}`);
  const info = cmd === "get" ? r.json : (await qn("GET", `/streams/${s.id}`)).json;
  const summary = { id: s.id, cmd, http: r.status, status: info?.status ?? null, network: info?.network, dataset: info?.dataset, batch: info?.dataset_batch_size,
    start_range: info?.start_range ?? null, current_range: info?.current_range ?? info?.last_processed_block ?? null, updated_at: info?.updated_at ?? null, keys: Object.keys(info ?? {}) };
  console.log(JSON.stringify(summary));
  record("g07", `stream_${cmd}`, summary);
}
process.exit(0);
