// background.js — Nodecast Extension Service Worker (Fāze 1 + Layout)
// Sends Capture Package to Nodecast Core API
// Supports Capture Layout — domain-specific capture types

const DEFAULT_API_URL = 'http://localhost:5000/api/capture';
const CORE_REQUEST_TIMEOUT_MS = 15_000;

function coreOriginFromApiUrl(apiUrl) {
  return (apiUrl || DEFAULT_API_URL)
    .replace(/\/api\/capture.*$/, '')
    .replace(/\/api$/, '');
}

async function fetchWithTimeout(url, options = {}, timeout = CORE_REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function clearCoreConnection() {
  await chrome.storage.sync.remove(['apiToken', 'pairedUsername', 'pairedUserId']);
}

async function validateCoreConnection(settings) {
  if (!settings.apiToken) return { connected: false, username: '' };
  const origin = coreOriginFromApiUrl(settings.apiUrl);
  try {
    const response = await fetchWithTimeout(`${origin}/api/extension/settings`, {
      headers: { Authorization: `Bearer ${settings.apiToken}` }
    }, 6_000);
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) await clearCoreConnection();
      const data = await response.json().catch(() => ({}));
      return { connected: false, username: '', message: data.detail || `Connection check failed (${response.status})` };
    }
    const data = await response.json();
    return { connected: true, username: data.username || settings.pairedUsername || '', settings: data.settings || {} };
  } catch (error) {
    const message = error.name === 'AbortError' ? 'Nodecast connection timed out' : `Could not reach Nodecast: ${error.message}`;
    return { connected: false, username: settings.pairedUsername || '', message };
  }
}

// --- Initialization ---
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    // Selection context — always
    chrome.contextMenus.create({
      id: 'save-selection',
      title: 'Save selection to Nodecast',
      contexts: ['selection']
    });
    // Page context — basic
    chrome.contextMenus.create({
      id: 'save-page',
      title: 'Save page to Nodecast',
      contexts: ['page']
    });
    // Link context
    chrome.contextMenus.create({
      id: 'save-link',
      title: 'Save link to Nodecast',
      contexts: ['link']
    });
  });
  // Set defaults if first install
  chrome.storage.sync.get(['apiUrl', 'shortcutKey'], (r) => {
    if (!r.apiUrl) {
      chrome.storage.sync.set({
        apiUrl: DEFAULT_API_URL,
        floatingButtonEnabled: true,
        minSelectionLength: 10,
        shortcutKey: 'Alt+Shift+S'
      });
    } else if (!r.shortcutKey || r.shortcutKey === 'Alt+Shift+R') {
      // Older releases used R for both save-selection and open-nodecast.
      chrome.storage.sync.set({ shortcutKey: 'Alt+Shift+S' });
    }
  });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'save-selection', title: 'Save selection to Nodecast', contexts: ['selection'] });
    chrome.contextMenus.create({ id: 'save-page', title: 'Save page to Nodecast', contexts: ['page'] });
    chrome.contextMenus.create({ id: 'save-link', title: 'Save link to Nodecast', contexts: ['link'] });
  });
});

// --- Context Menu ---
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'save-selection' && info.selectionText) {
    chrome.tabs.sendMessage(tab.id, { action: 'buildCapturePackage', captureType: 'snippet' }, (response) => {
      void chrome.runtime.lastError;
      if (response && response.package) {
        sendCapturePackage(response.package, tab.id);
      } else {
        sendBasicCapture(tab, info.selectionText, 'snippet');
      }
    });
  }
  if (info.menuItemId === 'save-page') {
    chrome.tabs.sendMessage(tab.id, { action: 'buildCapturePackage', captureType: 'page' }, (response) => {
      void chrome.runtime.lastError;
      if (response && response.package) {
        sendCapturePackage(response.package, tab.id);
      } else {
        sendBasicCapture(tab, '', 'page');
      }
    });
  }
  if (info.menuItemId === 'save-link' && info.linkUrl) {
    // Link save — create a basic capture from the link info
    sendBasicCapture(tab, info.linkUrl, 'link');
  }
});

