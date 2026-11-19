"use client";
import { FeedList } from "@/components/FeedList";
import { PageTitle } from "@/components/ui";

// AppShell comes from the layout (SplitFrame).
export default function ActivityPage() {
  return (
    <>
      <PageTitle title="Activity" sub="Every swipe, refund and card change. Settlements are read from Solana devnet." />
      <div className="surface !px-2 !py-1"><FeedList showStream /></div>
    </>
  );
}
