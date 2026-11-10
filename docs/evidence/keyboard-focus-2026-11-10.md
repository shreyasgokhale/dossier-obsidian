# Keyboard focus reproduction — 2026-11-10

Environment: Node 24.19.0, Yarn 4.18.1, Playwright 1.64.1 / Chromium 1248,
production standalone server, disposable PostgreSQL 18.6 databases and fake
AI/job/Google services. No private inputs or remote runtime were accessed.

The original command passed once and on 20 repeats on this machine:

```sh
yarn playwright test e2e/applications.spec.ts -g 'moves a card from the keyboard'
```

A minimal browser reproduction added only Chrome DevTools
`Emulation.setCPUThrottlingRate` with `rate: 8` before navigation, then focused
the same Actions button, pressed Enter, and asserted the first `menuitemradio`
was focused. All five repeats failed with the handoff's exact symptom:

```text
Expect "toBeFocused" getByRole('menuitemradio').first()
locator resolved to <div tabindex="-1" role="menuitemradio" ...>
unexpected value "inactive"
5 failed, 1 passed (the sign-in setup)
```

An init-script probe recorded keyboard-listener registration and focus events:

| Relative browser time (ms) | Event |
| --- | --- |
| 1286 | Actions trigger focused |
| 1328 | Enter keydown on the trigger |
| 1543–1545 | Menu document keydown listeners registered |
| 1678 | Menu container focused; no item focus followed |

There were no intervening pointer events or element-remount focus transitions.
Radix's keyboard-modality listener mounts in a passive effect and misses the
early opening key. Its entry-focus handler therefore treats the opening as a
pointer interaction and prevents focus from moving to the first item.

The shared dropdown wrapper now records opening intent in the trigger's React
key handler, which also receives hydration replay. When the menu container takes
focus after a keyboard opening, the wrapper focuses its first enabled menu item.
Pointer openings reset that intent; Radix still manages navigation, dismissal
and returning focus to the trigger.

The permanent regression lives in `e2e/applications.spec.ts`. It preserves the
original first-item focus, arrow navigation, selection and board-move assertions,
and adds Escape/focus-return/reopening checks. Slow-client variants cover Enter,
Space and ArrowDown. After the fix:

```sh
yarn playwright test e2e/applications.spec.ts -g 'moves a card from the keyboard' --repeat-each=5
# 21 passed: sign-in setup plus 20 keyboard workflows
```

Temporary instrumentation and the minimized harness are confined to ignored
`work/`; no debug logging is included in application code.
