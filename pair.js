const requestId = location.hash.slice(1);
const approve = document.querySelector('#approve');
const status = document.querySelector('#status');
let serverOrigin = '';
chrome.runtime.sendMessage({action: 'reviewPairing', id: requestId}, result => {
  if (!result?.success) { status.textContent = result?.message || 'Request expired'; return; }
  document.querySelector('#origin').textContent = result.origin;
  serverOrigin = result.origin;
  approve.disabled = false;
});
approve.addEventListener('click', async event => {
  if (!event.isTrusted) return;
  approve.disabled = true;
  try {
    const url = new URL(serverOrigin);
    const granted = await chrome.permissions.request({origins: [`${url.protocol}//${url.hostname}/*`]});
    const result = await chrome.runtime.sendMessage({action: granted ? 'approvePairing' : 'rejectPairing', id: requestId});
    status.textContent = result?.success ? 'Connected. Return to Nodecast.' : (result?.message || 'Connection failed');
  } catch {
    await chrome.runtime.sendMessage({action: 'rejectPairing', id: requestId});
    status.textContent = 'Server access was not granted. Return to Nodecast and connect again.';
  }
});
