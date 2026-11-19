// "/" renders nothing itself: the landing lives in the root layout's SplitFrame (components/SplitFrame.tsx), so it stays
// mounted when the app pane slides in next to it for /home, /merchant, /activity and /cards/*.
export default function Home() {
  return null;
}