// --- Keyboard Commands ---
chrome.commands.onCommand.addListener((command) => {
  if (command === 'save-selection') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]) return;
      chrome.tabs.sendMessage(tabs[0].id, { action: 'buildCapturePackage', captureType: 'snippet' }, (response) => {
        void chrome.runtime.lastError;
        if (response && response.package) {
          sendCapturePackage(response.package, tabs[0].id);
        } else {
          chrome.tabs.sendMessage(tabs[0].id, { action: 'getSelection' }, (r2) => {
            void chrome.runtime.lastError;
            if (r2 && r2.text) sendBasicCapture(tabs[0], r2.text, 'snippet');
          });
        }
      });
    });
  }
  if (command === 'save-page') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]) return;
      chrome.tabs.sendMessage(tabs[0].id, { action: 'buildCapturePackage', captureType: 'page' }, (response) => {
        void chrome.runtime.lastError;
        if (response && response.package) {
          sendCapturePackage(response.package, tabs[0].id);
        }
      });
    });
  }
  if (command === 'open-nodecast') {
    chrome.tabs.create({ url: 'http://localhost:5000' });
  }
});

// --- Message handler ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getExtensionStatus') {
    chrome.storage.sync.get(['apiUrl', 'apiToken', 'pairedUsername'], async (settings) => {
      const connection = await validateCoreConnection(settings);
      sendResponse({
        detected: true,
        connected: connection.connected,
        username: connection.username,
        message: connection.message || '',
        version: chrome.runtime.getManifest().version,
        capabilities: ['pairing', 'settings-sync', 'floating-save', 'shortcut', 'context-menu']
      });
    });
    return true;
  }

  if (request.action === 'pairWithCore') {
    pairWithCore(request.coreOrigin, request.code).then(sendResponse);
    return true;
  }

  if (request.action === 'syncExtensionSettings') {
    syncExtensionSettings().then(sendResponse);
    return true;
  }

  if (request.action === 'disconnectCore') {
    chrome.storage.sync.remove(['apiToken', 'pairedUsername', 'pairedUserId'], () => sendResponse({ success: true }));
    return true;
  }

  // From content.js — save Capture Package
  if (request.action === 'saveCapturePackage' && request.package) {
    const finish = (tabId) => {
      sendCapturePackage(request.package, tabId, { suppressToast: Boolean(request.suppressToast) })
        .then(sendResponse)
        .catch(error => sendResponse({ success: false, message: error.message }));
    };
    if (sender.tab?.id) finish(sender.tab.id);
    else chrome.tabs.query({ active: true, currentWindow: true }, tabs => finish(tabs[0]?.id || null));
    return true;
  }

  if (request.action === 'setCaptureReason') {
    setCaptureReason(request.captureId, request.reason).then(sendResponse);
    return true;
  }
  if (request.action === 'getReasonSuggestions') {
    getReasonSuggestions().then(sendResponse);
    return true;
  }

  // From popup — save current selection
  if (request.action === 'saveCurrentSelection') {
    if (request.text) {
      chrome.tabs.sendMessage(sender.tab?.id || request.tab?.id, {
        action: 'buildCapturePackage',
        captureType: 'snippet'
      }, (response) => {
        void chrome.runtime.lastError;
        if (response && response.package) {
          sendCapturePackage(response.package, sender.tab?.id || request.tab?.id);
        } else {
          sendBasicCapture(request.tab, request.text, 'snippet');
        }
      });
      sendResponse({ success: true });
    } else {
      sendResponse({ success: false, message: 'No selection' });
    }
    return true;
  }

  // From popup — save current page (with layout awareness)
  if (request.action === 'saveCurrentPage') {
    const tab = sender.tab || request.tab;
    const captureType = request.captureType || 'page';
    if (tab && tab.id) {
      chrome.tabs.sendMessage(tab.id, { action: 'buildCapturePackage', captureType: captureType }, (response) => {
        if (chrome.runtime.lastError) {
          sendResponse({ success: false, message: chrome.runtime.lastError.message });
          return;
        }
        if (response && response.package) {
          sendCapturePackage(response.package, tab.id).then(sendResponse);
        } else {
          sendResponse({ success: false, message: 'Could not build capture package' });
        }
      });
      return true;
    }
    sendResponse({ success: false, message: 'No active tab' });
    return false;
  }

  // From popup — get layout info for current tab
  if (request.action === 'getLayout') {
    chrome.tabs.sendMessage(sender.tab?.id || request.tab?.id, { action: 'getLayout' }, (response) => {
      void chrome.runtime.lastError;
      sendResponse(response?.layout || null);
    });
    return true;
  }

  // From content.js — fetch layout (routed through background to avoid mixed content blocking)
  if (request.action === 'fetchLayout' && request.url) {
    chrome.storage.sync.get(['apiUrl'], (s) => {
      const baseUrl = (s.apiUrl || DEFAULT_API_URL)
        .replace(/\/api\/capture.*$/, '').replace(/\/api$/, '') || 'http://localhost:5000';
      const checkUrl = `${baseUrl}/api/layouts/check?url=${encodeURIComponent(request.url)}`;
      fetch(checkUrl)
        .then(res => res.json())
        .then(data => sendResponse({ layout: data }))
        .catch(() => sendResponse({ layout: { matched: false, capture_types: [{ type: 'page', label: 'Save Page', priority: 0 }] } }));
    });
    return true;
  }

  // From popup — open Nodecast
  if (request.action === 'openNodecast') {
    chrome.storage.sync.get(['apiUrl'], (s) => {
      const baseUrl = s.apiUrl || DEFAULT_API_URL;
      const origin = baseUrl.replace(/\/api\/capture.*$/, '').replace(/\/api$/, '') || 'http://localhost:5000';
      chrome.tabs.create({ url: origin });
    });
    sendResponse({ success: true });
    return true;
  }
});

