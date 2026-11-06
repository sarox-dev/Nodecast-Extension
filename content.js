// content.js — Nodecast Extension Content Script (Fāze 1 + Layout)
// Collects full page data for Capture Package
// Supports Capture Layout — domain-specific buttons and selectors

const CONTEXT_CHARS = 1500;
const extensionVersion = chrome.runtime.getManifest().version;

function extensionAvailable() {
  try { return Boolean(chrome.runtime?.id); } catch { return false; }
}

function sendRuntime(message, callback = () => {}) {
  try {
    if (!extensionAvailable()) { callback(null); return; }
    chrome.runtime.sendMessage(message, response => {
      const error = chrome.runtime.lastError;
      callback(error ? null : response);
    });
  } catch { callback(null); }
}

function readExtensionSettings(keys, callback) {
  try {
    if (!extensionAvailable()) { callback(null); return; }
    chrome.storage.sync.get(keys, settings => {
      const error = chrome.runtime.lastError;
      callback(error ? null : settings);
    });
  } catch { callback(null); }
}

function notifyReloadRequired() {
  const notice = document.createElement('div');
  notice.textContent = 'Nodecast extension was reloaded. Refresh this page to use Save.';
  Object.assign(notice.style, {position:'fixed',right:'16px',bottom:'16px',zIndex:'2147483647',padding:'12px',borderRadius:'8px',background:'#20242c',color:'#fff',font:'14px system-ui,sans-serif'});
  document.body?.appendChild(notice);
  setTimeout(() => notice.remove(), 6000);
}

// --- Layout cache (fetched from backend on page load) ---
let pageLayout = null;
let layoutFetched = false;

// --- Sentinel for homepage detection ---
const sentinel = document.createElement('meta');
sentinel.name = 'nodecast-extension';
sentinel.content = 'installed';
document.head.appendChild(sentinel);

