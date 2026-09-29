# Design Brief

## Direction

RedWallet — a calm, security-first XBT wallet that reads like a premium banking instrument, not a crypto toy.

## Tone

Dark, restrained, and precise — deep charcoal surfaces with one confident crimson accent; warmth comes from the near-black red undertone, never from decoration.

## Differentiation

The balance card is treated as a physical object: a crimson gradient slab with a soft red ambient glow, monospace amounts, and a persistent DEMO MODE pill that makes trust explicit rather than implied.

## Color Palette

| Token      | OKLCH         | Role                                  |
| ---------- | ------------- | ------------------------------------- |
| background | 0.15 0.012 25 | App canvas, warm near-black           |
| foreground | 0.96 0.004 25 | Primary text                          |
| card       | 0.195 0.014 25 | Elevated surfaces, list rows          |
| primary    | 0.545 0.205 27 | Brand crimson: balance card, CTAs, active tab |
| accent     | 0.78 0.115 85 | Warm gold: demo pill, status dots     |
| muted      | 0.235 0.014 25 | Inactive surfaces, tab bar            |
| success    | 0.72 0.155 150 | Incoming amounts                      |
| destructive | 0.62 0.21 25 | Outgoing amounts, destructive actions |

## Typography

- Display: Space Grotesk — wordmark, balance figure, section headings (tight tracking)
- Body: Figtree — labels, body copy, navigation
- Mono: JetBrains Mono — addresses, amounts, timestamps
- Scale: hero `text-4xl md:text-5xl font-bold tracking-tight`, h2 `text-xl md:text-2xl font-semibold tracking-tight`, label `text-xs font-semibold tracking-widest uppercase text-muted-foreground`, body `text-sm md:text-base`

## Elevation & Depth

Three tiers: flat `bg-background` canvas, `bg-card` with `border-border` for rows, and `shadow-elevated` only on the balance card, bottom tab bar, and modals; no glassmorphism.

## Structural Zones

| Zone         | Background              | Border        | Notes                                          |
| ------------ | ----------------------- | ------------- | ---------------------------------------------- |
| Header       | `bg-card`               | `border-b`    | Wordmark + DEMO MODE pill; sticky, safe-top     |
| Content      | `bg-background`         | —             | Alternating `bg-muted/30` sections for rhythm   |
| Balance card | `bg-gradient-primary`   | none          | `shadow-card-red`, 20px radius, gold demo chip  |
| Tab bar      | `bg-card/95 backdrop-blur` | `border-t` | Mobile bottom nav, `safe-bottom`, 4 tabs        |
| Sidebar      | `bg-sidebar`            | `border-r`    | Desktop ≥lg only, same 4 destinations           |
| Footer       | `bg-muted/40`           | `border-t`    | Legal + demo-data disclaimer, desktop only      |

## Spacing & Rhythm

Mobile gutters `px-4`, desktop `px-8`; section gaps `space-y-6 md:space-y-8`; card padding `p-4 md:p-6`; micro-spacing `gap-2`/`gap-3`; 44px minimum touch targets.

## Component Patterns

- Buttons: `rounded-xl`, primary = crimson gradient + white text, secondary = `bg-secondary` + border, hover lifts with `shadow-subtle` and `transition-smooth`
- Cards: `rounded-2xl` (16–20px), `bg-card`, 1px `border-border`, `shadow-subtle`; balance card uses gradient + `shadow-card-red`
- Badges: pill `rounded-full`, DEMO MODE = gold `bg-accent/15 text-accent`, status = green/gold dot + label
- List rows: `rounded-xl` hover `bg-muted/60`, 40px circular monogram avatar, amount right-aligned in mono

## Motion

- Entrance: `animate-fade-up` staggered ~60ms per row on dashboard mount
- Hover: `transition-smooth` 300ms on buttons, rows, and tabs; subtle translate-y lift
- Decorative: `animate-pulse-soft` on the demo/status dot only — one motion story, no bouncing

## Constraints

- Dark mode only (`color-scheme: dark`); no light theme in this build
- Mobile-first with bottom tab bar; sidebar appears only at `lg`
- Demo data must be visibly labeled on every screen; no live price chart, no address book, no seed/key/transaction-signing UI
- Tokens only in components — no hex, `rgb()`, or arbitrary color classes

## Signature Detail

The balance card as a crimson gradient slab with a soft red ambient glow beneath it and monospace digits — a banknote-like material treatment that carries the whole brand.
