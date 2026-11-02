# Menu

A popover list of choices or actions, anchored to the control that opened it: the administration switcher, a "More actions" button.

## Classes

`.k-menu` (`role="menu"`) with `.k-menu-label` group headings, `.k-menu-item` buttons (`aria-selected` for the keyboard cursor, `aria-checked` for the current choice) and `.k-menu-sep`.

## Rules

- Opens on click or `↵`, closes on `Esc` or a choice. Arrow keys move, number keys pick the first nine items.
- Destructive actions go last, after a separator, in `danger` text.
