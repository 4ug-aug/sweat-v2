# Colony design styleguide

Colony is a dense desktop product: Linear-like, warm, quiet. The UI should feel
like a crafted tool, not a marketing site and not a generic blue SaaS dashboard.

**Product name:** Colony. Never introduce “Sweat” in user-facing copy.

If a choice is not specified, pick the quieter, smaller, more token-driven option.

## Personality

- **Warm, not sterile.** Neutrals have a slight brown/ochre hue. Primary is taupe
  (light) / warm gold (dark), never default indigo/blue.
- **Dense, not cramped.** Rows 32–36px. Meta is `text-xs`. Titles stay
  `text-sm font-medium` unless they are a page title.
- **Hairlines, not chrome.** Borders are `border/40`–`border/70`. Almost no drop
  shadows on in-page content. Shadows belong on floating layers (popover, toast,
  dialog).
- **Ghost-first.** Most actions are ghost/icon. One primary button per view
  (usually “New …” in the header).
- **Icons carry status.** Do not use colored pills for workflow state. Lucide
  glyphs + a single semantic color.
- **Collapse before wrap.** Truncate. Hide secondary columns with container
  queries. Never turn a table row into a stacked card just because the pane got
  narrower.

## Color tokens

Ship light and dark. Use semantic tokens, not raw hex, except for the few status
hues below.

### Light

| Token | OKLCH | Role |
|---|---|---|
| `--background` | `0.99 0 0` | App canvas |
| `--foreground` | `0.147 0.004 49.3` | Body text |
| `--card` / `--popover` | `1 0 0` | Raised surface |
| `--muted` | `0.96 0.002 17.2` | Hover fills, group headers (`/60`) |
| `--muted-foreground` | `0.54 0.021 43.1` | Meta, IDs, dates, placeholders |
| `--primary` | `0.595 0.0724 53.97` | CTA, links, selection |
| `--primary-foreground` | `0.986 0.002 67.8` | Text on primary |
| `--border` / `--input` | `0.922 0.005 34.3` | Hairlines |
| `--ring` | `0.714 0.014 41.2` | Focus |
| `--destructive` | `0.577 0.245 27.325` | Errors, delete |
| `--sidebar` | `0.986 0.002 67.8` | Nav, slightly warmer than canvas |
| `--radius` | `0.625rem` | Base radius |

### Dark

| Token | OKLCH | Role |
|---|---|---|
| `--background` | `0.2576 0.0048 67.61` | Warm charcoal canvas |
| `--foreground` | `0.986 0.002 67.8` | Body |
| `--card` / `--popover` | `0.214 0.009 43.1` | Raised |
| `--muted` | `0.3012 0 240.05` | Hover / chips |
| `--muted-foreground` | `0.714 0.014 41.2` | Meta |
| `--primary` | `0.8812 0.0265 76.78` | Warm gold CTA |
| `--border` | `1 0 0 / 30%` | Hairlines |
| `--input` | `1 0 0 / 15%` | Fields |
| `--sidebar` | `0.3012 0 240.05` | Nav |

Radius scale: `sm` = radius − 4px (~6px), `md` = radius − 2px (~8px), `lg` =
10px, `xl` = 14px.

**How to paint**

- Page = `bg-background`. Sidebar = `bg-sidebar`.
- Group headers / selected nav = `bg-muted/60` or `bg-sidebar-accent`.
- Row hover = `bg-muted/40`. Icon-button hover = `bg-muted`.
- Primary is for the one commit action, checkboxes when checked, and text links.
  Do not tint whole pages with it.
- Destructive is text/icon (and confirm buttons). Do not use red backgrounds on
  rows.

### Status hues (icons only)

