"use client";
import { AppShell } from "@/components/AppShell";
import { FeedList } from "@/components/FeedList";
import { PageTitle, QuickNodeBadge } from "@/components/ui";

export default function ActivityPage() {
  return (
    <AppShell>
      <PageTitle title="Activity" sub="Every swipe, refund and card change. Settlements are read from Solana devnet." />
      <div className="-mt-2 mb-3"><QuickNodeBadge label="Streamed by QuickNode · live" /></div>
      <div className="surface !px-2 !py-1"><FeedList /></div>
    </AppShell>
  );
}
