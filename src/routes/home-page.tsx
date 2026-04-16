import { ArrowRight, Blocks, MonitorSmartphone, PanelsTopLeft } from 'lucide-react';

import { Button } from '../components/ui/button';

const stackItems = [
  'Electron',
  'React 19',
  'Tailwind CSS v4',
  'TanStack Router',
  'Base UI',
  'cva + tailwind-merge',
];

export function HomePage() {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(119,195,255,0.18),transparent_28%),linear-gradient(180deg,var(--background),color-mix(in_oklab,var(--background)_86%,black))] text-[var(--foreground)]">
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-6 py-10">
        <header className="flex items-center justify-between gap-4 border-b border-[var(--border)] pb-6">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-[var(--muted-foreground)]">
              mate x
            </p>
            <h1 className="mt-2 text-2xl font-semibold">T3code-style desktop shell</h1>
          </div>
          <Button variant="secondary">Stack ready</Button>
        </header>

        <section className="grid flex-1 gap-6 py-8 lg:grid-cols-[1.5fr_0.9fr]">
          <div className="rounded-[2rem] border border-[var(--border)] bg-[color-mix(in_oklab,var(--surface)_88%,transparent)] p-8 shadow-[0_24px_80px_rgba(0,0,0,0.35)] backdrop-blur">
            <div className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1 text-xs text-[var(--muted-foreground)]">
              <PanelsTopLeft className="size-3.5" />
              Similar stack, without monorepo yet
            </div>

            <h2 className="mt-6 max-w-3xl text-4xl font-semibold leading-tight sm:text-5xl">
              Base UI + Tailwind v4 + Router, patterned after `pingdotgg/t3code`.
            </h2>

            <p className="mt-4 max-w-2xl text-base leading-7 text-[var(--muted-foreground)]">
              This project now has the same frontend foundation: React renderer, utility-first
              styling, variant-driven UI primitives, and a route-based shell ready for desktop
              workflows.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <Button>
                Open workspace
                <ArrowRight className="size-4" />
              </Button>
              <Button variant="secondary">Inspect components</Button>
            </div>

            <div className="mt-10 grid gap-3 sm:grid-cols-2">
              {stackItems.map((item) => (
                <div
                  key={item}
                  className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--muted-foreground)]"
                >
                  {item}
                </div>
              ))}
            </div>
          </div>

          <aside className="grid gap-6">
            <div className="rounded-[1.75rem] border border-[var(--border)] bg-[var(--surface)] p-6">
              <div className="flex items-center gap-3">
                <div className="rounded-2xl bg-[var(--accent-soft)] p-3 text-[var(--accent)]">
                  <Blocks className="size-5" />
                </div>
                <div>
                  <h3 className="font-medium">UI foundation</h3>
                  <p className="text-sm text-[var(--muted-foreground)]">
                    `@base-ui/react`, `cva`, `cn()`, semantic tokens.
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-[1.75rem] border border-[var(--border)] bg-[var(--surface)] p-6">
              <div className="flex items-center gap-3">
                <div className="rounded-2xl bg-[var(--accent-soft)] p-3 text-[var(--accent)]">
                  <MonitorSmartphone className="size-5" />
                </div>
                <div>
                  <h3 className="font-medium">Desktop ready</h3>
                  <p className="text-sm text-[var(--muted-foreground)]">
                    Electron Forge stays intact; only the renderer was modernized.
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-[1.75rem] border border-[var(--border)] bg-[linear-gradient(180deg,color-mix(in_oklab,var(--surface)_92%,white),var(--surface))] p-6">
              <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
                next step
              </p>
              <p className="mt-3 text-sm leading-6 text-[var(--muted-foreground)]">
                If you want a closer match to `t3code`, the next migration is a Bun workspace with
                `apps/web`, `apps/desktop`, `apps/server`, and shared packages.
              </p>
            </div>
          </aside>
        </section>
      </div>
    </main>
  );
}
