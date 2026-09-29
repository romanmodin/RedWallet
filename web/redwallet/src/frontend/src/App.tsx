/**
 * App — router configuration and provider wrappers only.
 *
 * Every route resolves to a real page component; the history route owns its
 * filter search schema so filters survive navigation and sharing.
 */

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AppShell } from "@/components/layout/AppShell";
import { ThemeProvider } from "@/context/ThemeContext";

import { WalletProvider } from "@/context/WalletContext";
import { DashboardPage } from "@/pages/DashboardPage";
import { HistoryPage, validateHistorySearch } from "@/pages/HistoryPage";
import { ReceivePage } from "@/pages/ReceivePage";
import { SendPage } from "@/pages/SendPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { StatusPage } from "@/pages/StatusPage";
import { TransactionDetailPage } from "@/pages/TransactionDetailPage";
import { WalletsPage } from "@/pages/WalletsPage";
import {
  Outlet,
  RouterProvider,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";

const rootRoute = createRootRoute({
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
});

const dashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: DashboardPage,
});

const walletsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/wallets",
  component: WalletsPage,
});

const sendRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/send",
  component: SendPage,
});

const receiveRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/receive",
  component: ReceivePage,
});

const historyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/history",
  validateSearch: validateHistorySearch,
  component: HistoryPage,
});

const historyDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/history/$id",
  component: TransactionDetailPage,
});

const statusRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/status",
  component: StatusPage,
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: SettingsPage,
});

const routeTree = rootRoute.addChildren([
  dashboardRoute,
  walletsRoute,
  sendRoute,
  receiveRoute,
  historyRoute,
  historyDetailRoute,
  statusRoute,
  settingsRoute,
]);

const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  scrollRestoration: true,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <WalletProvider>
          <RouterProvider router={router} />
        </WalletProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
