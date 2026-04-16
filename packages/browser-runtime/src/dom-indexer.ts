/**
 * DOM Element Indexer — Inspired by browser-use's ClickableElementDetector + DOMTreeSerializer
 *
 * Extracts all interactive elements from the current page, assigns sequential numeric indices,
 * and returns a structured snapshot the LLM can use for precise element targeting.
 *
 * Instead of the model guessing pixel coordinates from screenshots, it gets:
 *   [1] button "Submit Order"
 *   [2] input[email] placeholder="you@example.com"
 *   [3] link "About Us" → /about
 *
 * Then the model says: click_element(index=2) — and we resolve via stored selector.
 */

import type { Page } from "playwright";

// ── Types ────────────────────────────────────────────────────────────

export interface IndexedElement {
  /** Sequential index starting from 1 */
  index: number;
  /** HTML tag name (lowercase) */
  tag: string;
  /** ARIA role if present */
  role?: string;
  /** Accessible name: text content, aria-label, label text, or placeholder */
  name?: string;
  /** Input type (text, email, password, checkbox, etc.) */
  type?: string;
  /** Current value of the element */
  value?: string;
  /** Placeholder text */
  placeholder?: string;
  /** Link href (for <a> tags) */
  href?: string;
  /** Whether the element is disabled */
  disabled?: boolean;
  /** Whether the element is required */
  required?: boolean;
  /** Whether the element is currently checked (checkboxes/radios) */
  checked?: boolean;
  /** Bounding rectangle in viewport coordinates */
  bounds: { x: number; y: number; width: number; height: number };
  /** CSS selector that uniquely identifies this element */
  selector: string;
  /** Whether this element appeared since the last snapshot */
  isNew?: boolean;
  /** Select options (for <select> elements, first 6) */
  options?: string[];
}

export interface DOMSnapshot {
  /** All interactive elements with their indices */
  elements: IndexedElement[];
  /** Page title */
  pageTitle: string;
  /** Current URL */
  pageUrl: string;
  /** Scroll position */
  scrollPosition: { x: number; y: number };
  /** Total page height */
  pageHeight: number;
  /** Viewport height */
  viewportHeight: number;
  /** Timestamp of snapshot */
  timestamp: number;
  /** Total interactive element count */
  totalElements: number;
  /** How many elements are in viewport */
  visibleInViewport: number;
}

// ── Extraction Script (runs inside the browser) ──────────────────────

/**
 * This script runs inside the browser via Playwright page.evaluate().
 * It walks the DOM, detects interactive elements, and returns structured data.
 *
 * Ported from browser-use's ClickableElementDetector heuristics:
 * - Interactive HTML tags (button, input, select, textarea, a, details, summary)
 * - ARIA roles (button, link, menuitem, checkbox, tab, combobox, slider, etc.)
 * - Event handler attributes (onclick, onmousedown, tabindex)
 * - cursor: pointer CSS
 * - Accessibility properties (aria-expanded, aria-pressed, etc.)
 * - Search-related class/id patterns
 * - Icon-sized interactive elements (10-50px with interactive attributes)
 */
