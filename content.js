// content.js — Nodecast Extension Content Script (Fāze 1 + Layout)
// Collects full page data for Capture Package
// Supports Capture Layout — domain-specific buttons and selectors

const CONTEXT_CHARS = 1500;

// --- Layout cache (fetched from backend on page load) ---
let pageLayout = null;
let layoutFetched = false;

// --- Sentinel for homepage detection ---
const sentinel = document.createElement('meta');
sentinel.name = 'nodecast-extension';
sentinel.content = 'installed';
document.head.appendChild(sentinel);

// --- Fetch layout from backend (routed through background to avoid mixed content) ---
function fetchLayout() {
  if (layoutFetched) return;
  layoutFetched = true;

  chrome.runtime.sendMessage({ action: 'fetchLayout', url: window.location.href }, (response) => {
    if (chrome.runtime.lastError || !response) {
      pageLayout = {
        matched: false,
        capture_types: [{ type: 'page', label: 'Save Page', priority: 0 }]
      };
      return;
    }
    pageLayout = response.layout;
  });
}

// --- Inline Save Buttons ---
// Pēc layout ielādes, ja ir specifiski capture tipi, injectē pogas lapā
function injectSaveButtons(layout) {
  if (!layout || !layout.matched || !layout.capture_types) return;
  if (layout.layout_name === 'default') return; // Skip default — no special buttons

  const container = document.createElement('div');
  container.id = 'nodecast-inline-buttons';
  container.style.cssText = 'position:fixed;top:10px;right:10px;z-index:2147483647;display:flex;flex-direction:column;gap:4px;';

  layout.capture_types.forEach(ct => {
    const btn = document.createElement('button');
    btn.textContent = ct.label || `Save ${ct.type}`;
    btn.dataset.captureType = ct.type;
    btn.dataset.selector = ct.selector || '';
    btn.title = ct.label;
    btn.style.cssText = 'padding:6px 12px;border-radius:6px;border:1px solid #30363d;background:#238636;color:#fff;font-size:12px;font-weight:600;cursor:pointer;font-family:system-ui,sans-serif;white-space:nowrap;';
    btn.addEventListener('mouseenter', () => { btn.style.background = '#2ea043'; });
    btn.addEventListener('mouseleave', () => { btn.style.background = '#238636'; });
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      // If there's a selector, highlight the element
      if (ct.selector) {
        const el = document.querySelector(ct.selector);
        if (el) {
          el.style.outline = '2px solid #238636';
          el.style.outlineOffset = '2px';
          setTimeout(() => { el.style.outline = ''; }, 2000);
        }
      }
      // Build and send capture
      const pkg = buildCapturePackage(ct.type);
      if (pkg) {
        chrome.runtime.sendMessage({ action: 'saveCapturePackage', package: pkg });
      }
    });
    container.appendChild(btn);
  });

  document.body.appendChild(container);

  // Auto-remove after 10s (user can still click other buttons)
  setTimeout(() => {
    const existing = document.getElementById('nodecast-inline-buttons');
    if (existing) existing.style.opacity = '0';
    setTimeout(() => { if (existing) existing.remove(); }, 300);
  }, 10000);
}

// Override fetchLayout to also inject buttons
const _origFetchLayout = fetchLayout;
fetchLayout = function() {
  if (layoutFetched) return;
  layoutFetched = true;

  chrome.runtime.sendMessage({ action: 'fetchLayout', url: window.location.href }, (response) => {
    if (chrome.runtime.lastError || !response) {
      pageLayout = {
        matched: false,
        capture_types: [{ type: 'page', label: 'Save Page', priority: 0 }]
      };
      return;
    }
    pageLayout = response.layout;
    injectSaveButtons(response.layout);  // NEW: inject buttons
  });
};

// Call the updated fetchLayout
fetchLayout();

