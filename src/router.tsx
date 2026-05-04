import {
  RouterProvider,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  useNavigate,
  useLocation,
} from '@tanstack/react-router';
import { useEffect, useState } from 'react';

import { DesktopShell } from './features/desktop-shell/desktop-shell';
import { OnboardingShell } from './features/onboarding/onboarding-shell';
import { OnboardingFlow } from './features/onboarding/onboarding-flow';
import { HomePage } from './routes/home-page';
import { RunsPage } from './routes/runs-page';
import { SettingsPage } from './routes/settings-page';
import { getAppSettings } from './services/settings-client';

function RootComponent() {
  const navigate = useNavigate();
  const location = useLocation();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void getAppSettings().then((settings) => {
      if (cancelled) return;
      
      if (!settings.onboardingCompleted && !location.pathname.startsWith('/onboarding')) {
        void navigate({ to: '/onboarding', replace: true });
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [navigate, location.pathname]);

  if (loading) {
    return null; // Or a splash screen
  }

  return <Outlet />;
}

const rootRoute = createRootRoute({
  component: RootComponent,
  notFoundComponent: HomePage,
});

const onboardingLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'onboarding-layout',
  component: OnboardingShell,
});

const onboardingIndexRoute = createRoute({
  getParentRoute: () => onboardingLayoutRoute,
  path: '/onboarding',
  component: OnboardingFlow,
});

const shellRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'shell',
  component: DesktopShell,
});

const indexRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/',
  component: HomePage,
});

const settingsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/settings',
  component: SettingsPage,
});

const runsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/runs',
  component: RunsPage,
});

const settingsSectionRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/settings/$section',
  component: SettingsPage,
});

const routeTree = rootRoute.addChildren([
  onboardingLayoutRoute.addChildren([onboardingIndexRoute]),
  shellRoute.addChildren([indexRoute, runsRoute, settingsRoute, settingsSectionRoute]),
]);

export const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
  defaultNotFoundComponent: HomePage,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

export function AppRouter() {
  return <RouterProvider router={router} />;
}