const EXTRACTION_SCRIPT = `
(() => {
  const INTERACTIVE_TAGS = new Set([
    'button', 'input', 'select', 'textarea', 'a',
    'details', 'summary', 'option',
  ]);

  const INTERACTIVE_ROLES = new Set([
    'button', 'link', 'menuitem', 'option', 'radio',
    'checkbox', 'tab', 'textbox', 'combobox', 'slider',
    'spinbutton', 'search', 'searchbox', 'listbox',
    'switch', 'treeitem', 'gridcell',
  ]);

  const INTERACTIVE_ATTRIBUTES = new Set([
    'onclick', 'onmousedown', 'onmouseup', 'onkeydown',
    'onkeyup', 'tabindex', 'contenteditable',
  ]);

  const SEARCH_INDICATORS = new Set([
    'search', 'magnify', 'glass', 'lookup', 'find',
    'query', 'search-icon', 'search-btn', 'searchbox',
  ]);

  const SKIP_TAGS = new Set([
    'html', 'body', 'head', 'script', 'style', 'noscript',
    'meta', 'link', 'br', 'hr',
  ]);

  function isVisible(el) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;

    const style = window.getComputedStyle(el);
    if (style.display === 'none') return false;
    if (style.visibility === 'hidden') return false;
    if (parseFloat(style.opacity) <= 0) return false;

    return true;
  }

  function isInteractive(el) {
    const tag = el.tagName.toLowerCase();
    if (SKIP_TAGS.has(tag)) return false;

    // Direct interactive tags
    if (INTERACTIVE_TAGS.has(tag)) return true;

    // ARIA role
    const role = el.getAttribute('role');
    if (role && INTERACTIVE_ROLES.has(role)) return true;

    // Event handler attributes
    for (const attr of INTERACTIVE_ATTRIBUTES) {
      if (el.hasAttribute(attr)) return true;
    }

    // cursor: pointer
    try {
      const style = window.getComputedStyle(el);
      if (style.cursor === 'pointer') return true;
    } catch (e) {}

    // ARIA interactive state properties (expanded, pressed, checked, selected)
    if (el.hasAttribute('aria-expanded') || el.hasAttribute('aria-pressed')
        || el.hasAttribute('aria-checked') || el.hasAttribute('aria-selected')) {
      return true;
    }

    // Search-related elements
    const classList = (el.getAttribute('class') || '').toLowerCase();
    const elementId = (el.getAttribute('id') || '').toLowerCase();
    for (const indicator of SEARCH_INDICATORS) {
      if (classList.includes(indicator) || elementId.includes(indicator)) {
        return true;
      }
    }

    // Icon-sized interactive elements (10-50px)
    const rect = el.getBoundingClientRect();
    if (rect.width >= 10 && rect.width <= 50
        && rect.height >= 10 && rect.height <= 50) {
      if (el.hasAttribute('aria-label') || el.hasAttribute('data-action')
          || role === 'button' || role === 'link') {
        return true;
      }
    }

    // Label elements wrapping form controls
    if (tag === 'label') {
      const forId = el.getAttribute('for');
      if (!forId && el.querySelector('input, select, textarea')) {
        return true;
      }
    }

    return false;
  }

  function getAccessibleName(el) {
    // Priority: aria-label > aria-labelledby > label[for] > closest label > textContent > placeholder > title
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel.trim().slice(0, 80);

    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const labelEl = document.getElementById(labelledBy);
      if (labelEl) return (labelEl.textContent || '').trim().slice(0, 80);
    }

    // For inputs: find associated label
    if (el.id) {
      const labelEl = document.querySelector('label[for="' + el.id + '"]');
      if (labelEl) return (labelEl.textContent || '').trim().slice(0, 80);
    }

    // Closest ancestor label
    const parentLabel = el.closest('label');
    if (parentLabel && parentLabel !== el) {
      const text = (parentLabel.textContent || '').trim();
      if (text) return text.slice(0, 80);
    }

    // Direct text content (for buttons, links, etc.)
    const tag = el.tagName.toLowerCase();
    if (['button', 'a', 'summary', 'option', 'label'].includes(tag)) {
      const text = (el.textContent || '').trim();
      if (text && text.length <= 80) return text;
      if (text) return text.slice(0, 77) + '...';
    }

    // Placeholder
    if (el.placeholder) return el.placeholder.slice(0, 80);

    // Title
    if (el.title) return el.title.slice(0, 80);

    return '';
  }

  function buildSelector(el) {
    // Try ID first
    if (el.id) return '#' + CSS.escape(el.id);

    // Try unique attributes (name, data-testid, aria-label)
    for (const attr of ['data-testid', 'data-cy', 'data-test', 'name']) {
      const val = el.getAttribute(attr);
      if (val) {
        const selector = el.tagName.toLowerCase() + '[' + attr + '="' + val.replace(/"/g, '\\\\"') + '"]';
        if (document.querySelectorAll(selector).length === 1) return selector;
      }
    }

    // Build path from root
    const parts = [];
    let current = el;
    while (current && current !== document.body && parts.length < 5) {
      let part = current.tagName.toLowerCase();
      if (current.id) {
        part = '#' + CSS.escape(current.id);
        parts.unshift(part);
        break;
      }
      // Add nth-of-type for disambiguation
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(s => s.tagName === current.tagName);
        if (siblings.length > 1) {
          const idx = siblings.indexOf(current) + 1;
          part += ':nth-of-type(' + idx + ')';
        }
      }
      parts.unshift(part);
      current = current.parentElement;
    }
    return parts.join(' > ');
  }

  function getSelectOptions(el) {
    if (el.tagName.toLowerCase() !== 'select') return undefined;
    const opts = Array.from(el.options || []).slice(0, 6).map(o => (o.text || '').trim()).filter(Boolean);
    if (el.options && el.options.length > 6) {
      opts.push('... +' + (el.options.length - 6) + ' more');
    }
    return opts.length > 0 ? opts : undefined;
  }

  // ── Main extraction ──

  const elements = [];
  let index = 1;
  const viewportHeight = window.innerHeight;
  const scrollX = window.scrollX;
  const scrollY = window.scrollY;
  let visibleInViewport = 0;

  // Walk all elements in DOM order (natural reading order)
  const allElements = document.querySelectorAll('*');

  for (const el of allElements) {
    if (!isInteractive(el)) continue;
    if (!isVisible(el)) continue;

    const rect = el.getBoundingClientRect();
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute('role') || undefined;
    const name = getAccessibleName(el);
    const type = el.type || undefined;
    const value = (tag === 'input' || tag === 'textarea' || tag === 'select')
      ? (el.value || '').slice(0, 100)
      : undefined;
    const placeholder = el.placeholder || undefined;
    const href = (tag === 'a' && el.href) ? el.href : undefined;
    const disabled = el.disabled || el.getAttribute('aria-disabled') === 'true' || undefined;
    const required = el.required || undefined;
    const checked = (type === 'checkbox' || type === 'radio') ? el.checked : undefined;

    const inViewport = rect.top < viewportHeight && rect.bottom > 0;
    if (inViewport) visibleInViewport++;

    elements.push({
      index: index++,
      tag,
      role: role || undefined,
      name: name || undefined,
      type: type || undefined,
      value: value || undefined,
      placeholder: placeholder || undefined,
      href: href || undefined,
      disabled: disabled || undefined,
      required: required || undefined,
      checked,
      bounds: {
        x: Math.round(rect.x + scrollX),
        y: Math.round(rect.y + scrollY),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
      selector: buildSelector(el),
      options: getSelectOptions(el),
    });
  }

  return {
    elements,
    pageTitle: document.title,
    pageUrl: window.location.href,
    scrollPosition: { x: scrollX, y: scrollY },
    pageHeight: document.documentElement.scrollHeight,
    viewportHeight,
    timestamp: Date.now(),
    totalElements: elements.length,
    visibleInViewport,
  };
})()
`;