| Meaning | Color | Typical icon |
|---|---|---|
| Idle / backlog / todo | `text-muted-foreground` | `CircleDashed`, `Circle` |
| Active / in progress | `text-yellow-500` | `CircleDot` |
| Review / healthy | `text-green-500` | `Clock3`, `CircleCheck` |
| Done / complete | `text-indigo-500` | `CircleCheck` |
| Timing / live | `text-green-700 dark:text-green-400` | `Timer` + `animate-pulse` |
| Warning | `text-amber-600 dark:text-amber-400` | log/warn text |
| Error | `text-destructive` | `OctagonX`, error copy |

Do not invent a rainbow of badges. If you need a chip (tags, counts), use a
tinted wash: `bg-{color}-500/20 text-{color}-700` with a dark counterpart.

## Type

- **UI font:** Geist (`ui-sans-serif, system-ui` fallback). Antialiased.
- **Mono:** `ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas` for IDs,
  logs, cron, code. `tabular-nums` for IDs, times, counts.
- **Page title:** `text-xl font-semibold` plus `text-sm text-muted-foreground`
  subtitle. Or, in the app chrome, a `size-4` muted Lucide icon +
  `font-semibold` (no subtitle).
- **Section / card title:** `text-sm font-medium`.
- **Body / row title:** `text-sm`. Row titles `font-medium`; everything else
  regular.
- **Meta / labels / filters:** `text-xs` or `text-xs/relaxed`. Field labels:
  `text-xs font-medium text-muted-foreground`.
- **Badges / kbd:** `text-[0.625rem] font-medium`.
- **Code in prose:** 0.85em, faint foreground wash, `rounded` 4px, slight
  padding. Fenced blocks: 13px mono, 8px radius, 1px faint border, small lang
  header.

Links: `text-primary`, 1px underline at 40% primary, 2px offset. Hover mixes 80%
primary with foreground.

No display serif. No giant hero type in-product. No all-caps labels.

## Density and spacing

| Thing | Size |
|---|---|
| App header | 56px (`h-14`), `px-4`, `border-b` |
| Filter / chip control | 28px (`h-7`) |
| Tabs list | 32px (`h-8`) |
| Sidebar item | 32px (`h-8`), icon-collapsed `size-8` |
| Group header strip | 32px (`h-8`) |
| Data row | 36px (`h-9`) |
| Default button / input | 36px (`h-9`) |
| Small button | 32px (`h-8`) |
| Icon hit target in a row | 24–28px (`size-6` / `size-7`) |
| Lucide in lists | 14px (`size-3.5`) |
| Lucide in chrome / menus | 16px (`size-4`) |
| Avatar in a row | 20px (`size-5`) |
| Checkbox | 16px, 4px radius |
| Page padding | `px-4 py-4` in lists; `p-5 sm:p-8` in card pages |
| Stack gap | 3–4 (`gap-3` / `gap-4`) for forms; `gap-1` / `gap-1.5` / `gap-2` inside toolbars and rows |

Inner icon buttons: `rounded-sm`. Controls and cards: `rounded-md` /
`rounded-lg`. Dialogs and the main pane: `rounded-xl`.

## App shell

Desktop-first inset layout:

1. **Sidebar** — `bg-sidebar`, collapsible to icons. Nav items `h-8 rounded-md
   text-sm`, icon `size-4`. Active = `bg-sidebar-accent font-medium`. Sections
   are collapsible; chevron rotates 90°. Group labels are small and muted.
   Persist open/closed in local storage.
2. **Main pane** — inset, `rounded-xl border-border/70 bg-background shadow-sm`,
   height `calc(100svh - 1rem - titlebar)`. Overflow hidden; children scroll.
3. **View header** — icon + title. Primary action `size="sm"` with `ml-auto`.
   Back chevron replaces the icon on detail views.
4. **Content** — either a scrolling list (`px-4 py-4`) or a max-width column of
   cards (`gap-6 p-5 sm:p-8`).
5. **Optional inspector** — right rail, hairline `border-l`, width ~280–420px.
   Slide/fade in; collapse to `w-0` rather than unmounting if the toggle is
   frequent.

Enter a view with:

```
animate-in fade-in-0 slide-in-from-bottom-1 duration-200 ease-out fill-mode-backwards motion-reduce:animate-none
```

