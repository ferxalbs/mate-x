import {
  RouterProvider,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';

import { DesktopShell } from './features/desktop-shell/desktop-shell';
import { HomePage } from './routes/home-page';
import { SettingsPage } from './routes/settings-page';

const rootRoute = createRootRoute({
  component: DesktopShell,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: HomePage,
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: SettingsPage,
});

const settingsSectionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings/$section',
  component: SettingsPage,
});

const routeTree = rootRoute.addChildren([indexRoute, settingsRoute, settingsSectionRoute]);

export const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

export function AppRouter() {
  return <RouterProvider router={router} />;
}