// ── Public API ────────────────────────────────────────────────────────

/**
 * Phase 3: Accessibility tree node (from Playwright's built-in a11y snapshot).
 * Used to enrich element data with semantic roles and names.
 */
interface A11yNode {
  role: string;
  name: string;
  value?: string;
  description?: string;
  focused?: boolean;
  checked?: boolean | "mixed";
  disabled?: boolean;
  children?: A11yNode[];
}

/**
 * Flatten the accessibility tree into a lookup map keyed by name+role.
 * This allows us to cross-reference DOM elements with their a11y properties.
 */
function flattenA11yTree(node: A11yNode, out: A11yNode[] = []): A11yNode[] {
  if (node.role !== "none" && node.role !== "presentation" && node.name) {
    out.push(node);
  }
  for (const child of node.children ?? []) {
    flattenA11yTree(child, out);
  }
  return out;
}

/**
 * Extract all interactive elements from the current page with numeric indices.
 * Combines DOM heuristics (Phase 1) + Accessibility Tree enrichment (Phase 3).
 */
export async function extractInteractiveElements(
  page: Page,
): Promise<DOMSnapshot> {
  try {
    // Phase 1: DOM-based extraction (heuristic scan)
    const snapshot = (await page.evaluate(EXTRACTION_SCRIPT)) as DOMSnapshot;

    // Phase 3: Accessibility tree enrichment
    // Playwright's built-in a11y snapshot provides semantic roles/names that
    // DOM heuristics might miss (custom web components, shadow DOM, etc.)
    try {
      const a11ySnapshot = await (page as unknown as { accessibility: { snapshot: () => Promise<A11yNode | null> } }).accessibility.snapshot();
      if (a11ySnapshot) {
        const a11yNodes = flattenA11yTree(a11ySnapshot);

        // Build a quick lookup: name → a11y node
        const a11yByName = new Map<string, A11yNode>();
        for (const node of a11yNodes) {
          if (node.name && !a11yByName.has(node.name)) {
            a11yByName.set(node.name, node);
          }
        }

        // Enrich DOM elements with a11y data where names match
        for (const el of snapshot.elements) {
          if (!el.name) continue;

          const a11yMatch = a11yByName.get(el.name);
          if (a11yMatch) {
            // Use a11y role if DOM didn't have one
            if (!el.role && a11yMatch.role && a11yMatch.role !== "generic") {
              el.role = a11yMatch.role;
            }
            // Use a11y value if DOM didn't capture it
            if (!el.value && a11yMatch.value) {
              el.value = a11yMatch.value.slice(0, 100);
            }
            // Enrich disabled/checked from a11y
            if (a11yMatch.disabled) {
              el.disabled = true;
            }
            if (a11yMatch.checked !== undefined) {
              el.checked = a11yMatch.checked === true;
            }
            // Mark focused elements
            if (a11yMatch.focused) {
              (el as IndexedElement & { focused?: boolean }).focused = true;
            }
          }
        }

        // Add a11y-only elements not found by DOM scan (custom components, shadow DOM)
        const domNames = new Set(snapshot.elements.filter(e => e.name).map(e => e.name));
        const interactiveA11yRoles = new Set([
          "button", "link", "textbox", "checkbox", "radio",
          "combobox", "slider", "spinbutton", "switch",
          "menuitem", "tab", "searchbox",
        ]);

        let nextIndex = snapshot.elements.length + 1;
        for (const a11yNode of a11yNodes) {
          if (!interactiveA11yRoles.has(a11yNode.role)) continue;
          if (domNames.has(a11yNode.name)) continue;
          if (!a11yNode.name) continue;

          // This element was found by a11y but not by DOM scan — add it
          const a11yElement: IndexedElement = {
            index: nextIndex++,
            tag: a11yNode.role, // Use role as tag since we don't have the actual tag
            role: a11yNode.role,
            name: a11yNode.name,
            bounds: { x: 0, y: 0, width: 0, height: 0 }, // Unknown bounds for a11y-only elements
            selector: `[aria-label="${a11yNode.name.replace(/"/g, '\\"')}"]`,
            isNew: true,
          };
          if (a11yNode.value) a11yElement.value = a11yNode.value.slice(0, 100);
          if (a11yNode.disabled) a11yElement.disabled = true;
          if (a11yNode.checked === true) a11yElement.checked = true;
          if (a11yNode.checked === false) a11yElement.checked = false;
          snapshot.elements.push(a11yElement);
        }

        // Update counts
        snapshot.totalElements = snapshot.elements.length;
      }
    } catch {
      // a11y snapshot can fail on some pages — DOM extraction is still valid
    }

    return snapshot;
  } catch (error) {
    // Fallback for pages that block evaluate (rare)
    return {
      elements: [],
      pageTitle: await page.title().catch(() => ""),
      pageUrl: page.url(),
      scrollPosition: { x: 0, y: 0 },
      pageHeight: 0,
      viewportHeight: 0,
      timestamp: Date.now(),
      totalElements: 0,
      visibleInViewport: 0,
    };
  }
}

