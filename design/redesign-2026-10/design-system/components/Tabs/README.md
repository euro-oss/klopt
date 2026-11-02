# Tabs

Two kinds: underline tabs switch between sections of a page (Invoices, Reminders, Customers); segmented tabs filter the list below them (All, Open, Paid).

## Classes

- `.k-tabs` with `.k-tab` links; the current one gets `.is-active` and `aria-current="page"`.
- `.k-seg` (`role="tablist"`) with `.k-seg-item` buttons and a `.k-count`.

## Rules

- Sections that used to be separate menu items become underline tabs on their parent page.
- Segmented filters always show their count, including 0.
- Keys `1`–`4` switch filters when the list has focus.
