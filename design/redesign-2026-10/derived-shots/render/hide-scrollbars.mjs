// Preload for shoot-widths.mjs: launches Chromium with --hide-scrollbars so a tall phone board
// never measures with a scrollbar showing (that leaves 16px of blank ground under it on some runs).
// Usage: node --import ./derived-shots/render/hide-scrollbars.mjs derived-shots/render/shoot-widths.mjs ...
import { chromium } from 'playwright'

const launch = chromium.launch.bind(chromium)
chromium.launch = (opts = {}) => launch({ ...opts, args: [...(opts.args ?? []), '--hide-scrollbars'] })
