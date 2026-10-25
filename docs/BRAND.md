# Xtracsys Editor Brand Notes

## Source of truth

The visual authority is the supplied brand reference sheet, archived at
`design/brand-reference.png`. This document records what was measured from
that asset — no color here is a guess.

## Brand tokens (sampled directly from the asset)

| Token | Value | Where it appears in the sheet |
| --- | --- | --- |
| Warm white | `#F6F5F1` | Page background; WARM WHITE swatch |
| Black | `#080808` | Logo strokes on light; BLACK swatch |
| Dark field | `#0A0B0C` | The inverse/dark-field panel background |
| Rust accent | `#B14831` | RUST ACCENT swatch; the emblem needle |
| White | `#FFFFFF` | Inverse logo strokes |

## How the tokens are used

- **Light theme**: warm-white surfaces (`#F6F5F1`), black text/graphics
  (`#080808`), rust accents (`#B14831`). The black logo treatment is used on
  light backgrounds.
- **Dark theme**: dark-field surfaces (`#0A0B0C`), warm-white text/graphics
  (`#F6F5F1`), restrained rust accents. The white (inverse) logo treatment is
  used on dark backgrounds.

## Derived shades — explicitly not official tokens

Interface chrome needs more than five values (borders, muted text, hover
states, dark-theme link tints). Derived shades are arithmetic interpolations
between the sampled tokens, chosen to keep WCAG AA contrast for body text and
controls:

- Light: borders `#DDD9CD`, muted text `#67645C`, link/rust-text `#9E3F2B`
  (rust darkened to ≥5:1 on warm white)
- Dark: borders `#26292C`, muted text `#9C9992`, accents `#C0593F` and
  link-text `#D0795F` (rust lifted for ≥4.5:1 on the dark field)

These are documented in `frontend/src/styles/base.css` and are **not** claimed
to be official brand tokens. When production brand guidelines are published,
reconcile them here first.

## Logo assets — temporary, clearly labeled

Production-ready (vector) logo assets were not supplied. The assets in this
repository are **temporary raster crops** taken from the reference sheet:

| File | Contents |
| --- | --- |
| `design/brand-reference.png` | The supplied sheet (archived source) |
| `design/crops/B_light_emblem_tight.png` | Black emblem on warm white (497×509) |
| `design/crops/E_inverse_emblem_tight.png` | White emblem on dark field (497×509) |
| `frontend/public/logo-light.png` / `logo-dark.png` | The two crops above, used in the UI |
| `build/appicon.png`, `build/darwin/icon.icns`, `build/windows/icon.ico`, `build/linux/*.png` | App icons: white emblem centered on the dark field, composed by `scripts/make-icons.py` |

Both emblem crops measure exactly 497×509 px — identical geometry in the two
treatments — and are used at native aspect ratio everywhere. The app icon
upscales the emblem 1.4× with LANCZOS resampling.

**Request to the brand team:** supply production vector (SVG) sources for the
emblem and wordmark, plus official UI color tokens including dark-theme accent
values. Until then, every derived asset is labeled temporary.
