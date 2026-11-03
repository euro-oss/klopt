# Button

A button runs an action; at most one primary (black) button per view, and every button with a shortcut shows its key inside.

## Classes

| Class | Use |
| --- | --- |
| `.k-btn` | Secondary: white with a `line-control` border. The default. |
| `.k-btn--primary` | The one main action of the view (New invoice, Review and send, Send reminders). `primary` fill, `on-primary` text. |
| `.k-btn--ghost` | Quiet actions in toolbars and dialogs (Cancel, Close). |
| `.k-btn--sm` | 32px, inside rows, cards and detail panels. |
| `.k-btn--icon` | Square icon-only; always give it an `aria-label`. |
| `.k-btn--dashed` | "Add a …" inside editable tables. |

## Rules

- Labels are verbs plus the object: "Send reminders", "Start matching", not "OK" or "Submit".
- Put the shortcut last in the label: `<span class="k-kbd">C</span>`, or a chord in `.k-chord`. Inside primary use `.k-kbd--on-primary`.
- Never yellow. Yellow is for selection and waiting work, not for actions.
- A link that navigates can wear `.k-btn` on an `<a href>`; a button that changes data is a `<button>`.