Detail rails slide from the right (`slide-in-from-right-1` / `2`). Honor
`prefers-reduced-motion` everywhere.

## Two layout recipes

**Recipe A — grouped list** (issues, queues, inboxes)

- Filter bar of ghost `h-7 text-xs` chips.
- Collapsible groups: muted `rounded-t-md` header fused to a
  `rounded-b-md border border-t-0 border-border/50` body.
- 36px rows, `border-b border-border/40 last:border-b-0`, `hover:bg-muted/40`.
- Left: hover-reveal checkbox. Middle: icon pickers + ID
  (`tabular-nums text-muted-foreground`) + truncating title. Right: meta that
  peels away at `@lg` / `@xl` / `@2xl`.
- Put `@container` on the list, not only on the viewport.
- Multi-select summons a **floating bulk-action bar** (see Overlays), not a
  sticky header or a toast.

**Recipe B — object cards** (schedules, machines, settings)

- Page title + one-line subtitle + primary button.
- Cards: `rounded-lg bg-card ring-1 ring-foreground/10`, not heavy box-shadow.
  Title `text-sm font-medium`, description `text-xs/relaxed text-muted-foreground`.
- Card actions sit in the header (ghost icon buttons). Footer is for secondary
  controls.
- Prefer a simple stack or 2-col grid over masonry.

Do not mix the two on one page. A list of cards that pretend to be rows is
wrong; a table of fat cards is also wrong.

## Controls

**Buttons** (`rounded-md`, `text-sm font-medium`, 180ms color transition)

| Variant | Use |
|---|---|
| `default` / primary | The one create/save in the header or dialog footer |
| `ghost` | Filters, icon tools, row actions, cancel-adjacent |
| `outline` | Secondary in dialogs (Cancel) |
| `secondary` | Toggle that’s currently on (e.g. insights) |
| `destructive` | Confirm delete only, never in a toolbar |

Sizes: default 36px, `sm` 32px, `xs` 24px, `icon-sm` 32px (often overridden to
`size-6`/`size-7` in rows). Leading icons via `data-icon="inline-start"`.

**Icon triggers** (property pickers, timers):

```
inline-flex size-6 shrink-0 items-center justify-center rounded-sm
text-muted-foreground outline-none hover:bg-muted
focus-visible:ring-2 focus-visible:ring-ring/40
```

**Inputs:** `h-9 rounded-md border-input bg-transparent px-3 text-sm shadow-xs`.
Dark: `bg-input/30`. Focus: `border-ring` + `ring-[3px] ring-ring/50`. Invalid:
destructive border/ring. Placeholder `text-muted-foreground`.

**Select:** same height/border as input; chevron `opacity-50`.

**Textarea:** `rounded-md border bg-input/20`, no resize, `text-sm`.

**Checkbox:** 16px, 4px radius, checked = primary fill. In lists, `opacity-0`
until row hover, focus-within, or selected.

**Tabs:** muted pill track (`h-8 rounded-lg p-[3px] bg-muted`). Active tab
`bg-background text-foreground text-xs font-medium`. Line variant uses an
underline instead of a fill.

**Badge:** `h-5 rounded-full px-2 text-[0.625rem]`. Default = primary; outline
for neutral; `success` / `destructive` washes for run state. Not for workflow
status in lists.

**Kbd:** `h-5 min-w-5 rounded-xs bg-muted px-1 text-[0.625rem]`.

**Field label:** `mb-1 block text-xs font-medium text-muted-foreground`.

## Overlays

- **Dialog:** overlay `bg-black/40 backdrop-blur-xs`. Panel
  `rounded-xl bg-popover p-4 ring-1 ring-foreground/10`, fade + `zoom-in-95` in
  100ms. Title `text-sm font-medium`, description
  `text-xs/relaxed text-muted-foreground`. Footer: Cancel outline, then primary.
  Close is ghost `icon-sm` top-right.