// --- Listen for background script requests ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getSelection') {
    const selectedText = window.getSelection().toString();
    sendResponse({ text: selectedText });
  }

  if (request.action === 'buildCapturePackage') {
    const captureType = request.captureType || getDefaultCaptureType();
    const pkg = buildCapturePackage(captureType);
    sendResponse({ package: pkg });
  }

  if (request.action === 'getLayout') {
    sendResponse({ layout: pageLayout });
  }

  if (request.action === 'showToast') {
    showGlow(request.message, request.isError);
  }
});

function getDefaultCaptureType() {
  if (!pageLayout || !pageLayout.capture_types || pageLayout.capture_types.length === 0) {
    return 'page';
  }
  // Return highest priority capture type
  const sorted = [...pageLayout.capture_types].sort((a, b) => b.priority - a.priority);
  return sorted[0].type;
}

function getLayoutForType(captureType) {
  if (!pageLayout || !pageLayout.capture_types) return null;
  return pageLayout.capture_types.find(c => c.type === captureType) || null;
}

// --- Build complete Capture Package ---
function buildCapturePackage(captureType) {
  const sel = window.getSelection();
  const hasSelection = sel.toString().trim().length > 0;

  const layoutConfig = getLayoutForType(captureType);

  // If layout has a specific selector, try to capture that element
  let anchor = null;
  if (hasSelection) {
    anchor = buildAnchor(sel);
  } else if (layoutConfig && layoutConfig.selector) {
    // No text selection, but layout defines a selector — capture that element
    const element = document.querySelector(layoutConfig.selector);
    if (element) {
      const range = document.createRange();
      range.selectNode(element);
      const syntheticSel = {
        getRangeAt: () => range,
        toString: () => element.textContent || '',
        rangeCount: 1
      };
      // Use try-catch since createRange might not work everywhere
      try {
        anchor = buildAnchor(syntheticSel);
      } catch (e) {}
    }
  }

  const metadata = (pageLayout && pageLayout.collect_metadata !== false)
    ? extractPageMetadata()
    : null;

  const collectHtml = !pageLayout || pageLayout.collect_html !== false;

  return {
    version: '1.0',
    capture_type: captureType,
    source: {
      url: window.location.href,
      title: document.title,
      site_name: extractSiteName(),
      extension_version: chrome.runtime.getManifest().version,
      browser: navigator.userAgent
    },
    page_metadata: metadata,
    anchor: anchor,
    tags: [],
    project: '',
    page_html: collectHtml ? document.documentElement.outerHTML : null
  };
}

// --- Extract all page metadata ---
function extractPageMetadata() {
  const getMeta = (name) => {
    const el = document.querySelector(`meta[name="${name}"], meta[property="${name}"]`);
    return el ? el.getAttribute('content') || '' : '';
  };

  // Open Graph
  const og = {};
  document.querySelectorAll('meta[property^="og:"]').forEach(el => {
    const key = el.getAttribute('property').replace('og:', '');
    og[key] = el.getAttribute('content') || '';
  });

  // Twitter Card
  const twitter = {};
  document.querySelectorAll('meta[name^="twitter:"]').forEach(el => {
    const key = el.getAttribute('name').replace('twitter:', '');
    twitter[key] = el.getAttribute('content') || '';
  });

  // Schema.org (JSON-LD)
  const schemaOrg = [];
  document.querySelectorAll('script[type="application/ld+json"]').forEach(el => {
    try {
      schemaOrg.push(JSON.parse(el.textContent));
    } catch (e) {}
  });

  // Canonical
  const canonicalLink = document.querySelector('link[rel="canonical"]');
  const canonical = canonicalLink ? canonicalLink.getAttribute('href') : '';

  // Language
  const language = document.documentElement.getAttribute('lang') || '';

  // Charset
  const charsetMeta = document.querySelector('meta[charset]');
  const charset = charsetMeta ? charsetMeta.getAttribute('charset') : '';

  // Favicon
  const faviconLink = document.querySelector('link[rel="icon"], link[rel="shortcut icon"]');
  const favicon = faviconLink ? faviconLink.getAttribute('href') : '';

  return {
    canonical: canonical || null,
    language: language || null,
    charset: charset || null,
    favicon: favicon || null,
    open_graph: Object.keys(og).length > 0 ? og : {},
    twitter_card: Object.keys(twitter).length > 0 ? twitter : {},
    schema_org: schemaOrg.length > 0 ? schemaOrg : []
  };
}

