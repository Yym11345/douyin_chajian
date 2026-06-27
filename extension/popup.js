document.addEventListener('DOMContentLoaded', () => {
  const btnStart = document.getElementById('btnStart');
  const btnStop = document.getElementById('btnStop');
  const btnDash = document.getElementById('btnDash');
  const statusEl = document.getElementById('status');
  const countEl = document.getElementById('count');

  let isRunning = false;
  let activeTabId = null;

  // 每次打开弹窗时，将"本次新增"计数器归零
  chrome.runtime.sendMessage({ type: 'RESET_SESSION_COUNT' }, () => void chrome.runtime.lastError);

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (tab && tab.url && tab.url.includes('douyin.com/user/')) {
      activeTabId = tab.id;
    } else {
      btnStart.disabled = true;
      statusEl.style.display = 'block';
    }
  });

  function updateStats() {
    chrome.runtime.sendMessage({ type: 'GET_STATS' }, (stats) => {
      if (stats) {
        if (stats.collectedCount !== undefined) {
          countEl.innerText = stats.collectedCount;
        }
        if (stats.isScraping !== undefined) {
          isRunning = stats.isScraping;
          if (isRunning) {
            btnStart.style.display = 'none';
            btnStop.style.display = 'block';
          } else {
            btnStop.style.display = 'none';
            btnStart.style.display = 'block';
          }
        }
      }
    });
  }

  const statsTimer = setInterval(updateStats, 1000);
  updateStats();

  window.addEventListener('unload', () => clearInterval(statsTimer));

  btnStart.addEventListener('click', () => {
    if (!activeTabId) return;
    chrome.tabs.sendMessage(activeTabId, { action: 'START_SCROLL', delay: 1500 }, (res) => {
      if (chrome.runtime.lastError) {
        console.error(chrome.runtime.lastError);
        statusEl.innerText = "请刷新当前抖音页面 (按 F5)，然后重新点击采集";
        statusEl.style.display = 'block';
        return;
      }
      chrome.runtime.sendMessage({ type: 'SET_SCRAPING_STATE', isScraping: true });
      isRunning = true;
      btnStart.style.display = 'none';
      btnStop.style.display = 'block';
    });
  });

  btnStop.addEventListener('click', () => {
    if (!activeTabId) return;
    chrome.tabs.sendMessage(activeTabId, { action: 'STOP_SCROLL' }, (res) => {
      chrome.runtime.sendMessage({ type: 'SET_SCRAPING_STATE', isScraping: false });
      isRunning = false;
      btnStop.style.display = 'none';
      btnStart.style.display = 'block';
    });
  });

  btnDash.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
  });
});