- **Popover / select / command:** `rounded-md border bg-popover shadow-md`,
  scale 95 → 100, `z-60`. Menu rows `px-2 py-1.5 text-sm rounded-sm hover:bg-muted`.
  Current value: trailing muted `Check size-3.5`. Optional `tabular-nums` count
  on the right.
- **Tooltip:** inverted (`bg-foreground text-background text-xs rounded-md px-3 py-1.5`),
  4px offset, delay 0 in-app.
- **Toast:** bottom-right, `max-w-sm`, `rounded-md border bg-popover shadow-lg`.
  Title `text-sm font-medium`, description muted. Types: success / info /
  warning / error / loading (BrailleLoader). Copy: `"Could not update assignee"`
  + `"Please try again."` — no stack traces.
- **Bulk-action bar:** a compact floating toolbar over the list when one or more
  rows are selected. Not a toast, not a header, not a bottom sheet.

Stop click propagation from pickers inside clickable rows.

### Bulk-action bar

Anchored to the **page pane** (the `relative` list container), not the viewport:

```
absolute bottom-4 left-1/2 z-30 flex -translate-x-1/2 items-center gap-1
rounded-md border bg-popover p-1.5 text-popover-foreground shadow-lg
transition-[translate,opacity] motion-reduce:transition-none
```

Show: `translate-y-0 opacity-100 duration-200 ease-out`.  
Hide: `pointer-events-none translate-y-[calc(100%+1rem)] opacity-0 duration-150 ease-in`.  
Stay mounted. `aria-hidden` when empty. Do not unmount.

Left → right, all `items-center`, no wrap:

1. Count — `px-2 text-sm font-medium tabular-nums` → `{n} selected`
2. Clear — ghost `icon-sm` `X`, `aria-label="Clear selection"`
3. Vertical `Separator` — `mx-1 h-5`
4. Bulk pickers — ghost `size="sm"`: icon + label + `ChevronDown size-3`. Menus
   open **up** (`side="top"`, `align="center"`, `w-56 p-1`). Options are
   `px-2 py-1.5 text-sm rounded-sm hover:bg-muted` with a leading icon/avatar.
   Colony issues: **Assign** (`UserRound`), **Priority** (`Flag`), **Status**
   (`Check`).
5. Vertical `Separator` — `mx-1 h-5`
6. Delete — ghost `icon-sm` `Trash2`, `text-destructive hover:text-destructive`.
   Confirm in an alert dialog. Never delete from the bar in one click.

Disable every control while a bulk action is in flight. Success toast then
clears selection. Partial failure keeps the failed rows selected and toasts
`{failed} of {total} issues could not be {updated|assigned|deleted}` with
`The failed issues remain selected so you can retry.`

Do not: full-width footer, sticky table header, badge count, primary-colored
bar, or putting Delete next to Assign without a separator.

## Icons and avatars

Lucide throughout for **actions and status**. List glyphs 14px; chrome 16px;
stroke inherits currentColor.

**Never Lucide `Bot`** (or `BotMessageSquare`, `BotOff`, or any robot glyph).
The Colony ant is the agent/brand mark.

**Colony mark** — `project/gui/public/colony-mark.svg` is the brand file (also
served at `/colony-mark.svg`). Render it with `ColonyMark`
(`#/components/colony-mark`), which inlines the same SVG from
`src/components/colony-mark.svg` (Vite cannot import `public/`) and paints with
`currentColor`. Keep those two files identical. Use `ColonyMark` anywhere a
robot icon would otherwise go: Agents nav, Agents view header, sign-in, empty
states, generic “this is an agent” chrome. A specific agent uses `AgentMark` /
`AgentMarkGlyph` (same mark, tinted with that agent’s color). Do not use Lucide
`Bot`. Do not use `<img src="/colony-mark.svg">` in-product when the mark
should follow the surrounding text color.

People: colored initials circle (`font-semibold`, ~9px type at 20px).
Unassigned: `CircleDashed` with a tiny `UserRound` nested inside.