function isAllowedCoreOrigin(origin) {
  try {
    const url = new URL(origin);
    const host = url.hostname;
    const privateIpv4 = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
    return ['http:', 'https:'].includes(url.protocol)
      && (['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(host) || privateIpv4);
  } catch {
    return false;
  }
}

async function pairWithCore(coreOrigin, code) {
  if (!isAllowedCoreOrigin(coreOrigin)) return { success: false, message: 'Unsupported Nodecast Core address' };
  try {
    const response = await fetch(`${coreOrigin}/api/extension/exchange`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code })
    });
    const data = await response.json();
    if (!response.ok || !data.token) return { success: false, message: data.detail || 'Pairing failed' };
    await chrome.storage.sync.set({
      apiUrl: `${coreOrigin}/api/capture`,
      apiToken: data.token,
      pairedUsername: data.username,
      pairedUserId: data.user_id
    });
    const synced = await syncExtensionSettings();
    if (!synced.success) return synced;
    return { success: true, username: data.username };
  } catch (error) {
    return { success: false, message: `Could not reach Nodecast: ${error.message}` };
  }
}

async function syncExtensionSettings() {
  const stored = await chrome.storage.sync.get(['apiUrl', 'apiToken', 'pairedUsername']);
  const connection = await validateCoreConnection(stored);
  if (!connection.connected) return { success: false, message: connection.message || 'Extension is not connected' };
  try {
    const settings = connection.settings || {};
    await chrome.storage.sync.set({
      floatingButtonEnabled: settings.floating_button_enabled !== false,
      minSelectionLength: settings.min_selection_length || 10,
      glowPosition: settings.notification_position || 'top-center',
      defaultProject: settings.default_project || '',
      pairedUsername: connection.username || ''
    });
    return { success: true, settings };
  } catch (error) {
    return { success: false, message: `Settings sync failed: ${error.message}` };
  }
}