/**
 * Format a DOM snapshot as a compact text representation for the LLM.
 * Keeps the output concise to avoid burning tokens while being informative.
 *
 * Example output:
 *   Page: "Login — MyApp" | URL: https://app.example.com/login
 *   Viewport: 1366x768 | Scroll: 0,0 | Elements: 12 (8 visible)
 *
 *   [1] input[email] name="email" placeholder="you@example.com" [REQUIRED]
 *   [2] input[password] name="password" placeholder="Password" [REQUIRED]
 *   [3] button "Log In"
 *   [4] link "Forgot Password?" → /forgot
 *   [5] link "Sign Up" → /register
 */
export function formatSnapshotForLLM(
  snapshot: DOMSnapshot,
  maxLength = 6000,
): string {
  const lines: string[] = [];

  // Header
  lines.push(`Page: "${snapshot.pageTitle}" | URL: ${snapshot.pageUrl}`);
  lines.push(
    `Viewport: ${snapshot.viewportHeight}px | Scroll: ${snapshot.scrollPosition.x},${snapshot.scrollPosition.y} | Elements: ${snapshot.totalElements} (${snapshot.visibleInViewport} visible)`,
  );
  lines.push("");

  // Elements
  for (const el of snapshot.elements) {
    let line = `[${el.index}]`;

    // Tag + type
    if (el.type && el.type !== el.tag) {
      line += ` ${el.tag}[${el.type}]`;
    } else {
      line += ` ${el.tag}`;
    }

    // Role (only if different from tag)
    if (el.role && el.role !== el.tag) {
      line += ` role="${el.role}"`;
    }

    // Name (accessible name)
    if (el.name) {
      line += ` "${el.name}"`;
    }

    // Value
    if (el.value) {
      line += ` value="${el.value}"`;
    }

    // Placeholder
    if (el.placeholder && !el.value) {
      line += ` placeholder="${el.placeholder}"`;
    }

    // href (truncated)
    if (el.href) {
      const shortHref = el.href.length > 60
        ? el.href.slice(0, 57) + "..."
        : el.href;
      line += ` → ${shortHref}`;
    }

    // Select options
    if (el.options && el.options.length > 0) {
      line += ` options=[${el.options.join(", ")}]`;
    }

    // Flags
    const flags: string[] = [];
    if (el.required) flags.push("REQUIRED");
    if (el.disabled) flags.push("DISABLED");
    if (el.checked === true) flags.push("CHECKED");
    if (el.checked === false) flags.push("UNCHECKED");
    if (el.isNew) flags.push("NEW");
    if (flags.length > 0) line += ` [${flags.join(", ")}]`;

    lines.push(line);

    // Check length limit
    const currentLength = lines.join("\n").length;
    if (currentLength > maxLength - 100) {
      const remaining = snapshot.elements.length - el.index;
      if (remaining > 0) {
        lines.push(`... and ${remaining} more elements (scroll down or use selector to narrow)`);
      }
      break;
    }
  }

  return lines.join("\n");
}

