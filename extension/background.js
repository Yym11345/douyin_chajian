let dbPromise = null;

// === Constants ===
const PRESERVE_FIELDS = ['followers', 'totalLikes', 'videoCount'];

function mergeAccount(existing, incoming) {
  const merged = { ...incoming };
  for (const f of PRESERVE_FIELDS) {
    // If incoming doesn't have the field or it's 0 (and existing has a valid value), preserve existing
    if ((merged[f] === undefined || merged[f] === 0) && existing[f] !== undefined && existing[f] !== 0) {
      merged[f] = existing[f];
    }
  }
  merged.fetchedAt = Date.now();
  return merged;
}

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('DouyinSkillDB', 2);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('accounts')) {
        db.createObjectStore('accounts', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('videos')) {
        const videoStore = db.createObjectStore('videos', { keyPath: 'id' });
        videoStore.createIndex('account_id', 'account_id', { unique: false });
      } else {
        const vs = event.target.transaction.objectStore('videos');
        if (!vs.indexNames.contains('account_id')) {
          vs.createIndex('account_id', 'account_id', { unique: false });
        }
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onerror = (e) => console.error('[DouyinSkill] DB error:', e.target.error);
      db.onclose = () => { dbPromise = null; };
      resolve(db);
    };
    request.onerror = () => reject(request.error);
  });
}

async function getDB() {
  if (!dbPromise) dbPromise = openDB();
  return dbPromise;
}

async function upsertAccount(data) {
  if (!data || !data.id) {
    console.error('[DouyinSkill] upsertAccount: invalid data.id', data);
    return;
  }
  const db = await getDB();
  if (!db) { console.error('[DouyinSkill] upsertAccount: db is undefined'); return; }
  const tx = db.transaction('accounts', 'readwrite');
  tx.onerror = (e) => console.error('[DouyinSkill] Account TX error:', e.target.error);
  tx.onabort = (e) => console.error('[DouyinSkill] Account TX abort:', e.target.error);
  const store = tx.objectStore('accounts');
  const getReq = store.get(data.id);
  getReq.onerror = (e) => console.error('[DouyinSkill] Account get error:', e.target.error);
  getReq.onsuccess = () => {
    const existing = getReq.result || {};
    store.put(mergeAccount(existing, data));
  };
}

async function upsertVideo(data) {
  if (!data || !data.id) {
    console.error('[DouyinSkill] upsertVideo: invalid data.id', data);
    return;
  }
  const db = await getDB();
  if (!db) { console.error('[DouyinSkill] upsertVideo: db is undefined'); return; }
  return new Promise((resolve, reject) => {
    const tx = db.transaction('videos', 'readwrite');
    tx.onerror = (e) => { console.error('[DouyinSkill] Video TX error:', e.target.error); reject(e.target.error); };
    tx.onabort = (e) => { console.error('[DouyinSkill] Video TX abort:', e.target.error); reject(e.target.error); };
    const store = tx.objectStore('videos');
    // Check if this video is truly new before counting it
    const getReq = store.get(data.id);
    getReq.onsuccess = () => {
      const isNew = !getReq.result;
      store.put(data);
      tx.oncomplete = () => resolve(isNew);
    };
    getReq.onerror = () => { store.put(data); tx.oncomplete = () => resolve(false); };
  });
}

// sessionNewCount: counts only videos newly added since the popup was last opened
let sessionNewCount = 0;
let stats = { collectedCount: 0, isScraping: false };

async function getVideoCount() {
  try {
    const db = await getDB();
    if (!db) return 0;
    return await new Promise((resolve) => {
      try {
        const tx = db.transaction('videos', 'readonly');
        const store = tx.objectStore('videos');
        const countReq = store.count();
        countReq.onsuccess = () => resolve(countReq.result);
        countReq.onerror = () => resolve(0);
      } catch (e) {
        resolve(0);
      }
    });
  } catch (err) {
    return 0;
  }
}

