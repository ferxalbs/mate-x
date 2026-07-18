import { Outlet } from "@tanstack/react-router";

export function OnboardingShell() {
  return (
    <main className="h-screen w-full overflow-y-auto bg-background text-foreground">
      <div className="mx-auto flex min-h-full w-full max-w-4xl items-center px-5 py-4 sm:px-8">
        <Outlet />
      </div>
    </main>
  );
}