// --- Send Capture Package to API ---
async function sendCapturePackage(pkg, tabId, { suppressToast = false } = {}) {
  const settings = await chrome.storage.sync.get(['apiUrl', 'apiToken', 'defaultProject']);
  const apiUrl = (settings.apiUrl || DEFAULT_API_URL).replace(/\/+$/, '');
  const headers = { 'Content-Type': 'application/json' };
  if (settings.apiToken) headers.Authorization = `Bearer ${settings.apiToken}`;
  if (!pkg.project && settings.defaultProject) pkg.project = settings.defaultProject;

  try {
    const response = await fetchWithTimeout(apiUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(pkg)
    });
    const raw = await response.text();
    let data = {};
    try { data = raw ? JSON.parse(raw) : {}; } catch { data = { detail: raw }; }

    if (!response.ok || !data.success) {
      const detail = typeof data.detail === 'string'
        ? data.detail
        : JSON.stringify(data.detail || data || {});
      if (response.status === 401 || response.status === 403) await clearCoreConnection();
      const message = response.status === 401 || response.status === 403
        ? 'Extension connection expired or account changed — reconnect in Nodecast Settings'
        : `Save failed (${response.status}): ${detail || response.statusText}`;
      console.error('Nodecast API error:', { status: response.status, detail, data });
      if (!suppressToast) showToast(tabId, message, true);
      return { success: false, status: response.status, message, data };
    }

    const result = await chrome.storage.local.get({ highlights: [] });
    const entry = {
      id: data.id,
      type: pkg.capture_type || 'page',
      title: pkg.source?.title || '',
      url: pkg.source?.url || '',
      date: new Date().toISOString().split('T')[0],
      text: pkg.anchor?.selected_text?.substring(0, 100) || ''
    };
    await chrome.storage.local.set({ highlights: [entry, ...result.highlights].slice(0, 100) });
    if (!suppressToast) showToast(tabId, data.message || 'Saved to Nodecast', false);
    console.info('Nodecast capture saved:', { id: data.id, type: entry.type, url: entry.url });
    return data;
  } catch (error) {
    const message = error.name === 'AbortError'
      ? 'Nodecast did not respond within 15 seconds'
      : `Nodecast unavailable: ${error.message}`;
    console.error('Nodecast API unavailable:', error);
    if (!suppressToast) showToast(tabId, message, true);
    return { success: false, message };
  }
}

// --- Fallback: basic text-only capture ---
function sendBasicCapture(tab, text, captureType) {
  const now = new Date().toISOString();
  let siteName = '';
  try { siteName = new URL(tab.url).hostname.replace('www.', ''); } catch (e) {}

  const pkg = {
    version: '1.0',
    capture_type: captureType || 'snippet',
    source: {
      url: tab.url || '',
      title: tab.title || '',
      site_name: siteName
    },
    anchor: text ? { selected_text: text } : null,
    tags: [],
    project: ''
  };
  sendCapturePackage(pkg, tab.id);
}

async function setCaptureReason(captureId, reason) {
  if (!/^[A-Za-z0-9_-]{12,64}$/.test(captureId || '') || typeof reason !== 'string' || !reason.trim() || reason.length > 500) {
    return { success: false, message: 'Enter a reason of up to 500 characters.' };
  }
  const settings = await chrome.storage.sync.get(['apiUrl', 'apiToken']);
  const apiUrl = (settings.apiUrl || DEFAULT_API_URL).replace(/\/+$/, '');
  try {
    const response = await fetchWithTimeout(`${apiUrl}/${encodeURIComponent(captureId)}/reason`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', ...(settings.apiToken ? { Authorization: `Bearer ${settings.apiToken}` } : {}) },
      body: JSON.stringify({ reason: reason.trim(), status: 'confirmed' }),
    });
    if (!response.ok) return { success: false, message: 'Could not save the reason. Check your Nodecast connection.' };
    return { success: true };
  } catch {
    return { success: false, message: 'Could not save the reason. The capture is still saved.' };
  }
}

async function getReasonSuggestions() {
  const settings = await chrome.storage.sync.get(['apiUrl', 'apiToken']);
  const origin = (settings.apiUrl || DEFAULT_API_URL).replace(/\/api\/capture\/?$/, '');
  try {
    const response = await fetchWithTimeout(`${origin}/api/capture-reason/suggestions`, { headers: settings.apiToken ? { Authorization: `Bearer ${settings.apiToken}` } : {} });
    if (!response.ok) return { suggestions: [] };
    return await response.json();
  } catch { return { suggestions: [] }; }
}

function showToast(tabId, msg, isError, captureId = '') {
  if (tabId) {
    chrome.tabs.sendMessage(tabId, { action: 'showToast', message: msg, isError, captureId }).catch(() => {});
  }
}
