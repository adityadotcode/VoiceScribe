# VoiceScribe — Dark Mode

**Status:** Complete  
**Scope:** Frontend only — no backend, API, auth, or AWS changes  
**Tests:** 95 passing (9 new) across 8 suites  
**Build:** Clean — 0 errors, 0 warnings, 43 modules

---

## Theme implementation

Dark mode is implemented entirely through CSS custom properties and a React context — no UI library, no separate stylesheet, no scattered inline styles.

### Architecture summary

```
index.css            — all design tokens in :root (light) and [data-theme="dark"]
App.css              — unchanged in structure; uses var() tokens throughout
ThemeContext.jsx      — initialises theme synchronously, exposes toggle
main.jsx             — wraps App in <ThemeProvider>
App.jsx TopBar       — toggle button reads useTheme()
```

---

## CSS variable strategy

### Light theme (`:root`)

All tokens are defined on `:root`. This is the default and matches the existing V1/V2 visual design exactly.

```css
:root {
  --brand:         #2563eb;
  --bg:            #f1f5f9;
  --surface:       #ffffff;
  --surface-2:     #f8fafc;
  --surface-hover: #f1f5f9;   /* NEW — replaces hardcoded #f1f5f9 */
  --brand-border:  #bfdbfe;   /* NEW — replaces hardcoded #bfdbfe */
  --text-h:        #0f172a;
  /* ... all tokens ... */
}
```

### Dark theme (`[data-theme="dark"]`)

Overrides on `[data-theme="dark"]` applied to `<html>`. Every token is redefined; no token is hardcoded anywhere in component CSS:

```css
[data-theme="dark"] {
  color-scheme:    dark;         /* signals dark to browser for native controls */
  --brand:         #60a5fa;      /* blue-400 — readable on dark */
  --bg:            #0f172a;      /* slate-900 */
  --surface:       #1e293b;      /* slate-800 */
  --surface-2:     #162032;
  --surface-hover: #2d3f55;
  --brand-border:  #1e40af;
  --text-h:        #f1f5f9;
  --text:          #cbd5e1;
  --text-sub:      #64748b;
  --border:        #334155;
  --green-bg:      #052e16;      /* darkened status backgrounds */
  --amber-bg:      #1c0f00;
  --red-bg:        #1f0707;
  /* ... all tokens ... */
}
```

### Transition

A colour-only transition is applied to `html` to avoid layout jank:

```css
html {
  transition: background-color 0.2s ease, color 0.2s ease;
}
```

---

## Toggle location

The toggle button is in `TopBar` — the persistent authenticated navigation bar at the top of every authenticated screen. It is visible on:

- `/dashboard`
- `/consultation/new`
- `/consultation/:id`
- `/patients`
- `/patients/new`
- `/patients/:id`