// --- Core page bridge ---
// Only Nodecast's loopback workspace can request pairing. Tokens stay in the service worker.
window.addEventListener('message', (event) => {
  if (event.source !== window || event.origin !== window.location.origin) return;
  const message = event.data;
  if (!message || message.source !== 'nodecast-core') return;
  const isCorePage = Boolean(document.querySelector('meta[name="nodecast-core"]'));
  const host = window.location.hostname;
  const isPrivateIpv4 = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
  const isLocalCore = ['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(host) || isPrivateIpv4;
  if (!isCorePage || !isLocalCore) return;

  const respond = (payload) => window.postMessage({
    source: 'nodecast-extension',
    type: 'NODECAST_EXTENSION_STATUS',
    requestId: message.requestId,
    payload
  }, window.location.origin);

  if (message.type === 'NODECAST_EXTENSION_PING') {
    sendRuntime({ action: 'getExtensionStatus' }, response => {
      respond(response || { detected: false, connected: false, version: extensionVersion });
    });
  } else if (message.type === 'NODECAST_EXTENSION_PAIR') {
    sendRuntime({
      action: 'pairWithCore', code: message.payload?.code, coreOrigin: message.payload?.coreOrigin
    }, response => respond(response || { success: false, message: 'Pairing failed' }));
  } else if (message.type === 'NODECAST_EXTENSION_SYNC_SETTINGS') {
    sendRuntime({ action: 'syncExtensionSettings' }, response => respond(response || { success: false }));
  } else if (message.type === 'NODECAST_EXTENSION_DISCONNECT') {
    sendRuntime({ action: 'disconnectCore' }, response => respond(response || { success: false }));
  }
});

// --- Fetch layout from backend (routed through background to avoid mixed content) ---
function fetchLayout() {
  if (layoutFetched) return;
  layoutFetched = true;

  sendRuntime({ action: 'fetchLayout', url: window.location.href }, (response) => {
    if (!response) {
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
        sendRuntime({ action: 'saveCapturePackage', package: pkg }, response => { if (!response && !extensionAvailable()) notifyReloadRequired(); });
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

  sendRuntime({ action: 'fetchLayout', url: window.location.href }, (response) => {
    if (!response) {
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
      extension_version: extensionVersion,
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
      // JSON-LD may be either an object or an array of objects. Keep the
      // CapturePackage contract flat, even for malformed nested arrays.
      const pending = [JSON.parse(el.textContent)];
      while (pending.length) {
        const value = pending.pop();
        if (Array.isArray(value)) {
          for (let i = value.length - 1; i >= 0; i--) pending.push(value[i]);
        } else if (value !== null && typeof value === 'object') {
          schemaOrg.push(value);
        }
      }
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
function showSavedWithReason(message, captureId) {
  document.getElementById('nodecast-reason-host')?.remove();
  const host = document.createElement('div');
  host.id = 'nodecast-reason-host';
  Object.assign(host.style, { position: 'fixed', right: '16px', bottom: '16px', zIndex: '2147483647' });
  const shadow = host.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `<style>
    .card{box-sizing:border-box;width:min(320px,calc(100vw - 32px));padding:14px;border:1px solid #394150;border-radius:10px;background:#171b22;color:#f5f5f5;box-shadow:0 8px 24px #0006;font:14px/1.4 system-ui,sans-serif}
    .actions{display:flex;gap:8px;align-items:center;margin-top:9px}button{font:inherit;color:inherit;background:#292f3a;border:1px solid #4b5563;border-radius:6px;padding:6px 9px;cursor:pointer}button:focus-visible,input:focus-visible{outline:2px solid #93b4e8;outline-offset:2px}input{box-sizing:border-box;width:100%;padding:8px;background:#10141a;color:#fff;border:1px solid #626b78;border-radius:6px;font:inherit}form[hidden]{display:none}.status{margin-top:6px;font-size:12px}
  </style><div class="card"><div class="message" role="status"></div><div class="actions"><button type="button" class="add">Add reason</button><button type="button" class="close" aria-label="Close">Close</button></div><form hidden><label>Why did you save this?<input maxlength="500" required></label><div class="suggestions"></div><div class="actions"><button type="submit">Save reason</button></div><div class="status" aria-live="polite"></div></form></div>`;
  shadow.querySelector('.message').textContent = message;
  const form = shadow.querySelector('form');
  let timer = setTimeout(() => host.remove(), 7000);
  shadow.querySelector('.close').onclick = () => { clearTimeout(timer); host.remove(); };
  shadow.querySelector('.add').onclick = () => {
    clearTimeout(timer); form.hidden = false; shadow.querySelector('input').focus();
    sendRuntime({action:'getReasonSuggestions'}, response => {
      const list = form.querySelector('.suggestions'); list.replaceChildren();
      for (const reason of response?.suggestions || []) {
        const option = document.createElement('button'); option.type = 'button'; option.textContent = reason;
        option.onclick = () => { form.querySelector('input').value = reason; form.querySelector('input').focus(); };
        list.append(option);
      }
    });
  };
  form.onsubmit = event => {
    event.preventDefault();
    const button = form.querySelector('button');
    const status = form.querySelector('.status');
    button.disabled = true;
    sendRuntime({ action: 'setCaptureReason', captureId, reason: form.querySelector('input').value }, response => {
      button.disabled = false;
      status.textContent = response?.success ? 'Reason saved.' : (response?.message || 'Could not save the reason. The capture is still saved.');
      if (response?.success) { form.hidden = true; shadow.querySelector('.message').textContent = 'Reason saved.'; shadow.querySelector('.add').hidden = true; timer = setTimeout(() => host.remove(), 2500); }
    });
  };
  document.body.appendChild(host);
}

function showGlow(message, isError) {
  const existing = document.getElementById('nodecast-glow');
  if (existing) existing.remove();

  readExtensionSettings(['glowPosition'], (settings) => {
    if (!settings) return;
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

// --- Floating Save button (primary selection flow) ---
let floatingHost = null;
let floatingPackage = null;

function removeFloatingSave() {
  floatingHost?.remove();
  floatingHost = null;
  floatingPackage = null;
}

function selectionIsEditable(selection) {
  const node = selection?.anchorNode;
  const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
  return Boolean(element?.closest('input, textarea, [contenteditable="true"], [contenteditable="plaintext-only"]'));
}

function showFloatingSave(range, pkg) {
  removeFloatingSave();
  const rect = range.getBoundingClientRect();
  if (!rect || (!rect.width && !rect.height)) return;
  floatingPackage = pkg;
  floatingHost = document.createElement('div');
  floatingHost.id = 'nodecast-floating-save-host';
  Object.assign(floatingHost.style, { position: 'fixed', zIndex: '2147483647', left: '0', top: '0' });
  const shadow = floatingHost.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `<style>
    .bar{box-sizing:border-box;display:flex;align-items:center;gap:5px;max-width:calc(100vw - 16px);padding:4px;border:1px solid rgba(255,255,255,.16);border-radius:999px;background:#111827;color:#f8fafc;box-shadow:0 8px 28px rgba(0,0,0,.34);font:13px/1 system-ui,-apple-system,sans-serif}
    .input-wrap{position:relative;overflow:hidden}.example{position:absolute;left:7px;right:2px;top:50%;transform:translateY(-50%);color:#9ca3af;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none;transition:opacity .18s,transform .18s}.example.scroll{opacity:0;transform:translateY(-90%)}.input-wrap:focus-within .example,.example[hidden]{display:none}input{all:initial;box-sizing:border-box;width:min(190px,38vw);min-width:55px;padding:5px 7px;color:#f8fafc;font:13px system-ui,sans-serif}input:focus-visible,button:focus-visible{outline:2px solid #93b4e8;outline-offset:2px}
    button{all:initial;box-sizing:border-box;color:#f8fafc;font:600 13px/1 system-ui,-apple-system,sans-serif;cursor:pointer}.save{display:flex;align-items:center;gap:7px;padding:8px 12px;border-radius:999px;background:#273142}.save:hover{background:#374151}.save:disabled{opacity:.75;cursor:default}.mark{color:#60a5fa;font-size:15px}.info{position:relative;padding:5px;color:#9ca3af}.tip{display:none;position:absolute;bottom:calc(100% + 8px);right:-60px;width:min(210px,calc(100vw - 40px));padding:8px;border:1px solid #394150;border-radius:7px;background:#171b22;color:#f5f5f5;font:12px/1.4 system-ui,sans-serif;white-space:normal;box-shadow:0 4px 12px #0005}:host([data-tip-below]) .tip{bottom:auto;top:calc(100% + 8px)}.info:hover .tip,.info:focus-visible .tip{display:block}.success{background:#047857}.error{background:#b91c1c}
  </style><div class="bar"><span class="input-wrap"><input type="text" maxlength="500" aria-label="Optional reason for saving"><span class="example" aria-hidden="true"></span></span><button type="button" class="info" aria-label="About the optional reason" aria-describedby="reason-tip">ⓘ<span class="tip" id="reason-tip" role="tooltip">Optional: add a short note about why you are saving this. You can leave it empty.</span></button><button type="button" class="save" aria-label="Save selection to Nodecast"><span class="mark">◆</span><span class="label">Save</span></button></div>`;
  const button = shadow.querySelector('.save');
  const reasonInput = shadow.querySelector('input');
  const examples = ['Why save this? (optional)', 'Try this later', 'Compare with another tool', 'Remember this solution'];
  let exampleIndex = 0;
  const example = shadow.querySelector('.example');
  example.textContent = examples[0];
  reasonInput.addEventListener('input', () => { example.hidden = Boolean(reasonInput.value); });
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const exampleTimer = reduceMotion ? null : setInterval(() => {
    if (!floatingHost?.isConnected) { clearInterval(exampleTimer); return; }
    if (!reasonInput.value && shadow.activeElement !== reasonInput) {
      example.classList.add('scroll');
      setTimeout(() => { example.textContent = examples[++exampleIndex % examples.length]; example.classList.remove('scroll'); }, 180);
    }
  }, 2800);
  reasonInput.addEventListener('keydown', event => { event.stopPropagation(); if (event.key === 'Enter') { event.preventDefault(); button.click(); } if (event.key === 'Escape') removeFloatingSave(); });
  button.addEventListener('mousedown', event => event.preventDefault());
  button.addEventListener('click', () => {
    if (!floatingPackage) return;
    button.disabled = true;
    shadow.querySelector('.label').textContent = 'Saving…';
    const savePackage = { ...floatingPackage, save_reason: reasonInput.value.trim() };
    reasonInput.disabled = true;
    sendRuntime({ action: 'saveCapturePackage', package: savePackage, suppressToast: true }, response => {
      if (!response?.success) {
        if (!extensionAvailable()) notifyReloadRequired();
        button.classList.add('error');
        shadow.querySelector('.label').textContent = response?.message || 'Save failed';
        button.disabled = false; reasonInput.disabled = false;
      } else {
        button.classList.add('success');
        shadow.querySelector('.label').textContent = 'Saved';
      }
      if (response?.success) setTimeout(removeFloatingSave, 900);
    });
  });
  document.documentElement.appendChild(floatingHost);
  const buttonRect = floatingHost.getBoundingClientRect();
  const width = Math.max(buttonRect.width, 82);
  const left = Math.min(Math.max(8, rect.left + rect.width / 2 - width / 2), window.innerWidth - width - 8);
  const preferredTop = rect.top - 44;
  const top = preferredTop >= 8 ? preferredTop : Math.min(window.innerHeight - 42, rect.bottom + 8);
  if (top < 90) floatingHost.setAttribute('data-tip-below', '');
  floatingHost.style.left = `${left}px`;
  floatingHost.style.top = `${top}px`;
}

function prepareFloatingSave() {
  if (!extensionAvailable()) return removeFloatingSave();
  if (document.querySelector('meta[name="nodecast-core"]')) return removeFloatingSave();
  const selection = window.getSelection();
  const text = selection?.toString().trim() || '';
  if (!selection?.rangeCount || selectionIsEditable(selection)) return removeFloatingSave();
  const range = selection.getRangeAt(0).cloneRange();
  const pkg = buildCapturePackage('snippet');
  if (!pkg?.anchor) return removeFloatingSave();
  readExtensionSettings(['floatingButtonEnabled', 'minSelectionLength', 'defaultProject'], settings => {
    if (!settings) return removeFloatingSave();
    if (settings.floatingButtonEnabled === false || text.length < (settings.minSelectionLength || 10)) return removeFloatingSave();
    pkg.project = settings.defaultProject || '';
    showFloatingSave(range, pkg);
  });
}

document.addEventListener('mouseup', event => {
  if (floatingHost && event.composedPath().includes(floatingHost)) return;
  setTimeout(prepareFloatingSave, 20);
});
document.addEventListener('keyup', event => {
  if (floatingHost && event.composedPath().includes(floatingHost)) return;
  if (event.key === 'Escape') return removeFloatingSave();
  if (event.shiftKey || event.key.startsWith('Arrow')) setTimeout(prepareFloatingSave, 20);
});
document.addEventListener('mousedown', event => {
  if (floatingHost && !event.composedPath().includes(floatingHost)) removeFloatingSave();
});
window.addEventListener('scroll', removeFloatingSave, true);
window.addEventListener('resize', removeFloatingSave);

// --- Keyboard shortcut listener ---
// Build the package synchronously while the browser selection is still alive.
// Capture phase also prevents page-level shortcut handlers from swallowing it.
document.addEventListener('keydown', (event) => {
  if (!(event.altKey && event.shiftKey && !event.ctrlKey && !event.metaKey && event.code === 'KeyS')) return;
  if (!extensionAvailable()) { notifyReloadRequired(); return; }

  event.preventDefault();
  event.stopImmediatePropagation();
  const text = window.getSelection().toString().trim();
  if (!text) {
    showGlow('Select text first', true);
    return;
  }

  const pkg = buildCapturePackage('snippet');
  readExtensionSettings(['defaultProject'], settings => {
    if (!settings) { notifyReloadRequired(); return; }
    pkg.project = settings.defaultProject || '';
    sendRuntime({ action: 'saveCapturePackage', package: pkg }, response => { if (!response && !extensionAvailable()) notifyReloadRequired(); });
  });
}, true);
