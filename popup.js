// popup.js — Nodecast Extension Popup

const saveSelectionBtn = document.getElementById('saveSelectionBtn');
const savePageBtn = document.getElementById('savePageBtn');
const openNodecastBtn = document.getElementById('openNodecastBtn');
const settingsBtn = document.getElementById('settingsBtn');
const projectSelect = document.getElementById('projectSelect');
const newProjectBtn = document.getElementById('newProjectBtn');
const shortcutSaveSelection = document.getElementById('shortcut-save-selection');
const shortcutSavePage = document.getElementById('shortcut-save-page');
const shortcutOpenNodecast = document.getElementById('shortcut-open-nodecast');

// --- Load projects & settings ---
function loadProjects() {
  chrome.storage.sync.get(['apiUrl', 'defaultProject', 'shortcutKey'], (settings) => {
    const apiUrl = (settings.apiUrl || 'http://localhost:5000/api/capture')
      .replace(/\/api\/capture.*$/, '')
      .replace(/\/api$/, '') || 'http://localhost:5000';
    const baseUrl = apiUrl.replace(/\/+$/, '');

    fetch(baseUrl + '/api/tags')
      .then(r => r.json())
      .then(data => {
        const projects = data.projects || [];
        projectSelect.innerHTML = '<option value="">— None —</option>';
        projects.forEach(p => {
          const opt = document.createElement('option');
          opt.value = p.name;
          opt.textContent = p.name;
          if (p.name === settings.defaultProject) opt.selected = true;
          projectSelect.appendChild(opt);
        });
      })
      .catch(() => {
        projectSelect.innerHTML = '<option value="">— Offline —</option>';
      });
  });
}

// --- Save selected project ---
projectSelect.addEventListener('change', () => {
  chrome.storage.sync.set({ defaultProject: projectSelect.value });
});

// --- Create new project ---
newProjectBtn.addEventListener('click', () => {
  const name = prompt('New project name:');
  if (!name || !name.trim()) return;
  const nameTrimmed = name.trim();
  chrome.storage.sync.get(['apiUrl'], (settings) => {
    const baseUrl = (settings.apiUrl || 'http://localhost:5000/api/capture')
      .replace(/\/api\/capture.*$/, '')
      .replace(/\/api$/, '') || 'http://localhost:5000';
    fetch(baseUrl + '/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: nameTrimmed })
    })
      .then(r => r.json())
      .then(res => {
        if (res.success || res.created !== undefined) {
          chrome.storage.sync.set({ defaultProject: nameTrimmed });
          loadProjects();
        }
      })
      .catch(() => {});
  });
});

// --- Save current selection ---
saveSelectionBtn.addEventListener('click', () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]) return;
    chrome.tabs.sendMessage(tabs[0].id, {
      action: 'buildCapturePackage',
      captureType: 'snippet'
    }, (response) => {
      if (chrome.runtime.lastError || !response?.package?.anchor?.selected_text) {
        showGlow('No text selected', true);
        return;
      }
      chrome.runtime.sendMessage({
        action: 'saveCapturePackage',
        package: response.package
      }, (res) => {
        if (res && res.success) {
          showGlow(res.message || 'Saved to Nodecast');
        } else {
          showGlow(res?.message || 'Save failed', true);
        }
      });
    });
  });
});

// --- Save current page ---
savePageBtn.addEventListener('click', () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]) return;
    chrome.runtime.sendMessage({
      action: 'saveCurrentPage',
      tab: { title: tabs[0].title, url: tabs[0].url, id: tabs[0].id }
    }, (res) => {
      if (res && res.success) {
        showGlow('Page saved');
      } else {
        showGlow(res?.message || 'Save failed', true);
      }
    });
  });
});

// --- Open Nodecast ---
openNodecastBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'openNodecast' });
  window.close();
});

// --- Settings ---
settingsBtn.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

// --- Glow notification (in-page overlay) ---
function showGlow(msg, isError) {
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
    glow.textContent = msg;
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

document.addEventListener('DOMContentLoaded', () => {

// --- Initialization ---
loadProjects();
chrome.commands.getAll((commands) => {
    commands.forEach(cmd => {
        if (cmd.name === 'save-selection' && shortcutSaveSelection) {
            shortcutSaveSelection.textContent = cmd.shortcut || '';
        }
        if (cmd.name === 'save-page' && shortcutSavePage) {
            shortcutSavePage.textContent = cmd.shortcut || '';
        }
        if (cmd.name === 'open-nodecast' && shortcutOpenNodecast) {
            shortcutOpenNodecast.textContent = cmd.shortcut || '';
        }
    });
});
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'sync' && changes.defaultProject) {
    projectSelect.value = changes.defaultProject.newValue || '';
  }
});

});
