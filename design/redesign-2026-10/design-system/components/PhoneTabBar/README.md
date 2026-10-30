# PhoneTabBar

The bottom navigation on phones: five destinations, the middle one the camera for receipts.

## Classes

`.k-phone` frame (390px) with `.k-phone-top`, `.k-phone-body` and a `.k-tabbar` of five `.k-tabbar-item` links; the current one `.is-active` with `aria-current="page"`. A `.k-badge` inside an item shows waiting work.

## Rules

- Home, Sales, Receipt (camera), Bank, More. Everything else lives under More.
- Items are at least 48px tall; labels always visible.
- No keyboard hints on phone.
