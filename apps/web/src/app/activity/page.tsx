"use client";
import { AppShell } from "@/components/AppShell";
import { FeedList } from "@/components/FeedList";
import { PageTitle } from "@/components/ui";

export default function ActivityPage() {
  return (
    <AppShell>
      <PageTitle title="Activity" sub="Every swipe, refund and card change. Settlements are read from Solana devnet." />
      <div className="surface !px-2 !py-1"><FeedList showStream /></div>
    </AppShell>
  );
}