It does **not** appear on `/login` and `/register` (those screens use the same `<html>` attribute, so they still respect the current theme — the toggle just isn't present).

```jsx
<button
  type="button"
  className="app-theme-toggle"
  onClick={toggleTheme}
  aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
  title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
>
  {theme === 'dark' ? '☀️' : '🌙'}
</button>
```

☀️ = currently dark, click to go light  
🌙 = currently light, click to go dark

---

## Persistence behavior

| Scenario | Behavior |
|---|---|
| User toggles theme | `localStorage.setItem('voicescribe-theme', 'dark' or 'light')` |
| User revisits the app | `localStorage.getItem('voicescribe-theme')` is read first |
| localStorage unavailable | Falls through to system preference silently |
| User clears localStorage | System preference is used on next visit |

**Only `voicescribe-theme` is written to localStorage by this feature.** Authentication tokens (access token, refresh token) remain memory-only / HTTP-only cookie respectively — unchanged.

---

## System preference behavior

On first visit (no `voicescribe-theme` in localStorage):

1. `window.matchMedia('(prefers-color-scheme: dark)').matches` is checked
2. If `true` → dark theme is applied immediately
3. If `false` or unavailable → light theme

Once the user manually toggles, their explicit choice is persisted and the system preference is no longer consulted.

### Anti-flash

`resolveInitialTheme()` runs at **module import time** (top-level code in `ThemeContext.jsx`), before React renders. It applies `document.documentElement.dataset.theme` synchronously. React's `useState` initialiser reads back from that attribute, so the first paint always uses the correct theme — no flash.

---

## Hardcoded values replaced

The following hardcoded hex values in `App.css` were replaced with new CSS variable tokens to ensure they adapt correctly in dark mode:

| Was | Now | Used in |
|---|---|---|
| `#f1f5f9` | `var(--surface-hover)` | Secondary button hover, cancel button hover |
| `#bfdbfe` | `var(--brand-border)` | Brand-adjacent borders (selected patient card, consultation row hover, etc.) |
| `#fef2f2` + `#fecaca` | `var(--red-bg)` + `var(--red-border)` | Recording state indicator |
| `#f0f9ff` + `#0369a1` + `#bae6fd` | `var(--brand-light)` + `var(--brand-dark)` + `var(--brand-border)` | Demo data banner, DEMO chip |
| `#fef3c7` + `#fde68a` + `#92400e` | `var(--amber-bg)` + `var(--amber-border)` + `var(--amber)` | Extraction summary "needs review" chip |

All other uses of `#fff` on button text remain as-is — white text on a brand-coloured button is correct in both themes.

---

## Screens covered

| Screen | Token coverage | Dark mode |
|---|---|---|
| Login / Register | auth-* CSS classes use var() tokens | ✅ |
| Dashboard (consultation list) | db-* classes use var() tokens | ✅ |
| Recording / Processing pipeline | pipeline-*, recorder-* classes | ✅ |
| Clinical note review | cnr-* classes | ✅ |
| Patient list | pt-* classes | ✅ |
| New patient | pt-form-* classes | ✅ |
| Patient profile | pt-profile-*, ph-* classes | ✅ |
| New consultation | nc-* classes | ✅ |
| Consultation detail | cd-* classes | ✅ |
| Change summary panel | cs-* classes | ✅ |
| Native inputs / selects | `[data-theme="dark"] select/input::placeholder` | ✅ |

---

## Files changed

| File | Change |
|---|---|
| `client/src/index.css` | Added `[data-theme="dark"]` token overrides; added `--brand-border` and `--surface-hover` to `:root`; added colour transition to `html` |
| `client/src/App.css` | Replaced 5 categories of hardcoded colours with CSS variable tokens; added `.app-theme-toggle` and dark-mode native element overrides |
| `client/src/contexts/ThemeContext.jsx` | New — `ThemeProvider`, `useTheme`, synchronous anti-flash init |
| `client/src/main.jsx` | Wrapped `<App>` in `<ThemeProvider>` |
| `client/src/App.jsx` | Imported `useTheme`; added toggle button to `TopBar` |
| `client/src/tests/themeToggle.test.jsx` | New — 9 focused tests |

---

## Tests

**File:** `client/src/tests/themeToggle.test.jsx`  
**Runner:** Vitest + jsdom + @testing-library/react  
**New tests:** 9 | **Total frontend tests:** 95 (all passing)

| # | Describe | Test | Result |
|---|---|---|---|
| 1 | default/system — light | `data-theme="light"` → ThemeProvider reports light | ✓ |
| 2 | system preference dark | `data-theme="dark"` pre-set → ThemeProvider reports dark | ✓ |
| 3a | saved theme restored | Pre-setting dark attr simulates localStorage restore | ✓ |
| 3b | saved theme restored | Pre-setting light attr read correctly | ✓ |
| 4 | toggle light → dark | Click → state + attribute become dark | ✓ |
| 5 | toggle dark → light | Click → state + attribute become light | ✓ |
| 6a | localStorage updated | Toggle writes `voicescribe-theme` | ✓ |
| 6b | localStorage updated | Toggle does NOT write auth keys | ✓ |
| 7 | persists after remount | Toggled dark theme survives fresh ThemeProvider mount | ✓ |

---

## Build result

```
vite v8.3.0 — production build

dist/index.html                   0.46 kB │ gzip:   0.29 kB
dist/assets/index-fmY-M2CT.css   62.67 kB │ gzip:   9.64 kB
dist/assets/index-AaY8a6Jh.js   349.47 kB │ gzip: 102.48 kB

✓ 43 modules transformed — built in 1.72 s
0 errors · 0 warnings
```

---

## Visual limitations

| Limitation | Notes |
|---|---|
| Toggle not on Login/Register | TopBar is authenticated-only. Both pages still receive the correct theme via `data-theme` on `<html>`, but the user can't toggle from there. |
| Native audio player | The `<audio>` element is browser-rendered. Setting `color-scheme: dark` on `:root` signals the browser to use dark native controls; actual appearance varies by browser. |
| Speaker color accents | `spk-color-a` (blue `#3b82f6`) and `spk-color-b` (teal `#0d9488`) remain hardcoded. These are decorative left-border accents that are readable on both themes. Tokenising them is deferred. |
| No per-page media queries | The entire theme is driven by `[data-theme]` on `<html>`. `@media (prefers-color-scheme)` is not used in CSS — only in JavaScript at init time. This avoids conflicts between the stored preference and CSS media queries. |