// --- Extract site name from URL ---
function extractSiteName() {
  try {
    const ogSite = document.querySelector('meta[property="og:site_name"]');
    if (ogSite) return ogSite.getAttribute('content') || '';
    return new URL(window.location.href).hostname.replace('www.', '');
  } catch (e) {
    return '';
  }
}

// --- Build anchor object from selection ---
function buildAnchor(sel) {
  const text = sel.toString().trim();
  if (!text) return null;

  const range = sel.getRangeAt(0);
  const container = range.commonAncestorContainer;
  const parentEl = container.nodeType === Node.TEXT_NODE
    ? container.parentElement
    : container;

  const cssSelector = buildCssSelector(parentEl);
  const xpath = buildXPath(parentEl);
  const selectionHtml = getSelectionHtml(sel, range);

  const tagAncestry = [];
  let el = parentEl;
  const semanticTags = ['h1','h2','h3','h4','h5','h6','p','li','blockquote','pre','code','td','th','dt','dd','figcaption','article','section','main'];
  while (el && el !== document.body) {
    const tag = el.tagName ? el.tagName.toLowerCase() : '';
    if (semanticTags.includes(tag)) {
      tagAncestry.push(tag);
    }
    el = el.parentElement;
  }

  const fullText = parentEl.textContent || '';
  const textOffset = fullText.indexOf(text);
  let beforeText = '';
  let afterText = '';

  if (textOffset >= 0) {
    beforeText = fullText.substring(0, textOffset).slice(-CONTEXT_CHARS);
    afterText = fullText.substring(textOffset + text.length).slice(0, CONTEXT_CHARS);
  } else {
    const parentFullText = (parentEl.parentElement?.textContent || '');
    const offset2 = parentFullText.indexOf(text);
    if (offset2 >= 0) {
      beforeText = parentFullText.substring(0, offset2).slice(-CONTEXT_CHARS);
      afterText = parentFullText.substring(offset2 + text.length).slice(0, CONTEXT_CHARS);
    }
  }

  let selectedTag = '';
  try {
    let node = range.startContainer;
    if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
    if (node) selectedTag = node.tagName ? node.tagName.toLowerCase() : '';
  } catch (e) {}

  return {
    selected_text: text,
    css_selector: cssSelector,
    xpath: xpath,
    selection_html: selectionHtml,
    tag_ancestry: tagAncestry,
    selected_tag: selectedTag,
    before_text: beforeText || null,
    after_text: afterText || null
  };
}

// --- Build unique CSS selector for an element ---
function buildCssSelector(el) {
  if (!el || el === document.body) return 'body';
  if (el.id) return `#${el.id}`;

  const path = [];
  let current = el;
  while (current && current !== document.body) {
    let selector = current.tagName.toLowerCase();
    if (current.id) {
      selector = `#${current.id}`;
      path.unshift(selector);
      break;
    }
    if (current.className && typeof current.className === 'string') {
      const classes = current.className.trim().split(/\s+/).filter(c => c.length > 0).slice(0, 2);
      if (classes.length > 0) {
        selector += '.' + classes.join('.');
      }
    }
    const parent = current.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(
        s => s.tagName === current.tagName
      );
      if (siblings.length > 1) {
        const index = siblings.indexOf(current) + 1;
        selector += `:nth-child(${index})`;
      }
    }
    path.unshift(selector);
    current = current.parentElement;
  }
  return path.join(' > ');
}

// --- Build XPath for an element ---
function buildXPath(el) {
  if (!el || el === document.body) return '/html/body';
  if (el.id) return `//*[@id="${el.id}"]`;

  const parts = [];
  let current = el;
  while (current && current !== document.documentElement) {
    let index = 1;
    const sibling = current.previousElementSibling;
    if (sibling) {
      let sib = sibling;
      while (sib) {
        if (sib.tagName === current.tagName) index++;
        sib = sib.previousElementSibling;
      }
    }
    parts.unshift(`${current.tagName.toLowerCase()}[${index}]`);
    current = current.parentElement;
  }
  return '/html/' + parts.join('/');
}

