import { Outlet } from "@tanstack/react-router";

export function OnboardingShell() {
  return (
    <main className="flex h-screen w-full flex-col items-center justify-center bg-background text-foreground overflow-hidden">
      <div className="w-full max-w-4xl px-6">
        <Outlet />
      </div>
    </main>
  );
}