Labeled actions still take a leading Lucide icon (`data-icon="inline-start"`),
same as schedules:

| Action | Icon |
|---|---|
| New / Create | `Plus` |
| Duplicate | `CopyPlus` |
| Edit / Save | `SquarePen` |
| Archive | `Archive` |
| Workspace visibility | `Users` |
| Private visibility | `Lock` |
| GitHub | `GitHubIcon` (not Lucide) |

Hover cards for people; tooltips for unlabeled icon buttons.

## Motion

Default duration **150–200ms**, easing **ease-out**. Overlays 100ms. Toasts
~500ms with `cubic-bezier(0.22, 1, 0.36, 1)`.

Chevrons rotate (`-rotate-90` closed on list groups; `rotate-90` open on
sidebar). Live timing uses `animate-pulse` on the icon, not the row.

Always include `motion-reduce:animate-none` / `motion-reduce:transition-none`.

## Loading, empty, error

- **Loading:** Braille-style diagonal-swipe loader +
  `text-sm text-muted-foreground` (`Loading issues…`). Centered `py-12` in
  lists; inline in rows for live work (`Running`). Not a circular spinner.
- **Empty:** one sentence, `text-sm text-muted-foreground`, centered or in the
  group body at `text-xs`.
- **Error:** `text-sm text-destructive`, `role="alert"`. Inline under the field
  when possible; toast when the action already closed.

## Copy

- Short, concrete, sentence case: `New issue`, `Assigned to me`,
  `No issues match these filters.`
- Status labels: `In Progress`, `In Review` (not `IN_PROGRESS`).
- Toasts name the object: `Status updated on COL-1`.
- IDs are a prefix + number (`COL-12`), never `#12`.
- Dates: short month + day (`Aug 5`). Durations: `5m`, `1h 30m`, `1d 2h`. Em
  dash `—` for empty numeric meta.
- No exclamation marks, no emoji in chrome, no “Oops”.

## Accessibility baseline

- Icon-only controls have `aria-label`.
- Focus rings: `ring-2` or `ring-[3px] ring-ring/50` (never remove outline).
- Clickable rows ignore clicks that originate on
  `button, a, input, textarea, [role="combobox"]`.
- Persist collapsible state; don’t reset groups on every visit.
- `tabular-nums` on anything that twitches (time, counts, IDs).

## Do

- Semantic tokens. Warm neutrals. One primary per view.
- Fused group header + table. 36px rows. Hover-reveal checkboxes.
- Ghost filters. Container-query column hiding. Truncation.
- Lucide status and action icons. Colony mark for agents. Tiny tinted tag
  chips if needed.
- Quiet enter animations. Braille loaders. Inverted tooltips.

## Do not

- Blue as brand. Purple gradients. Glassmorphism everywhere (account hero is
  the exception).
- Colored status pills, neon badges, or a chip for every field.
- Card-per-row lists, two-line mobile layouts, or wrapping toolbars into
  hamburger without need.
- Drop shadows on tables. 24px+ display type. Inter as a “close enough” if Geist
  is available — use Geist.
- Spinners, skeleton shimmer walls, or autoplaying motion that ignores
  `prefers-reduced-motion`.
- Lucide `Bot` (or any robot glyph). Use `ColonyMark` from
  `public/colony-mark.svg`.
- Putting every action on-screen; hide rare actions in context menus / overflow.

## Applying this to another product

1. Copy the token table (light + dark) and `--radius: 0.625rem`.
2. Use Geist + Lucide.
3. Pick **Recipe A** (queues, issues, inboxes, logs) or **Recipe B** (resources,
   settings, catalogs).
4. Shell: collapsible sidebar + inset rounded main + 56px header.
5. One primary CTA; everything else ghost.
6. Match the density table before inventing new sizes.
7. When unsure, look at a Colony issues group: muted 32px header, hairline 36px
   rows, yellow `CircleDot` for “active”, muted IDs, medium titles.