// ─────────────────────────────────────────────
// Message Handler
// ─────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // SECURITY: Reject messages from other extensions
  if (sender.id && sender.id !== chrome.runtime.id) {
    console.warn('[DouyinSkill] Rejected foreign sender:', sender.id);
    return;
  }

  if (message.type === 'DOUYIN_SKILL_PROFILE') {
    const user = message.data.user || (message.data.user_module && message.data.user_module.user);
    if (user) {
      const accountData = {
        id: user.sec_uid,
        name: user.nickname,
        followers: user.mplatform_followers_count || user.follower_count,
        videoCount: user.aweme_count,
        totalLikes: user.total_favorited,
        fetchedAt: Date.now(),
        avatar: user.avatar_larger?.url_list?.[0] || user.avatar_medium?.url_list?.[0],
        signature: user.signature
      };
      upsertAccount(accountData).catch(e => console.error('[DouyinSkill] DB Error:', e));
    }
    sendResponse({ success: true });

  } else if (message.type === 'DOUYIN_SKILL_POST') {
    const list = message.data.aweme_list || [];

    if (list.length > 0) {
      // ── 兼容新旧 API：author 字段可能是嵌套对象，也可能散落在 item 顶层 ──
      const firstItem = list[0];
      const author = firstItem.author || {};
      const authorSecUid = author.sec_uid || firstItem.sec_uid || null;
      const authorName   = author.nickname || firstItem.nickname || '未知账号';
      const authorAvatar = author.avatar_larger?.url_list?.[0]
                        || author.avatar_medium?.url_list?.[0]
                        || firstItem.avatar_larger?.url_list?.[0] || null;
      const authorSig    = author.signature || firstItem.signature || '';

      const isActiveTarget = batchState.activeTasks.some(
        t => t.targetSecUid && t.targetSecUid === authorSecUid
      );
      if ((isActiveTarget || !batchState.isRunning) && authorSecUid) {
        upsertAccount({
          id: authorSecUid,
          name: authorName,
          avatar: authorAvatar,
          signature: authorSig,
          followers: author.follower_count || firstItem.follower_count || 0,
          fetchedAt: Date.now()
        }).catch(e => console.error('[DouyinSkill] DB Error upsertAccount:', e));
      }
    }

    const promises = list.map(item => {
      const itemAuthor = item.author || {};
      const itemSecUid = itemAuthor.sec_uid || item.sec_uid || null;
      const videoId    = item.aweme_id || item.id || item.vid || null;
      if (!videoId) return Promise.resolve();

      const videoData = {
        id: videoId,
        account_id: itemSecUid,
        type: item.aweme_type === 0 ? 'video' : (item.aweme_type === 68 ? 'image_text' : 'other'),
        title: item.desc || item.share_info?.share_title || '',
        url: `https://www.douyin.com/video/${videoId}`,
        publishedAt: item.create_time ? new Date(item.create_time * 1000).toISOString() : null,
        duration: item.video?.duration || 0,
        likes:     item.statistics?.digg_count    || 0,
        comments:  item.statistics?.comment_count || 0,
        shares:    item.statistics?.share_count   || 0,
        favorites: item.statistics?.collect_count || 0,
        fetchedAt: Date.now()
      };
      return upsertVideo(videoData).catch(e => console.error('[DouyinSkill] DB Error upsertVideo:', e));
    });

    Promise.all(promises).then((results) => {
      // Count only truly new videos inserted this session
      const newlyAdded = results.filter(r => r === true).length;
      sessionNewCount += newlyAdded;
      stats.collectedCount = sessionNewCount;
      // Notify popup if open (silently ignore if popup is closed)
      try {
        chrome.runtime.sendMessage({ type: 'STATS_UPDATE', stats }, () => {
          void chrome.runtime.lastError; // suppress "no listener" error
        });
      } catch(e) {}
    });
    sendResponse({ success: true });

  } else if (message.type === 'GET_STATS') {
    stats.collectedCount = sessionNewCount;
    sendResponse(stats);

  } else if (message.type === 'RESET_SESSION_COUNT') {
    // Called when popup opens — reset session counter to 0
    sessionNewCount = 0;
    stats.collectedCount = 0;
    sendResponse({ success: true });

  } else if (message.type === 'RESET_BATCH_UI') {
    if (!batchState.isRunning) {
      batchState.total = 0;
      batchState.done = 0;
      batchState.queue = [];
      batchState.activeTasks = [];
      saveBatchState();
    }
    sendResponse({ success: true });

  } else if (message.type === 'RESET_STATS') {
    stats.collectedCount = 0;
    if (!batchState.isRunning) {
      batchState.total = 0;
      batchState.done = 0;
      batchState.queue = [];
      batchState.activeTasks = [];
      saveBatchState();
    }
    sendResponse(stats);

  } else if (message.type === 'SET_SCRAPING_STATE') {
    stats.isScraping = message.isScraping;
    sendResponse(stats);

  } else if (message.action === 'SCRAPING_STOPPED') {
    // SECURITY: Validate sender tab URL
    if (sender.tab && sender.tab.url && !sender.tab.url.includes('douyin.com')) {
      console.warn('[DouyinSkill] SCRAPING_STOPPED from non-douyin tab rejected:', sender.tab.url);
      sendResponse({ success: false });
      return;
    }
    stats.isScraping = false;
    chrome.runtime.sendMessage({ type: 'STATS_UPDATE', stats });
    sendResponse(stats);

  } else if (message.type === 'START_BATCH') {
    if (batchState.isRunning) return sendResponse({ success: false, msg: 'Batch already running' });
    batchState.queue = [...message.urls];
    batchState.total = message.urls.length;
    batchState.done = 0;
    batchState.activeTasks = [];
    batchState.isRunning = true;
    saveBatchState().then(() => processBatchQueue());
    sendResponse({ success: true });

  } else if (message.type === 'STOP_BATCH') {
    batchState.isRunning = false;
    batchState.queue = [];
    batchState.activeTasks.forEach(t => {
      if (t.tabId !== -1) chrome.tabs.remove(t.tabId).catch(() => {});
    });
    batchState.activeTasks = [];
    saveBatchState();
    sendResponse({ success: true });

  } else if (message.type === 'GET_BATCH_STATUS') {
    sendResponse({
      total: batchState.total,
      active: batchState.activeTasks.length,
      done: batchState.done,
      activeTasks: batchState.activeTasks,
      currentName: batchState.activeTasks.length > 0
        ? extractNameFromUrl(batchState.activeTasks[0].url)
        : null,
      isFinished: batchState.total > 0
        && batchState.queue.length === 0
        && batchState.activeTasks.length === 0
        && !batchState.isRunning
    });

  } else if (message.type === 'CHECK_AUTO_START') {
    if (sender.url && !sender.url.includes('douyin.com/user/')) {
      sendResponse({ isAuto: false });
      return true;
    }
    const isAuto = batchState.activeTasks.some(t => t.tabId === sender.tab.id);
    sendResponse({ isAuto });

  } else if (message.type === 'BATCH_TAB_COMPLETE') {
    // SECURITY: Validate sender tab URL
    if (sender.tab && sender.tab.url && !sender.tab.url.includes('douyin.com')) {
      console.warn('[DouyinSkill] BATCH_TAB_COMPLETE from non-douyin tab rejected:', sender.tab.url);
      sendResponse({ success: false });
      return;
    }
    if (sender.tab && sender.tab.id) {
      const tabId = sender.tab.id;
      chrome.tabs.remove(tabId).catch(() => {});
      removeTaskByTabId(tabId);
    }
    sendResponse({ success: true });
  }

  return true;
});

