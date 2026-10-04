# ADR-0010 — Tailwind with hand-owned shadcn-style components, and a token layer for theming

**Status:** Accepted · 2026-10-04

## Context
Seven steps shipped the domain behind inline `style` objects — about 150 of them. That
was the right trade while the shape was unsettled, but it had stopped paying: no theming,
no reuse, and every new view re-deriving its own spacing and colour.

The brief asked for a Notion-like application with shadcn components, considered
typography and colour, and light and dark mode.

Alternatives considered:

- **Plain CSS modules or vanilla CSS.** No dependencies, and theming via custom
  properties works fine. Rejected because every component would carry its own stylesheet
  and the variant logic (a button with five looks and four sizes) ends up hand-rolled.
- **A component library used as a dependency** — MUI, Mantine, Chakra. Fastest to
  assemble and the hardest to make not look like itself, which is the opposite of the
  brief.
- **The shadcn CLI**, generating components into the project. Rejected on mechanics: it
  assumes a conventional `src/` at the repository root, and this project's Vite root is
  `web/` with the API beside it. Fighting the generator's assumptions costs more than
  writing the same components, which are MIT and designed to be owned.
- **Tailwind plus hand-written components in shadcn's idiom.** Chosen.

## Decision
Tailwind v4 through its Vite plugin, with CSS-first configuration — no
`tailwind.config.js`.

Components live in `web/src/ui`, written in shadcn's idiom: `class-variance-authority`
for variants, a `cn()` helper merging classes so a call site can override, and Radix
primitives underneath **only where they earn it** — dialog, dropdown, checkbox, tabs.
Selects stay native, because on a phone that opens the platform picker and nothing
rebuilt in a `div` beats it.

Colour and type are a **two-layer token system**: plain custom properties on `:root` and
`:root.dark` hold the values, and `@theme inline` maps them onto Tailwind's scale. That
is what makes `bg-raised` or `text-muted` mean the right thing in both themes without a
single `dark:` prefix in application code.

Theme preference is `light | dark | system`, stored in `localStorage`, applied as a class
on `<html>` by an inline script **before first paint** so a dark-mode reload does not
flash white. `system` keeps tracking the OS after load rather than reading it once.

Fonts are self-hosted via `@fontsource`, not linked from Google.

## Consequences
- **Dark mode is a design, not an inversion.** Dark surfaces are a cool slate and the
  accent lightens to hold its contrast against them, which means two palettes to keep in
  step rather than one. A new colour has to be added in three places: both `:root`
  blocks and the `@theme` map.
- **Self-hosted fonts cost 0.29MB in the image** and remove every external request from
  the render path — the app looks right on bad hotel wifi, and nothing on the critical
  path leaves the cluster. The deployed amd64 image is still dominated by the Node
  runtime; application content is 1.8MB in total.
- **Radix adds four dependencies**, and each is a real surface area for a future
  breaking change. The alternative was hand-rolling focus traps and keyboard handling
  for the dialog and menu, which is where accessibility bugs live.
- **Tailwind v4's CSS-first config is young.** There is less written about it than about
  v3's JavaScript config, so an unusual need may be harder to look up.
- **No component tests.** The suite covers the server; these components are unverified by
  anything but typechecking and a build. That is a real gap, and the reason this change
  was kept to presentation with no behaviour touched.
- **Visual review has not happened.** The Chrome extension was not connected in the
  session that wrote this, so the design has been reasoned about and built but not
  looked at. Nothing substitutes for that.
