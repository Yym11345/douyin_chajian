// ── Inject script into Main World ─────────────────────────────────────
const script = document.createElement('script');
script.src = chrome.runtime.getURL('injected.js');
script.onload = function() { this.remove(); };
(document.head || document.documentElement).appendChild(script);

// ── Listen to injected.js messages ────────────────────────────────────
let lastDataTime = Date.now();

function extractSSR() {
  try {
    const el = document.getElementById('RENDER_DATA');
    if (!el) return;
    const text = decodeURIComponent(el.innerText || el.textContent);
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      console.warn("[DouyinSkill] Failed to parse RENDER_DATA JSON", e);
      return false;
    }
    

    let profile = null;
    let posts = [];
    
    function scan(obj) {
      if (!obj || typeof obj !== 'object') return;
      if (Array.isArray(obj)) {
        obj.forEach(scan);
        return;
      }
      // Check if it's a profile
      if (obj.sec_uid && obj.nickname && obj.follower_count !== undefined) {
        profile = obj;
      }
      // Check if it's a post
      if (obj.aweme_id && obj.desc !== undefined && obj.author) {
        posts.push(obj);
      }
      Object.values(obj).forEach(scan);
    }
    
    scan(data);
    
    if (profile) {
      chrome.runtime.sendMessage({ type: 'DOUYIN_SKILL_PROFILE', data: { user: profile } });
    }
    if (posts.length > 0) {
      chrome.runtime.sendMessage({ type: 'DOUYIN_SKILL_POST', data: { aweme_list: posts } });
    }
    return true; // return true on success
  } catch (err) {
    console.error("[DouyinSkill] Failed to parse RENDER_DATA", err);
    return false;
  }
}

function extractSSRWithRetry(maxAttempts = 5, intervalMs = 500) {
  let attempts = 0;
  function tryOnce() {
    if (extractSSR()) return;
    if (++attempts < maxAttempts) setTimeout(tryOnce, intervalMs);
  }
  tryOnce();
}

// Fallback: watch for RENDER_DATA if not immediately available
const ssrObserver = new MutationObserver(() => {
  if (document.getElementById('RENDER_DATA')) {
    ssrObserver.disconnect();
    extractSSR();
  }
});
ssrObserver.observe(document.documentElement, { childList: true, subtree: true });

window.addEventListener('message', (event) => {
  if (event.source !== window || event.origin !== 'https://www.douyin.com') return;
  if (event.data && (event.data.type === 'DOUYIN_SKILL_PROFILE' || event.data.type === 'DOUYIN_SKILL_POST')) {
    lastDataTime = Date.now(); // 收到有效数据，刷新最后通信时间
    chrome.runtime.sendMessage(event.data);
  }
  
  if (event.data && event.data.type === 'DOUYIN_SKILL_HAS_MORE') {
    if (event.data.hasMore === false) {
      console.log("[DouyinSkill] has_more is false, stopping auto-scroll.");
      stopScroll("采集完成：已经到底了！");
    }
  }
});

// ── Scroll Engine ──────────────────────────────────────────────────────
let scrollInterval = null;
let isBatchTask = false;

function stopScroll(alertMsg = null) {
  if (scrollInterval) {
    clearInterval(scrollInterval);
    scrollInterval = null;
    if (isBatchTask) {
      chrome.runtime.sendMessage({ type: 'BATCH_TAB_COMPLETE' });
    } else {
      chrome.runtime.sendMessage({ action: 'SCRAPING_STOPPED' });
      if (alertMsg) {
        alert(alertMsg);
      }
    }
  }
}

/**
 * 找到页面中真正可以滚动的容器列表。
 * 抖音是 React 虚拟列表，滚动容器是某个内部 div，而不是 window 或 body。
 */
let scrollableCache = null;
let scrollableCacheTime = 0;
const CACHE_TTL_MS = 5000;

function findScrollableContainers() {
  const now = Date.now();
  if (scrollableCache && now - scrollableCacheTime < CACHE_TTL_MS) {
    return scrollableCache;
  }
  
  const allElems = document.querySelectorAll('*');
  const scrollables = [];

  for (const el of allElems) {
    const { overflow, overflowY } = window.getComputedStyle(el);
    const isScrollable = ['auto', 'scroll'].includes(overflow) || ['auto', 'scroll'].includes(overflowY);
    if (isScrollable && el.scrollHeight > el.clientHeight + 10) {
      scrollables.push(el);
    }
  }

  scrollables.sort((a, b) => b.scrollHeight - a.scrollHeight);
  scrollableCache = scrollables;
  scrollableCacheTime = now;
  return scrollables;
}

const mo = new MutationObserver(() => {
  scrollableCache = null;
});

// document.body may not exist yet at document_start — defer observe
if (document.body) {
  mo.observe(document.body, { childList: true, subtree: false });
} else {
  document.addEventListener('DOMContentLoaded', () => {
    mo.observe(document.body, { childList: true, subtree: false });
  });
}

/**
 * 主滚动函数 - 多种策略同时出击
 */
function triggerScroll() {
  if (Date.now() - lastDataTime > 10000) {
    console.log("[DouyinSkill] Timeout 10s no new data, stopping auto-scroll.");
    stopScroll("采集停止：连续10秒未获取到新数据。");
    return;
  }

  let scrolled = false;

  // ── 策略1: 找真实可滚动容器并滚动 ──
  const containers = findScrollableContainers();
  for (const el of containers.slice(0, 5)) {
    el.scrollTop += 2500;
    scrolled = true;
  }

  // ── 策略2: window.scrollBy ──
  window.scrollBy({ top: 2000, behavior: 'smooth' });

  // ── 策略3: 向屏幕中点每隔 200ms 发射 WheelEvent ──
  const x = window.innerWidth / 2;
  const y = window.innerHeight * 0.6;

  // 发多个 deltaY 以模拟连续滚动
  for (let i = 0; i < 8; i++) {
    setTimeout(() => {
      const el = document.elementFromPoint(x, y) || document.body;
      el.dispatchEvent(new WheelEvent('wheel', {
        deltaY: 300,
        deltaMode: 0,
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        view: window
      }));
    }, i * 80);
  }

  // ── 策略4: 模拟键盘 End/PageDown 键（触发某些容器的监听）──
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', keyCode: 35, bubbles: true }));
  setTimeout(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', keyCode: 34, bubbles: true }));
  }, 200);
}

// ── Message Listener ────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'START_SCROLL') {
    if (scrollInterval) clearInterval(scrollInterval);
    const delay = request.delay || 2000;
    lastDataTime = Date.now(); // reset timer
    
    // 等待页面稳定后立即触发一次
    extractSSRWithRetry();
    setTimeout(triggerScroll, 300);

    // 定时循环
    scrollInterval = setInterval(triggerScroll, delay);
    sendResponse({ status: 'started' });

  } else if (request.action === 'STOP_SCROLL') {
    stopScroll();
    sendResponse({ status: 'stopped' });
  }
  return true;
});

// ── Auto Start Check for Batch Mode ─────────────────────────────────────
chrome.runtime.sendMessage({ type: 'CHECK_AUTO_START' }, res => {
  if (res && res.isAuto) {
    isBatchTask = true;
    console.log("[DouyinSkill] Auto-start detected for batch mode.");
    
    // Notify background that this tab is scraping
    chrome.runtime.sendMessage({ type: 'SET_SCRAPING_STATE', isScraping: true });
    
    // Start scroll after a slight delay to allow page load
    setTimeout(() => {
      extractSSRWithRetry();
      lastDataTime = Date.now();
      scrollInterval = setInterval(triggerScroll, 2000);
    }, 2000);
  }
});