// ─────────────────────────────────────────────
// Batch Orchestration Engine
// ─────────────────────────────────────────────
let batchState = {
  queue: [],
  activeTasks: [],
  total: 0,
  done: 0,
  isRunning: false,
  maxConcurrency: 1
};

function generateUUID() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2);
}

function extractNameFromUrl(url) {
  if (!url) return 'Unknown';
  // Try to extract sec_uid for display
  const match = url.match(/douyin\.com\/user\/([^/?#]+)/);
  return match ? match[1].substring(0, 12) + '...' : 'Unknown';
}

async function saveBatchState() {
  await chrome.storage.local.set({ douyin_batch_state: batchState });
}

async function loadBatchState() {
  const data = await chrome.storage.local.get('douyin_batch_state');
  if (data && data.douyin_batch_state) {
    batchState = data.douyin_batch_state;
  }
}

function processBatchQueue() {
  if (!batchState.isRunning) return;

  while (batchState.activeTasks.length < batchState.maxConcurrency && batchState.queue.length > 0) {
    const url = batchState.queue.shift();
    const secUidMatch = url.match(/douyin\.com\/user\/([^/?#]+)/);
    const taskId = generateUUID();
    const taskObj = {
      taskId,
      tabId: -1,
      url,
      targetSecUid: secUidMatch ? secUidMatch[1] : null,
      status: 'Starting...',
      startedAt: Date.now()
    };
    batchState.activeTasks.push(taskObj);
    saveBatchState();

    chrome.tabs.create({ url, active: false }, (tab) => {
      if (chrome.runtime.lastError || !tab) {
        console.error('[DouyinSkill] Failed to create tab for:', url, chrome.runtime.lastError);
        removeTaskByTaskId(taskId);
        return;
      }
      taskObj.tabId = tab.id;
      taskObj.status = 'Scraping...';
      saveBatchState();
    });
  }

  if (batchState.queue.length === 0 && batchState.activeTasks.length === 0) {
    batchState.isRunning = false;
    saveBatchState();
  }
}

function removeTaskByTaskId(taskId) {
  const taskIdx = batchState.activeTasks.findIndex(t => t.taskId === taskId);
  if (taskIdx >= 0) {
    batchState.activeTasks.splice(taskIdx, 1);
    batchState.done++;
    saveBatchState().then(() => {
      if (batchState.isRunning) processBatchQueue();
    });
    return true;
  }
  return false;
}

function removeTaskByTabId(tabId) {
  const taskIdx = batchState.activeTasks.findIndex(t => t.tabId === tabId);
  if (taskIdx >= 0) {
    batchState.activeTasks.splice(taskIdx, 1);
    batchState.done++;
    saveBatchState().then(() => {
      if (batchState.isRunning) processBatchQueue();
    });
    return true;
  }
  return false;
}

function removeTask(tabId) {
  return removeTaskByTabId(tabId);
}

chrome.tabs.onRemoved.addListener((tabId) => {
  removeTaskByTabId(tabId);
});

// Periodic cleanup of stuck tabs (5min timeout)
chrome.alarms.create('batch-cleanup', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== 'batch-cleanup') return;
  const now = Date.now();
  for (const t of [...batchState.activeTasks]) {
    if (t.startedAt && now - t.startedAt > 5 * 60 * 1000) {
      console.warn(`[DouyinSkill] Timeout cleaning up task ${t.taskId}`);
      if (t.tabId !== -1) chrome.tabs.remove(t.tabId).catch(() => {});
      removeTaskByTaskId(t.taskId);
    }
  }
});

// Resume batch on service worker restart
loadBatchState().then(() => {
  if (batchState.isRunning) {
    console.log('[DouyinSkill] Resuming batch task from storage...');
    processBatchQueue();
  }
});