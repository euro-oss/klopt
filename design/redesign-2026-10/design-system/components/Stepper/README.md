# Stepper

The numbered steps of a wizard (import, setup), showing what is done, where you are and what comes next.

## Classes

`.k-steps` (an `<ol>`) with `.k-step` items holding a `.k-step-n` number; add `.is-done` (number becomes ✓) or `.is-current` (with `aria-current="step"`).

## Rules

- Short step names, one or two words. Six steps or fewer on screen; group the rest ("Import 10 steps" shows the six that matter to the user).
- Done steps stay clickable to go back; steps to come are not.
- `↵` continues, `Esc` goes back a step.
