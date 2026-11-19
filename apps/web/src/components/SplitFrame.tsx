"use client";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { AppShell } from "./AppShell";
import { Landing } from "./Landing";
import { PaneResizer } from "./PaneResizer";

/** Signed-in app pages. They open in the right-hand pane (desktop) or full screen (phones and tablets). */
export const isAppPath = (path: string) => /^\/(home|merchant|activity|cards)(\/|$)/.test(path);

/**
 * Split layout. "/" shows the landing full width. An app page keeps the same landing mounted on the left (it narrows)
 * and slides the app in from the right: one persistent AppShell, so its tabs, wallet and cards survive page switches.
 * Below lg there is no room for two columns: the app takes the whole screen. Other pages (status, 404) are untouched.
 */
export function SplitFrame({ children }: { children: ReactNode }) {
  const path = usePathname() ?? "/";
  const app = isAppPath(path);
  if (path !== "/" && !app) return <>{children}</>;
  // The app comes first in the DOM (focus order, and it's what's in use); both are positioned by CSS. The landing keeps
  // the same slot either way, so React keeps it mounted when the pane opens or closes.
  return (
    <>
      {app ? (
        <>
          <div className="app-pane" data-testid="app-pane">
            <div className="app-pane-scroll"><AppShell>{children}</AppShell></div>
          </div>
          <PaneResizer />
        </>
      ) : children}
      <Landing split={app} />
    </>
  );
}
