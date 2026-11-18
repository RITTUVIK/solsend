// Debug filter (G0.7): return the log lines of the first tx invoking our policy program.
function main(stream) {
  const POLICY = "8uSYgZn5rvEbrpc3NgQFvqcqMA7snptsmiey5457ddR9";
  for (const item of stream.data || []) {
    for (const tx of (Array.isArray(item) ? item : []) ) {
      if ((tx.programInvocations || []).some((i) => i.programId === POLICY)) return { signature: tx.signature, logs: tx.logs };
    }
  }
  return null;
}
