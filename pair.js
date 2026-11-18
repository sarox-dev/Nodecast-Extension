const requestId = location.hash.slice(1);
const approve = document.querySelector('#approve');
const status = document.querySelector('#status');
chrome.runtime.sendMessage({action: 'reviewPairing', id: requestId}, result => {
  if (!result?.success) { status.textContent = result?.message || 'Request expired'; return; }
  document.querySelector('#origin').textContent = result.origin;
  approve.disabled = false;
});
approve.addEventListener('click', async event => {
  if (!event.isTrusted) return;
  approve.disabled = true;
  const result = await chrome.runtime.sendMessage({action: 'approvePairing', id: requestId});
  status.textContent = result?.success ? 'Connected. Return to Nodecast.' : (result?.message || 'Connection failed');
});
