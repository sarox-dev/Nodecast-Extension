// options.js — Nodecast Extension Settings

const apiUrlInput = document.getElementById('apiUrl');
const apiTokenInput = document.getElementById('apiToken');
const themeToggle = document.getElementById('themeToggle');
const glowPosition = document.getElementById('glowPosition');
const saveBtn = document.getElementById('saveBtn');
const saveStatus = document.getElementById('saveStatus');
const testApiBtn = document.getElementById('testApiBtn');
const testResult = document.getElementById('testResult');
const getTokenBtn = document.getElementById('getTokenBtn');
const tokenLoginSection = document.getElementById('token-login-section');
const tokenUsername = document.getElementById('tokenUsername');
const tokenPassword = document.getElementById('tokenPassword');
const generateTokenBtn = document.getElementById('generateTokenBtn');
const tokenGenResult = document.getElementById('tokenGenResult');

const DEFAULT_API_URL = 'http://localhost:5000/api/capture';

// --- Helper: get base URL from capture API URL ---
function getBaseUrl() {
  const u = apiUrlInput.value.trim() || DEFAULT_API_URL;
  return u.replace(/\/api\/capture.*$/, '').replace(/\/api$/, '') || 'http://localhost:5000';
}

// --- Load settings ---
function loadSettings() {
  chrome.storage.sync.get(['apiUrl', 'shortcutKey', 'theme', 'glowPosition', 'apiToken'], (settings) => {
    apiUrlInput.value = settings.apiUrl || DEFAULT_API_URL;
    if (apiTokenInput) apiTokenInput.value = settings.apiToken || '';
    
    glowPosition.value = settings.glowPosition || 'top-center';
    applyTheme(settings.theme);
  });
}

// --- Save settings ---
function saveSettings() {
  const apiUrl = apiUrlInput.value.trim() || DEFAULT_API_URL;
    const apiToken = apiTokenInput ? apiTokenInput.value.trim() : '';

    const theme = themeToggle.checked ? 'dark' : '';
    const glowPos = glowPosition.value;

    chrome.storage.sync.set({
      apiUrl,
      apiToken,
    theme,
    glowPosition: glowPos
  }, () => {
    saveStatus.textContent = 'Settings saved ✓';
    saveStatus.className = 'save-status';
    setTimeout(() => { saveStatus.textContent = ''; }, 2500);
  });
}

// --- Test API connection ---
function testApiConnection() {
  const apiUrl = apiUrlInput.value.trim() || DEFAULT_API_URL;
  const token = apiTokenInput ? apiTokenInput.value.trim() : '';
  testResult.textContent = 'Testing...';
  testResult.className = 'test-result';

  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  // With a token, verify authentication instead of only checking server reachability.
  const testUrl = getBaseUrl() + (token ? '/auth/me' : '/auth/check');
  fetch(testUrl, { headers, credentials: 'include' })
    .then(res => {
      if (res.ok) {
        testResult.textContent = 'Connected ✓';
        testResult.className = 'test-result success';
      } else if (res.status === 401) {
        testResult.textContent = 'Connected but needs login — get a token below';
        testResult.className = 'test-result warning';
      } else {
        testResult.textContent = 'Server error (' + res.status + ')';
        testResult.className = 'test-result error';
      }
    })
    .catch(() => {
      testResult.textContent = 'Connection failed — is Nodecast Core running?';
      testResult.className = 'test-result error';
    });
}

// --- Toggle token login ---
if (getTokenBtn) {
  getTokenBtn.addEventListener('click', () => {
    tokenLoginSection.style.display = tokenLoginSection.style.display === 'none' ? 'block' : 'none';
  });
}

// --- Generate token ---
if (generateTokenBtn) {
  generateTokenBtn.addEventListener('click', () => {
    const username = tokenUsername.value.trim();
    const password = tokenPassword.value.trim();
    if (!username || !password) {
      tokenGenResult.textContent = 'Enter username and password';
      tokenGenResult.className = 'test-result error';
      return;
    }
    tokenGenResult.textContent = 'Generating...';
    tokenGenResult.className = 'test-result';
    const baseUrl = getBaseUrl();
    fetch(baseUrl + '/auth/api-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })
    .then(res => res.json())
    .then(data => {
      if (data.token) {
        apiTokenInput.value = data.token;
        chrome.storage.sync.set({ apiToken: data.token });
        tokenGenResult.textContent = 'Token generated and saved ✓';
        tokenGenResult.className = 'test-result success';
        tokenPassword.value = '';
        tokenLoginSection.style.display = 'none';
      } else {
        tokenGenResult.textContent = data.detail || 'Failed';
        tokenGenResult.className = 'test-result error';
      }
    })
    .catch(() => {
      tokenGenResult.textContent = 'Cannot connect to server';
      tokenGenResult.className = 'test-result error';
    });
  });
}

// --- Theme ---
function applyTheme(theme) {
  const isDark = theme === 'dark';
  if (themeToggle) themeToggle.checked = isDark;
  document.body.setAttribute('data-theme', theme || '');
}

if (themeToggle) {
  themeToggle.addEventListener('change', () => {
    const theme = themeToggle.checked ? 'dark' : '';
    document.body.setAttribute('data-theme', theme);
  });
}

// --- Event listeners ---
saveBtn.addEventListener('click', saveSettings);
testApiBtn.addEventListener('click', testApiConnection);
apiUrlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveSettings(); });

document.addEventListener('DOMContentLoaded', () => {
    loadSettings();
    loadShortcuts();
});

function loadShortcuts() {
    chrome.commands.getAll((commands) => {
        commands.forEach(cmd => {
            const el = document.getElementById('shortcut-' + cmd.name);
            if (el) el.textContent = cmd.shortcut || '(not set)';
        });
    });
}

const openShortcutsBtn = document.getElementById('openShortcutsBtn');
if (openShortcutsBtn) {
    openShortcutsBtn.addEventListener('click', () => {
        chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
    });
}
