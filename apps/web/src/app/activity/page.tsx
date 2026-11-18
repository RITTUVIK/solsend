"use client";
import { AppShell } from "@/components/AppShell";
import { FeedList, LiveDot } from "@/components/FeedList";
import { PageTitle } from "@/components/ui";

export default function ActivityPage() {
  return (
    <AppShell>
      <PageTitle title="Activity" sub="Every card event. Settlements are read from Solana devnet." right={<LiveDot />} />
      <div className="surface !p-1"><FeedList /></div>
    </AppShell>
  );
}
