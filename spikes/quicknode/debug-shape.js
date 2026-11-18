// Debug filter (G0.7): describe the programs_with_logs payload shape for transactions that invoke our policy program.
function main(stream) {
  const POLICY = "8uSYgZn5rvEbrpc3NgQFvqcqMA7snptsmiey5457ddR9";
  const data = stream.data || [];
  const out = { shape: Array.isArray(data[0]) ? "array-of-arrays" : typeof data[0], items: data.length, metadataKeys: Object.keys(stream.metadata || {}), matches: [] };
  for (const item of data) {
    const txs = Array.isArray(item) ? item : (item && item.transactions) || [];
    for (const tx of txs) {
      const invs = tx.programInvocations || [];
      if (!invs.some((i) => i.programId === POLICY)) continue;
      out.matches.push({
        txKeys: Object.keys(tx), signature: tx.signature, slot: tx.slot, success: tx.success, logsCount: (tx.logs || []).length,
        invocations: invs.map((i) => ({
          programId: i.programId, instructionKeys: Object.keys(i.instruction || {}), index: i.instruction && i.instruction.index,
          dataPrefix: String((i.instruction || {}).data).slice(0, 24), dataLen: String((i.instruction || {}).data || "").length,
          nAccounts: ((i.instruction || {}).accounts || []).length,
          tokenBalances: (i.instruction || {}).tokenBalances ? JSON.stringify(i.instruction.tokenBalances).slice(0, 400) : null,
        })),
      });
      if (out.matches.length >= 1) return out;
    }
  }
  return out;
}
