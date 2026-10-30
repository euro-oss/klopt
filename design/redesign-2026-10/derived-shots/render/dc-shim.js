/*
 * Minimal stand-in for the Claude Design runtime (support.js), used only to render
 * .dc.html boards headless for screenshots. It understands what the boards use:
 * <x-dc>, <helmet>, {{expr}} in text and attributes, on* handlers, <sc-for list as>,
 * <sc-if value>, <dc-import name hint-size> and a DCLogic class with props, state,
 * setState and renderVals. It is not the real runtime; Claude Design is the reference.
 */
(function () {
  const cache = {};

  class DCLogic {
    constructor(props) { this.props = props || {}; this.state = {}; }
    setState(patch) { this.state = { ...this.state, ...patch }; if (this.__rerender) this.__rerender(); }
    renderVals() { return {}; }
  }
  window.DCLogic = DCLogic;

  const evalIn = (expr, scope) => {
    try { return new Function('s', 'with(s){return (' + expr + ')}')(scope); }
    catch (e) { console.warn('dc-shim: cannot evaluate', expr, e.message); return undefined; }
  };
  const ONE = /^\s*\{\{([\s\S]+?)\}\}\s*$/;
  const ANY = /\{\{([\s\S]+?)\}\}/g;
  const interp = (str, scope) => str.replace(ANY, (_, e) => { const v = evalIn(e, scope); return v == null ? '' : String(v); });

  function parseDc(text) {
    const doc = new DOMParser().parseFromString(text, 'text/html');
    const xdc = doc.querySelector('x-dc');
    const script = doc.querySelector('script[data-dc-script]');
    const propsSpec = script ? JSON.parse(script.getAttribute('data-props') || '{}') : {};
    const Cls = script ? new Function('DCLogic', script.textContent + '\n;return Component;')(DCLogic) : DCLogic;
    const helmet = xdc.querySelector('helmet');
    const nodes = [...xdc.childNodes].filter((n) => n !== helmet);
    return { Cls, propsSpec, helmet, nodes };
  }

  async function load(name, base) {
    const url = new URL(name + '.dc.html', base).href;
    if (!cache[url]) {
      const text = await (await fetch(url)).text();
      cache[url] = parseDc(text);
      cache[url].url = url;
      const names = [...text.matchAll(/<dc-import[^>]*\bname="([^"]+)"/g)].map((m) => m[1]);
      for (const n of names) await load(n, url);
    }
    return cache[url];
  }

  function defaults(spec) {
    const p = {};
    for (const [k, v] of Object.entries(spec)) if (!k.startsWith('$') && v && 'default' in v) p[k] = v.default;
    return p;
  }

  function mount(def, props, host) {
    const inst = new def.Cls({ ...defaults(def.propsSpec), ...props });
    const draw = () => {
      const scope = inst.renderVals() || {};
      host.replaceChildren(...def.nodes.flatMap((n) => render(n, scope, def.url)));
    };
    inst.__rerender = draw;
    draw();
  }

  function render(node, scope, base) {
    if (node.nodeType === 3) return [document.createTextNode(interp(node.textContent, scope))];
    if (node.nodeType !== 1) return [];
    const tag = node.tagName.toLowerCase();
    if (tag === 'sc-for') {
      const list = evalIn(node.getAttribute('list').replace(ANY, '$1'), scope) || [];
      const as = node.getAttribute('as') || 'item';
      return list.flatMap((item, i) => [...node.childNodes].flatMap((c) => render(c, { ...scope, [as]: item, $index: i }, base)));
    }
    if (tag === 'sc-if') {
      const v = evalIn(node.getAttribute('value').replace(ANY, '$1'), scope);
      return v ? [...node.childNodes].flatMap((c) => render(c, scope, base)) : [];
    }
    if (tag === 'dc-import') {
      const el = document.createElement('div');
      const [w, h] = (node.getAttribute('hint-size') || '').split(',');
      el.setAttribute('data-dc-import', node.getAttribute('name'));
      el.style.cssText = 'display:flex;flex-direction:column;flex:none;' + (w ? 'width:' + w + ';' : '') + (h ? 'min-height:' + h + ';' : '');
      const props = {};
      for (const a of node.attributes) {
        if (a.name === 'name' || a.name.startsWith('hint-')) continue;
        const m = a.value.match(ONE);
        props[a.name] = m ? evalIn(m[1], scope) : interp(a.value, scope);
      }
      const def = cache[new URL(node.getAttribute('name') + '.dc.html', base).href];
      if (def) mount(def, props, el);
      return [el];
    }
    const el = document.createElementNS(node.namespaceURI, node.tagName.includes(':') ? node.tagName : (node.namespaceURI === 'http://www.w3.org/1999/xhtml' ? tag : node.tagName));
    for (const a of node.attributes) {
      if (a.name.startsWith('hint-')) continue;
      const m = a.value.match(ONE);
      if (m) {
        const v = evalIn(m[1], scope);
        if (typeof v === 'function') { if (/^on/i.test(a.name)) el.addEventListener(a.name.slice(2).toLowerCase(), v); continue; }
        if (v === false || v == null) continue;
        el.setAttribute(a.name, v === true ? '' : String(v));
      } else el.setAttribute(a.name, interp(a.value, scope));
    }
    for (const c of node.childNodes) for (const r of render(c, scope, base)) el.appendChild(r);
    return [el];
  }

  async function boot() {
    const xdc = document.querySelector('x-dc');
    if (!xdc) return;
    const self = parseDc(document.documentElement.outerHTML);
    self.url = location.href;
    cache[location.href] = self;
    for (const m of document.documentElement.outerHTML.matchAll(/<dc-import[^>]*\bname="([^"]+)"/g)) await load(m[1], location.href);
    const helmets = [self.helmet, ...Object.values(cache).map((d) => d.helmet)].filter(Boolean);
    for (const h of helmets) for (const c of h.children) document.head.appendChild(document.importNode(c, true));
    const params = Object.fromEntries(new URLSearchParams(location.search));
    const host = document.createElement('div');
    host.id = 'dc-root';
    xdc.replaceWith(host);
    mount(self, params, host);
    await document.fonts.ready;
    window.__dcReady = true;
  }
  document.addEventListener('DOMContentLoaded', () => { boot().catch((e) => { console.error(e); window.__dcError = String(e); }); });
})();
