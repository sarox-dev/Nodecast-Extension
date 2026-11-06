document.getElementById('open-settings').addEventListener('click', () => {
  chrome.storage.sync.get(['apiUrl'], settings => {
    const origin = (settings.apiUrl || 'http://localhost:5000/api/capture').replace(/\/api\/capture.*$/, '').replace(/\/api$/, '');
    chrome.tabs.create({url:`${origin}/?settings=extension`});
  });
});