/**
 * Resolve an element index to an actual Playwright Locator and click it.
 */
export async function clickElementByIndex(
  page: Page,
  snapshot: DOMSnapshot,
  index: number,
): Promise<{ success: boolean; message: string }> {
  const element = snapshot.elements.find((el) => el.index === index);
  if (!element) {
    return {
      success: false,
      message: `Element index ${index} not found. Total elements: ${snapshot.totalElements}. Call get_elements to refresh.`,
    };
  }

  try {
    const locator = page.locator(element.selector).first();
    await locator.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
    await locator.click({ timeout: 5000 });
    return {
      success: true,
      message: `Clicked [${index}] ${element.tag}${element.name ? ' "' + element.name + '"' : ""}`,
    };
  } catch (error) {
    // Fallback: click by coordinates (center of bounding box)
    try {
      const scroll = snapshot.scrollPosition;
      const cx = element.bounds.x - scroll.x + element.bounds.width / 2;
      const cy = element.bounds.y - scroll.y + element.bounds.height / 2;
      await page.mouse.click(cx, cy);
      return {
        success: true,
        message: `Clicked [${index}] ${element.tag} via coordinates (${Math.round(cx)}, ${Math.round(cy)}) — selector fallback`,
      };
    } catch (fallbackError) {
      return {
        success: false,
        message: `Failed to click [${index}] ${element.tag}: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}

/**
 * Resolve an element index and type text into it.
 */
export async function typeIntoElementByIndex(
  page: Page,
  snapshot: DOMSnapshot,
  index: number,
  text: string,
  clear = false,
): Promise<{ success: boolean; message: string }> {
  const element = snapshot.elements.find((el) => el.index === index);
  if (!element) {
    return {
      success: false,
      message: `Element index ${index} not found. Call get_elements to refresh.`,
    };
  }

  try {
    const locator = page.locator(element.selector).first();
    await locator.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});

    if (clear) {
      await locator.fill("", { timeout: 3000 }).catch(async () => {
        // Fallback: triple-click to select all, then type over
        await locator.click({ clickCount: 3, timeout: 3000 });
        await page.keyboard.press("Backspace");
      });
    }

    await locator.fill(text, { timeout: 5000 }).catch(async () => {
      // Fallback: click and type character by character
      await locator.click({ timeout: 3000 });
      await page.keyboard.type(text);
    });

    return {
      success: true,
      message: `Typed into [${index}] ${element.tag}${element.name ? ' "' + element.name + '"' : ""}: "${text.length > 40 ? text.slice(0, 37) + "..." : text}"`,
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to type into [${index}] ${element.tag}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Select an option from a dropdown element by index.
 */
export async function selectOptionByIndex(
  page: Page,
  snapshot: DOMSnapshot,
  index: number,
  value: string,
): Promise<{ success: boolean; message: string }> {
  const element = snapshot.elements.find((el) => el.index === index);
  if (!element) {
    return {
      success: false,
      message: `Element index ${index} not found. Call get_elements to refresh.`,
    };
  }

  try {
    const locator = page.locator(element.selector).first();

    // Try by label first, then by value
    await locator
      .selectOption({ label: value }, { timeout: 5000 })
      .catch(async () => {
        await locator.selectOption({ value }, { timeout: 5000 });
      })
      .catch(async () => {
        // Last resort: click the select and try to find the option
        await locator.click({ timeout: 3000 });
        const option = page.locator(`option:has-text("${value}")`).first();
        await option.click({ timeout: 3000 });
      });

    return {
      success: true,
      message: `Selected "${value}" in [${index}] ${element.tag}${element.name ? ' "' + element.name + '"' : ""}`,
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to select in [${index}] ${element.tag}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