// --- Extract HTML of the selection ---
function getSelectionHtml(sel, range) {
  try {
    const fragment = range.cloneContents();
    const div = document.createElement('div');
    div.appendChild(fragment);
    return div.innerHTML;
  } catch (e) {
    return '';
  }
}

// --- Glowing notification ---
function showGlow(message, isError) {
  const existing = document.getElementById('nodecast-glow');
  if (existing) existing.remove();

  chrome.storage.sync.get(['glowPosition'], (settings) => {
    const position = settings.glowPosition || 'top-center';
    const positions = {
      'top-left': { top: '16px', left: '16px', transform: 'none' },
      'top-center': { top: '16px', left: '50%', transform: 'translateX(-50%)' },
      'top-right': { top: '16px', right: '16px', transform: 'none' },
      'bottom-left': { bottom: '16px', left: '16px', transform: 'none' },
      'bottom-center': { bottom: '16px', left: '50%', transform: 'translateX(-50%)' },
      'bottom-right': { bottom: '16px', right: '16px', transform: 'none' },
    };
    const pos = positions[position] || positions['top-center'];

    const glow = document.createElement('div');
    glow.id = 'nodecast-glow';
    glow.textContent = message;
    Object.assign(glow.style, {
      position: 'fixed',
      zIndex: '2147483647',
      padding: '10px 18px',
      borderRadius: '10px',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      fontSize: '14px',
      fontWeight: '600',
      pointerEvents: 'none',
      opacity: '0',
      transition: 'opacity 0.25s ease, box-shadow 0.25s ease',
      background: isError ? '#dc2626' : '#059669',
      color: '#fff',
      boxShadow: isError
        ? '0 0 20px rgba(220,38,38,0.6), 0 4px 12px rgba(0,0,0,0.2)'
        : '0 0 20px rgba(5,150,105,0.6), 0 4px 12px rgba(0,0,0,0.2)',
    });
    if (pos.top) glow.style.top = pos.top;
    if (pos.bottom) glow.style.bottom = pos.bottom;
    if (pos.left) glow.style.left = pos.left;
    if (pos.right) glow.style.right = pos.right;
    glow.style.transform = pos.transform || 'none';

    document.body.appendChild(glow);
    requestAnimationFrame(() => { glow.style.opacity = '1'; });

    setTimeout(() => {
      glow.style.opacity = '0';
      glow.style.boxShadow = 'none';
      setTimeout(() => glow.remove(), 300);
    }, 2000);
  });
}

// --- Auto-save on selection (if enabled) ---
let autoSaveTimer = null;

document.addEventListener('mouseup', () => {
  try {
    chrome.storage.sync.get(['autoSaveOnSelect'], (settings) => {
      if (!settings.autoSaveOnSelect) return;
      const text = window.getSelection().toString().trim();
      if (text.length < 10) return;

      clearTimeout(autoSaveTimer);
      autoSaveTimer = setTimeout(() => {
        const pkg = buildCapturePackage('snippet');
        if (!pkg || !pkg.anchor) return;
        chrome.runtime.sendMessage({
          action: 'saveCapturePackage',
          package: pkg
        });
      }, 600);
    });
  } catch (e) {}
});

// --- Keyboard shortcut listener ---
// Build the package synchronously while the browser selection is still alive.
// Capture phase also prevents page-level shortcut handlers from swallowing it.
document.addEventListener('keydown', (event) => {
  if (!(event.altKey && event.shiftKey && !event.ctrlKey && !event.metaKey && event.code === 'KeyS')) return;

  event.preventDefault();
  event.stopImmediatePropagation();
  const text = window.getSelection().toString().trim();
  if (!text) {
    showGlow('Select text first', true);
    return;
  }

  const pkg = buildCapturePackage('snippet');
  chrome.runtime.sendMessage({ action: 'saveCapturePackage', package: pkg });
}, true);
