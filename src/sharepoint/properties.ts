import type { Page } from './browser.js';
import { classify, type Issue, type PageEvents } from './debug.js';

/** A control of the web part's property pane, found again by kind, label and position. */
export interface PaneControl {
  kind: 'dropdown' | 'toggle' | 'checkbox' | 'choice' | 'text' | 'custom';
  label: string;
  /** Position among controls with the same kind and label. */
  n: number;
  value: string;
  options?: string[];
}

/** One change made in the property pane and what the component did after it. */
export interface PropertyStep {
  control: string;
  value: string;
  /** Labels of the controls the change revealed, explored one level deeper. */
  revealed: string[];
  issues: Issue[];
  /** SharePoint replaced the web part with its error message. */
  crashed: boolean;
  /** What the web part showed after the change (start of its text). */
  text: string;
  screenshot?: string;
}

export interface PropertyRun {
  /** The property pane opened; false means nothing was checked. */
  opened: boolean;
  controls: number;
  steps: PropertyStep[];
  /** Controls packman cannot drive generically (pickers, collection editors, buttons). */
  skipped: string[];
  truncated: boolean;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** In-page helpers: find controls of the open property pane and operate them like a person would. */
const HELPERS = `(() => {
  if (window.__packmanPane) return;
  const pane = () => document.querySelector('.spPropertyPaneContainer');
  const clean = (text) => (text || '').replace(/\\s+/g, ' ').trim().slice(0, 80);
  const labelOf = (el) => {
    const ids = el.getAttribute('aria-labelledby');
    let text = ids ? ids.split(' ').map((id) => document.getElementById(id)?.textContent || '').join(' ') : '';
    if (!clean(text)) text = el.getAttribute('aria-label') || '';
    if (!clean(text)) {
      let node = el.parentElement;
      for (let i = 0; i < 5 && node && !clean(text); i++, node = node.parentElement)
        text = node.querySelector('label, .ms-Label')?.textContent || '';
    }
    return clean(text);
  };
  const kinds = {
    dropdown: '[role=combobox]:not(input)',
    toggle: 'button[role=switch]',
    checkbox: 'input[type=checkbox]',
    choice: 'input[type=radio]',
    text: 'input[type=text], input[type=number], input[type=url], input:not([type]), textarea',
  };
  const all = () => {
    const root = pane();
    if (!root) return [];
    const out = [];
    const seen = new Map();
    for (const [kind, selector] of Object.entries(kinds))
      for (const el of root.querySelectorAll(selector)) {
        if (el.disabled || el.getAttribute('aria-disabled') === 'true' || el.closest('[aria-hidden=true]')) continue;
        if (kind === 'text' && el.getAttribute('role') === 'combobox') continue;
        const label = kind === 'choice' ? clean(el.closest('[role=radiogroup]') ? labelOf(el.closest('[role=radiogroup]')) : '') + ' = ' + clean(el.parentElement?.textContent || el.value) : labelOf(el);
        const key = kind + '|' + label;
        const n = seen.get(key) || 0;
        seen.set(key, n + 1);
        const value = kind === 'toggle' ? String(el.getAttribute('aria-checked')) : kind === 'checkbox' || kind === 'choice' ? String(el.checked) : kind === 'dropdown' ? clean(el.textContent) : el.value;
        out.push({ kind, label, n, value, el });
      }
    for (const el of root.querySelectorAll('button')) {
      if (el.matches(kinds.toggle) || el.closest('[role=combobox]') || el.getAttribute('aria-expanded') !== null) continue;
      const label = clean(el.textContent || el.getAttribute('aria-label'));
      if (label && !el.closest('.ms-TextField, .ms-Dropdown-container') && !/^(Indietro|Avanti|Back|Next|Applica|Apply|Chiudi|Close|Clear selection|Cancella selezione)$/i.test(label)) out.push({ kind: 'custom', label, n: 0, value: '', el });
    }
    return out;
  };
  const find = (kind, label, n) => all().find((c) => c.kind === kind && c.label === label && c.n === n);
  const setText = (el, value) => {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  };
  const options = async (el) => {
    el.click();
    await new Promise((r) => setTimeout(r, 400));
    const list = [...document.querySelectorAll('[role=listbox] [role=option]')].filter((o) => o.getAttribute('aria-disabled') !== 'true');
    const texts = list.map((o) => clean(o.textContent));
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    if (document.querySelector('[role=listbox]')) el.click();
    return texts;
  };
  window.__packmanPane = {
    // The container is always in the page; it is open when it shows a title and fields.
    open: () => { const p = pane(); return !!p && p.offsetWidth > 0 && clean(p.innerText).length > 0; },
    expand: () => { for (const b of pane()?.querySelectorAll('button[aria-expanded=false]') || []) if (!b.closest('[role=combobox]')) b.click(); },
    list: async () => {
      const out = [];
      for (const c of all()) {
        const entry = { kind: c.kind, label: c.label, n: c.n, value: c.value };
        if (c.kind === 'dropdown') entry.options = await options(c.el);
        out.push(entry);
      }
      return out;
    },
    set: async (kind, label, n, value) => {
      const c = find(kind, label, n);
      if (!c) return false;
      if (kind === 'toggle' || kind === 'checkbox') { if (String(c.value) !== value) (kind === 'checkbox' ? (c.el.closest('label') || c.el) : c.el).click(); return true; }
      if (kind === 'choice') { (c.el.closest('label') || c.el.parentElement.querySelector('label') || c.el).click(); return true; }
      if (kind === 'text') { setText(c.el, value); return true; }
      if (kind === 'dropdown') {
        c.el.click();
        await new Promise((r) => setTimeout(r, 400));
        const option = [...document.querySelectorAll('[role=listbox] [role=option]')].find((o) => clean(o.textContent) === value);
        if (!option) { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return false; }
        option.click();
        return true;
      }
      return false;
    },
    apply: () => { const b = [...(pane()?.querySelectorAll('button') || [])].find((x) => /^(Applica|Apply)$/i.test(clean(x.textContent))); if (b && !b.disabled) b.click(); },
  };
})()`;

const CRASH =
  /Si è verificato un errore|Something went wrong|Сталася помилка|Dettagli tecnici|Technical details/i;

/** Long lists (hours, minutes, years) are sampled: first, second, middle and last option. */
export function sampleOptions(options: string[]): string[] {
  if (options.length <= 8) return options;
  const picks = [0, 1, Math.floor(options.length / 2), options.length - 1];
  return [...new Set(picks)].map((index) => options[index] ?? '').filter(Boolean);
}

/** A value a person might type into a text field with this label. */
export function sampleText(label: string, current: string): string | undefined {
  if (/^\s*[[{]/.test(current) || /json/i.test(label)) return undefined;
  if (/url|link|sito|site|http|percorso|path/i.test(label))
    return 'https://example.com/packman-test';
  if (/mail/i.test(label)) return 'test@example.invalid';
  if (/^\d+$/.test(current) || /numero|number|count|limite|max|top/i.test(label)) return '3';
  return 'packman test';
}

/**
 * Drives every control of the open property pane: each dropdown option, both toggle and checkbox
 * states, each choice, and a typed value for text fields. A change that reveals new controls (a
 * template selector) has them explored too, one level deeper. Every change is restored afterwards.
 */
export async function exploreProperties(
  page: Page,
  options: {
    events: PageEvents;
    origin: string;
    known: string[];
    screenshot: (name: string) => Promise<string>;
    maxSteps?: number;
  },
): Promise<PropertyRun> {
  const maxSteps = options.maxSteps ?? 150;
  await page.evaluate(HELPERS);
  const run: PropertyRun = { opened: false, controls: 0, steps: [], skipped: [], truncated: false };
  const openPane = async (): Promise<boolean> => {
    if (await page.evaluate<boolean>('window.__packmanPane.open()')) return true;
    // The web part's own edit button (sections have one too), after selecting the web part.
    for (let attempt = 0; attempt < 5; attempt++) {
      await page.evaluate(`(() => {
        const part = document.querySelector('[data-automation-id=CanvasControl]');
        part?.click();
        const buttons = [...document.querySelectorAll('[data-automation-id=configureButton]')];
        (buttons.find((b) => /web ?part/i.test(b.getAttribute('aria-label') || b.title || '')) || buttons[0])?.click();
      })()`);
      await sleep(1500);
      if (await page.evaluate<boolean>('window.__packmanPane.open()')) return true;
    }
    return false;
  };
  if (!(await openPane())) return run;
  run.opened = true;
  const list = async (): Promise<PaneControl[]> => {
    await page.evaluate('window.__packmanPane.expand()');
    await sleep(300);
    return page.evaluate<PaneControl[]>('window.__packmanPane.list()');
  };
  const keyOf = (control: PaneControl): string => `${control.kind}|${control.label}|${control.n}`;
  const mark = (): number[] => [
    options.events.exceptions.length,
    options.events.console.length,
    options.events.responses.length,
  ];
  const set = async (control: PaneControl, value: string): Promise<boolean> => {
    await openPane();
    const done = await page.evaluate<boolean>(
      `window.__packmanPane.set(${JSON.stringify(control.kind)}, ${JSON.stringify(control.label)}, ${control.n}, ${JSON.stringify(value)})`,
    );
    await page.evaluate('window.__packmanPane.apply()');
    await sleep(2500);
    return done;
  };
  const step = async (
    control: PaneControl,
    value: string,
    before: PaneControl[],
    depth: number,
  ): Promise<void> => {
    if (run.steps.length >= maxSteps) {
      run.truncated = true;
      return;
    }
    const at = mark();
    if (!(await set(control, value))) return;
    const delta: PageEvents = {
      exceptions: options.events.exceptions.slice(at[0]),
      console: options.events.console.slice(at[1]),
      responses: options.events.responses.slice(at[2]),
      failed: [],
      requests: [],
    };
    const issues = classify(delta, options.origin, options.known).filter(
      (issue) => issue.kind !== 'host',
    );
    const text = await page.evaluate<string>(
      `(document.querySelector('[data-automation-id=CanvasZone]') || document.body).innerText`,
    );
    const crashed = CRASH.test(text);
    const after = await list();
    // New controls, and dropdowns whose options changed (a template type filling a template list).
    const previous = new Map(
      before.map((entry) => [keyOf(entry), JSON.stringify(entry.options ?? [])]),
    );
    const revealed = after.filter(
      (entry) =>
        entry.kind !== 'custom' &&
        keyOf(entry) !== keyOf(control) &&
        (!previous.has(keyOf(entry)) ||
          previous.get(keyOf(entry)) !== JSON.stringify(entry.options ?? [])),
    );
    const entry: PropertyStep = {
      control: `${control.kind} ${control.label}${control.n ? ` #${control.n + 1}` : ''}`,
      value,
      revealed: revealed.map((item) => item.label),
      issues,
      crashed,
      text: text.replace(/\s+/g, ' ').trim().slice(0, 200),
    };
    if (crashed || issues.some((issue) => issue.kind === 'runtime' || issue.kind === 'load'))
      entry.screenshot = await options.screenshot(`${run.steps.length + 1}`);
    run.steps.push(entry);
    if (depth < 2) for (const child of revealed) await exercise(child, after, depth + 1);
  };
  const exercise = async (
    control: PaneControl,
    context: PaneControl[],
    depth: number,
  ): Promise<void> => {
    switch (control.kind) {
      case 'dropdown': {
        for (const option of sampleOptions(control.options ?? []))
          if (option !== control.value) await step(control, option, context, depth);
        if (control.value && (control.options ?? []).includes(control.value))
          await set(control, control.value);
        // An empty selection cannot be restored: compare later changes with the pane as it is now.
        else if (depth === 0) baseline = await list();
        break;
      }
      case 'toggle':
      case 'checkbox': {
        const flipped = control.value === 'true' ? 'false' : 'true';
        await step(control, flipped, context, depth);
        await set(control, control.value);
        break;
      }
      case 'choice': {
        if (control.value === 'true') break;
        await step(control, 'true', context, depth);
        // Choices of one group share the label prefix; select the one that was selected before.
        const group = control.label.split(' = ')[0];
        const original = context.find(
          (entry) =>
            entry.kind === 'choice' &&
            entry.value === 'true' &&
            entry.label.split(' = ')[0] === group,
        );
        if (original) await set(original, 'true');
        break;
      }
      case 'text': {
        const sample = sampleText(control.label, control.value);
        if (sample === undefined || sample === control.value) break;
        await step(control, sample, context, depth);
        await set(control, control.value);
        break;
      }
      case 'custom':
        break;
    }
  };
  const controls = await list();
  let baseline = controls;
  run.controls = controls.length;
  run.skipped = [
    ...new Set(
      controls
        .filter((control) => control.kind === 'custom' && /[\p{L}\p{N}]/u.test(control.label))
        .map((control) => control.label),
    ),
  ];
  for (const control of controls) await exercise(control, baseline, 0);
  return run;
}
