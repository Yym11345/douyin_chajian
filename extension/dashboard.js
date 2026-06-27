// ═══════════════════════════════════════════════════════════════
//  抖音数据看板 — dashboard.js
//  完全对标原版 douyin_skill dashboard.mjs 逻辑
// ═══════════════════════════════════════════════════════════════

// ── 维护判定逻辑（与原版完全一致）─────────────────────────────
function getTargetComments(likes) {
  if (likes < 10)   return 1;
  if (likes < 50)   return 2;
  if (likes < 100)  return 4;
  if (likes < 500)  return 5;
  if (likes < 1000) return 10;
  return 15;
}

function isWithin15Days(dateStr) {
  if (!dateStr) return false;
  const diff = Date.now() - new Date(dateStr).getTime();
  return diff >= 0 && diff <= 15 * 86400 * 1000;
}

function isMaintNeeded(video) {
  const likes    = Number(video.likes)    || 0;
  const comments = Number(video.comments) || 0;
  return comments < getTargetComments(likes);
}

// ── 数字格式化 ─────────────────────────────────────────────────
function fmt(n) {
  const num = Number(n) || 0;
  if (num >= 100000000) return (num / 100000000).toFixed(1) + '亿';
  if (num >= 10000)     return (num / 10000).toFixed(1) + '万';
  return num.toLocaleString('zh-CN');
}

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/`/g, '&#96;');
}

function safeUrl(url) {
  const s = String(url ?? '');
  if (s.startsWith('https://') || s.startsWith('http://')) return s;
  return '#';
}

// ── IndexedDB ─────────────────────────────────────────────────
let db, allAccounts = [], allVideos = [];

// Inject New UI Styles
if (!document.getElementById('douyin-skill-styles')) {
  const style = document.createElement('style');
  style.id = 'douyin-skill-styles';
  style.textContent = `
    /* Follower Dist BI Style */
    .bi-row { display: flex; align-items: center; margin-bottom: 12px; }
    .bi-label { width: 90px; font-size: 13px; color: #4a5568; font-weight: 500; }
    .bi-bar-container { flex: 1; background: #edf2f7; border-radius: 4px; height: 16px; margin-right: 12px; overflow: hidden; }
    .bi-bar-fill { height: 100%; border-radius: 4px; transition: width 0.6s cubic-bezier(0.16, 1, 0.3, 1); width: 0; }
    .bi-value { width: 80px; text-align: right; font-size: 13px; color: #718096; }
    .bi-value.active { font-weight: 700; color: #2d3748; }

    /* SVG Donut Style */
    .donut-container { display: flex; align-items: center; justify-content: center; gap: 32px; padding: 10px; }
    .donut-svg { transform: rotate(-90deg); overflow: visible; }
    .donut-segment { transition: stroke-dasharray 0.6s ease, stroke-width 0.2s ease; cursor: pointer; }
    .donut-segment:hover { opacity: 0.8; stroke-width: 32; }

    /* Leaderboard Style */
    .lb-row { display: flex; align-items: center; padding: 12px 0; border-bottom: 1px dashed #e2e8f0; }
    .lb-row:last-child { border-bottom: none; }
    .lb-avatar-wrap { position: relative; margin-right: 16px; flex-shrink: 0; }
    .lb-avatar-top { width: 48px; height: 48px; border-radius: 50%; object-fit: cover; background: #e2e8f0; display:flex; align-items:center; justify-content:center; color:#fff; font-size:20px; font-weight:bold; }
    .lb-avatar-normal { width: 36px; height: 36px; border-radius: 50%; background: #edf2f7; display:flex; align-items:center; justify-content:center; color:#718096; font-size:14px; font-weight:bold; }
    .lb-medal { position: absolute; bottom: -4px; right: -4px; width: 20px; height: 20px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: bold; color: white; border: 2px solid #fff; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    .lb-info { flex: 1; display: flex; flex-direction: column; gap: 6px; }
    .lb-name { font-weight: 600; color: #2d3748; font-size: 14px; }
    .lb-bar-bg { background: #edf2f7; height: 10px; border-radius: 5px; width: 100%; }
    .lb-bar-fill { height: 100%; border-radius: 5px; }
    .lb-score { margin-left: 16px; font-weight: 700; color: #4a5568; min-width: 60px; text-align: right; }
  `;
  document.head.appendChild(style);
}



// ── 缓存 & 预计算数据 ─────────────────────────────────────────
let videosByAccount = {};
let globalStats = {};
let l15Vids = [];
let l15MaintVids = [];
let accData = [];

const dbReq = indexedDB.open('DouyinSkillDB', 2);
dbReq.onupgradeneeded = e => {
  const d = e.target.result;
  if (!d.objectStoreNames.contains('accounts')) {
    d.createObjectStore('accounts', { keyPath: 'id' });
  }
  if (!d.objectStoreNames.contains('videos')) {
    const vs = d.createObjectStore('videos', { keyPath: 'id' });
    vs.createIndex('account_id', 'account_id', { unique: false });
  } else {
    // If table exists but index doesn't, create the index
    const vs = e.target.transaction.objectStore('videos');
    if (!vs.indexNames.contains('account_id')) {
      vs.createIndex('account_id', 'account_id', { unique: false });
    }
  }
};
dbReq.onsuccess = e => {
  db = e.target.result;
  // ── LOW: 处理跨 tab 的 version 冲突 ──
  // 当 background.js 触发 schema 升级时，会广播 versionchange 事件。
  // 当前连接收到事件后必须 close，否则会被 onblocked 卡住。
  db.onversionchange = () => {
    console.warn('[DouyinSkill] DB version change requested by another connection, closing.');
    db.close();
    window.location.reload();
  };
  loadAll();
};
dbReq.onblocked = () => {
  // 另一个连接（通常是 background.js 的 openDB）正在升级 schema，本连接被阻塞。
  console.warn('[DouyinSkill] DB upgrade blocked, please close other 抖音数据看板 tabs.');
  alert('数据库正在升级，请关闭其他抖音数据看板标签页后刷新本页面。');
};
dbReq.onerror = e => {
  document.getElementById('header-desc').textContent = '⚠️ 数据库初始化失败，请检查扩展权限或刷新页面';
  console.error('[DouyinSkill] DB open error:', dbReq.error);
};

function loadAll() {
  const tx = db.transaction(['accounts','videos'], 'readonly');
  tx.onerror = (e) => console.error('[DouyinSkill] TX error:', e.target.error);
  tx.onabort = (e) => console.error('[DouyinSkill] TX abort:', e.target.error);
  const ar = tx.objectStore('accounts').getAll();
  const vr = tx.objectStore('videos').getAll();
  ar.onsuccess = () => { allAccounts = ar.result || []; };
  vr.onsuccess = () => {
    const raw = vr.result || [];
    const accMap = {};
    allAccounts.forEach(a => accMap[a.id] = a);
    allVideos = raw.map(v => ({ ...v, account_name: accMap[v.account_id]?.name || '未知' }));
    
    // ⚡ O(M) 单遍聚合计算核心 ⚡
    videosByAccount = {};
    globalStats = {
      totalLikes: 0,
      totalComments: 0,
      totalFollowers: allAccounts.reduce((s,a) => s + (Number(a.followers)||0), 0),
      activeAccounts: 0,
      videoTypes: {},
      tagCounts: {}
    };
    l15Vids = [];
    l15MaintVids = [];

    // O(M) 遍历视频
    allVideos.forEach(v => {
      // 1. 分类字典
      if (!videosByAccount[v.account_id]) videosByAccount[v.account_id] = [];
      videosByAccount[v.account_id].push(v);

      // 2. 累加数据
      globalStats.totalLikes += Number(v.likes) || 0;
      globalStats.totalComments += Number(v.comments) || 0;

      // 3. 视频类型
      const t = v.type || 'video';
      globalStats.videoTypes[t] = (globalStats.videoTypes[t] || 0) + 1;

      // 4. 标签聚合
      if (v.tags) {
        String(v.tags).split(/\s+/).filter(Boolean).forEach(tag => {
          globalStats.tagCounts[tag] = (globalStats.tagCounts[tag] || 0) + 1;
        });
      }

      // 5. 15天判断
      if (isWithin15Days(v.publishedAt)) {
        l15Vids.push(v);
        if (isMaintNeeded(v)) l15MaintVids.push(v);
      }
    });

    // O(N) 遍历账号，构建 accData
    accData = allAccounts.map(a => {
      const vids = videosByAccount[a.id] || [];
      if (vids.length > 0) globalStats.activeAccounts++;
      const collectedLikes = vids.reduce((s,v)=>s+(Number(v.likes)||0),0);
      const collectedComments = vids.reduce((s,v)=>s+(Number(v.comments)||0),0);
      return {
        id: a.id, name: a.name || '未命名',
        followers: Number(a.followers)||0,
        videos: vids.length,
        likes: collectedLikes,
        accountTotalLikes: Number(a.totalLikes) || 0,
        comments: collectedComments,
        avatar: a.avatar,
      };
    });
  };
  tx.oncomplete = () => {
    renderAll();
    // Send AFTER DB is fully open to avoid MV3 race condition on page refresh
    chrome.runtime.sendMessage({ type: 'RESET_BATCH_UI' }, () => {
      void chrome.runtime.lastError;
      updateBatchStatus();
    });
  };
}

// ── 监听后台数据更新，自动刷新看板 ──────────────────────────────
chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'STATS_UPDATE') {
    // 节流：500ms 内不重复刷新
    if (window.__refreshTimer) return;
    window.__refreshTimer = setTimeout(() => {
      window.__refreshTimer = null;
      loadAll();
    }, 500);
  }
});

// State for lazy rendering
const renderedPanels = new Set();

function renderAll() {
  // Only render the currently active panel
  const activePanel = document.querySelector('.panel.active');
  const name = activePanel ? activePanel.id.replace('panel-', '') : 'global';
  renderPanel(name);
}

function renderPanel(name) {
  renderedPanels.add(name);
  if (name === 'global')   renderGlobal();
  if (name === 'maint')    renderMaint();
  if (name === 'accounts') renderAccountsPanel();
  if (name === 'ranking')  renderRanking();
}

function updateHeaderDesc() {
  const totalAccounts = allAccounts.length;
  const totalFollowers = allAccounts.reduce((s,a) => s + (Number(a.followers)||0), 0);
  let activeAccounts = 0;
  allAccounts.forEach(a => { if (allVideos.some(v => v.account_id === a.id)) activeAccounts++; });
  document.getElementById('header-desc').textContent = 
    `监控账号 ${totalAccounts} 个（活跃 ${activeAccounts}）· 采集视频 ${allVideos.length} 条 · 总粉丝 ${fmt(totalFollowers)}`;
}

// ══════════════════════════════════════════════════════════════
//  1. 全局总览 (对标 generateGlobalDashboardHtml)
// ══════════════════════════════════════════════════════════════
function renderGlobal() {
  const el = document.getElementById('global-content');
  // ── 兜底：若 accounts 表为空但有 videos，从 videos 中合成账号 ──
  if (allAccounts.length === 0 && allVideos.length > 0) {
    const synthMap = {};
    allVideos.forEach(v => {
      if (v.account_id && !synthMap[v.account_id]) {
        synthMap[v.account_id] = { id: v.account_id, name: v.account_name || v.account_id, followers: 0, totalLikes: 0, videoCount: 0 };
      }
    });
    allAccounts = Object.values(synthMap);
    // 重新计算全局统计
    globalStats.totalFollowers = 0;
    globalStats.activeAccounts = allAccounts.length;
  }
  if (allAccounts.length === 0) {
    el.innerHTML = '<div class="empty-state"><div class="empty-icon">📱</div><p>暂无数据，请先在抖音创作者主页进行采集。</p></div>';
    document.getElementById('header-desc').textContent = '监控账号 0 个 · 采集视频 0 条 · 总粉丝 0';
    return;
  }

  // ── 统计 (直接使用 O(M) 缓存) ──
  const totalAccounts   = allAccounts.length;
  const totalFollowers  = globalStats.totalFollowers;
  const totalLikes      = globalStats.totalLikes;
  const totalComments   = globalStats.totalComments;
  const totalEngagement = totalLikes + totalComments;
  const activeAccounts  = globalStats.activeAccounts;

  const l15MissingCmts = l15MaintVids.reduce((s,v) => {
    return s + Math.max(0, getTargetComments(Number(v.likes)||0) - (Number(v.comments)||0));
  }, 0);

  const topTags = Object.entries(globalStats.tagCounts).map(([tag,count])=>({tag,count})).sort((a,b)=>b.count-a.count).slice(0,30);

  const byFollowers = [...accData].sort((a,b) => b.followers - a.followers);
  const byLikes     = [...accData].sort((a,b) => b.likes     - a.likes);
  const byVideos    = [...accData].sort((a,b) => b.videos    - a.videos);

  // 粉丝分布
  const dist = [
    {range:'0-100', max:100, count:0},
    {range:'100-500', max:500, count:0},
    {range:'500-1000', max:1000, count:0},
    {range:'1000-5000', max:5000, count:0},
    {range:'5000+', max:Infinity, count:0}
  ];
  accData.forEach(a => { for (const d of dist) { if (a.followers<=d.max){ d.count++; break; } } });

  // 核心洞察
  const avgEng = allVideos.length > 0 ? (totalEngagement/allVideos.length).toFixed(1) : 0;
  const insights = [
    `覆盖总粉丝 <strong>${totalFollowers.toLocaleString()}</strong> 人，总点赞 <strong>${totalLikes.toLocaleString()}</strong> 次，总评论 <strong>${totalComments.toLocaleString()}</strong> 条`,
    byFollowers.length > 0 ? `粉丝最多的账号是「<strong>${esc(byFollowers[0].name)}</strong>」，拥有 <strong>${byFollowers[0].followers.toLocaleString()}</strong> 粉丝` : '',
    byLikes.length > 0     ? `最受欢迎的账号是「<strong>${esc(byLikes[0].name)}</strong>」，累计获得 <strong>${byLikes[0].likes.toLocaleString()}</strong> 次点赞` : '',
    byVideos.length > 0    ? `最高产的账号是「<strong>${esc(byVideos[0].name)}</strong>」，共发布 <strong>${byVideos[0].videos.toLocaleString()}</strong> 条视频` : '',
    l15MaintVids.length > 0 ? `近15天内有 <strong style="color:#dc2626">${l15MaintVids.length}</strong> 条视频待维护，缺少评论共 <strong style="color:#ea580c">${l15MissingCmts}</strong> 条` : '近15天内所有视频评论均已达标 ✅',
    topTags.length > 0 ? `热门话题「<strong>#${esc(topTags[0].tag)}</strong>」出现 ${topTags[0].count} 次` : ''
  ].filter(Boolean);

  // ── 渲染 ──
  updateHeaderDesc();

  el.innerHTML = `
    <!-- Hero Alert Cards -->
    <div class="hero-stats" style="padding-top:20px">
      <div class="hero-card hero-blue">
        <div class="hero-icon">📅</div>
        <div><div class="hero-num">${l15Vids.length}</div><div class="hero-lbl">近15天 发布视频总数</div></div>
      </div>
      <div class="hero-card hero-red">
        <div class="hero-icon">⚠️</div>
        <div><div class="hero-num">${l15MaintVids.length}</div><div class="hero-lbl">近15天 待维护视频</div></div>
      </div>
      <div class="hero-card hero-yellow">
        <div class="hero-icon">💬</div>
        <div><div class="hero-num">${l15MissingCmts}</div><div class="hero-lbl">近15天 需补充评论总数</div></div>
      </div>
      <div class="hero-card hero-green">
        <div class="hero-icon">🔥</div>
        <div><div class="hero-num">${avgEng}</div><div class="hero-lbl">全局单条视频平均互动</div></div>
      </div>
    </div>

    <!-- Stats Row -->
    <div class="stats-row">
      <div class="stat-card"><div class="number">${totalAccounts}</div><div class="label">监控账号总数</div><div class="sub">活跃 ${activeAccounts}</div></div>
      <div class="stat-card"><div class="number">${fmt(totalFollowers)}</div><div class="label">总粉丝数</div><div class="sub">${totalFollowers.toLocaleString()} 人</div></div>
      <div class="stat-card"><div class="number">${allVideos.length.toLocaleString()}</div><div class="label">采集视频数</div><div class="sub">去重后总量</div></div>
      <div class="stat-card"><div class="number">${fmt(totalLikes)}</div><div class="label">总点赞数</div><div class="sub">${totalLikes.toLocaleString()} 次</div></div>
      <div class="stat-card"><div class="number">${totalComments.toLocaleString()}</div><div class="label">总评论数</div><div class="sub">互动 ${totalEngagement.toLocaleString()}</div></div>
      <div class="stat-card"><div class="number">${avgEng}</div><div class="label">单条平均互动</div><div class="sub">点赞+评论 / 视频</div></div>
    </div>

    <div class="content">
      <!-- 核心洞察 -->
      <div class="section">
        <div class="section-title">💡 核心洞察</div>
        <div class="insight-box">${insights.map(s=>'📌 '+s).join('<br>')}</div>
      </div>

      <!-- 三大排行榜 -->
      <div class="section">
        <div class="grid-3">
          <div class="card">
            <div class="card-header">🏆 粉丝数 TOP 10</div>
            <div class="card-body" style="padding:0">
              <table><thead><tr><th>#</th><th>账号</th><th>粉丝</th><th>视频</th><th>点赞</th></tr></thead>
              <tbody>${byFollowers.slice(0,10).map((a,i)=>`<tr>
                <td><span class="rank-num${i<3?' rank-'+(i+1):''}">${i+1}</span></td>
                <td><span style="color:#3182ce">${esc(a.name)}</span></td>
                <td>${fmt(a.followers)}</td><td>${a.videos}</td><td>${fmt(a.likes)}</td>
              </tr>`).join('')}</tbody></table>
            </div>
          </div>
          <div class="card">
            <div class="card-header">🔥 点赞数 TOP 10</div>
            <div class="card-body" style="padding:0">
              <table><thead><tr><th>#</th><th>账号</th><th>点赞</th><th>粉丝</th><th>评论</th></tr></thead>
              <tbody>${byLikes.slice(0,10).map((a,i)=>`<tr>
                <td><span class="rank-num${i<3?' rank-'+(i+1):''}">${i+1}</span></td>
                <td><span style="color:#3182ce">${esc(a.name)}</span></td>
                <td>${fmt(a.likes)}</td><td>${fmt(a.followers)}</td><td>${a.comments.toLocaleString()}</td>
              </tr>`).join('')}</tbody></table>
            </div>
          </div>
          <div class="card">
            <div class="card-header">📹 高产账号 TOP 10</div>
            <div class="card-body" style="padding:0">
              <table><thead><tr><th>#</th><th>账号</th><th>视频数</th><th>粉丝</th><th>点赞</th></tr></thead>
              <tbody>${byVideos.slice(0,10).map((a,i)=>`<tr>
                <td><span class="rank-num${i<3?' rank-'+(i+1):''}">${i+1}</span></td>
                <td><span style="color:#3182ce">${esc(a.name)}</span></td>
                <td>${a.videos}</td><td>${fmt(a.followers)}</td><td>${fmt(a.likes)}</td>
              </tr>`).join('')}</tbody></table>
            </div>
          </div>
        </div>
      </div>

      <!-- 图表区（CSS 渲染，无 Chart.js） -->
      <div class="section">
        <div class="grid-2">
          <div class="card">
            <div class="card-header">📈 粉丝数分布</div>
            <div class="card-body" id="distList"></div>
          </div>
          <div class="card">
            <div class="card-header">🎬 视频类型分布</div>
            <div class="card-body" id="typeList"></div>
          </div>
        </div>
      </div>
      <div class="section">
        <div class="card">
          <div class="card-header">📊 账号粉丝数排行 TOP 10</div>
          <div class="card-body" id="rankList"></div>
        </div>
      </div>

      <!-- 标签词云 -->
      ${topTags.length > 0 ? `
      <div class="section">
        <div class="card">
          <div class="card-header">🏷️ 热门话题标签 TOP 30</div>
          <div class="card-body">
            <div class="tag-cloud">
              ${topTags.map(t => {
                const maxCount = topTags[0].count;
                const size = Math.round(12 + (t.count/maxCount)*18);
                const opacity = (0.5 + (t.count/maxCount)*0.5).toFixed(2);
                return `<span class="tag-item" style="font-size:${size}px;opacity:${opacity}">#${esc(t.tag)} (${t.count})</span>`;
              }).join('')}
            </div>
          </div>
        </div>
      </div>` : ''}
    </div>
  `;

  // ── CSS 渲染图表区（替代 Chart.js） ──
  // 粉丝数分布：BI 柱状图
  const distMax = Math.max(1, ...dist.map(d => d.count));
  const distGradients = [
    'linear-gradient(90deg, #90cdf4, #4299e1)',
    'linear-gradient(90deg, #9ae6b4, #48bb78)',
    'linear-gradient(90deg, #fbd38d, #ed8936)',
    'linear-gradient(90deg, #fbb6ce, #ed64a6)',
    'linear-gradient(90deg, #feb2b2, #f56565)'
  ];
  
  const totalDistCount = dist.reduce((s,d) => s+d.count, 0);
  const distHtml = dist.map((d, i) => {
    const w = Math.round((d.count / distMax) * 100);
    const pct = totalDistCount > 0 ? Math.round((d.count / totalDistCount) * 100) : 0;
    return `<div class="bi-row">
      <div class="bi-label">${esc(d.range)}</div>
      <div class="bi-bar-container"><div class="bi-bar-fill" style="width:0; background:${distGradients[i]};" data-target-width="${w}%"></div></div>
      <div class="bi-value ${d.count > 0 ? 'active' : ''}">${d.count} 个 (${pct}%)</div>
    </div>`;
  }).join('');
  document.getElementById('distList').innerHTML = distHtml || '<div style="color:#a0aec0;padding:20px;text-align:center">暂无数据</div>';

  // Trigger animation for BI bars
  setTimeout(() => {
    document.querySelectorAll('.bi-bar-fill').forEach(el => {
      el.style.width = el.getAttribute('data-target-width');
    });
  }, 50);

  // 视频类型分布：SVG Donut Chart
  const typeLabels = { video:'视频', image_text:'图文', live_replay:'直播回放', live:'直播' };
  const typeColors = { video:'#4299e1', image_text:'#48bb78', live_replay:'#ed8936', live:'#9f7aea' };
  const typeEntries = Object.entries(globalStats.videoTypes).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  
  let typeHtml = '';
  if (typeEntries.length === 0) {
    typeHtml = '<div style="color:#a0aec0;padding:20px;text-align:center">暂无数据</div>';
  } else {
    const totalVids = typeEntries.reduce((s, [, x]) => s + x, 0);
    const radius = 60;
    const circumference = 2 * Math.PI * radius;
    let currentOffset = 0;
    
    let svgArcs = '';
    let legendHtml = '<div style="display:flex;flex-direction:column;gap:12px;">';
    
    typeEntries.forEach(([k, n], i) => {
      const pct = totalVids > 0 ? (n / totalVids) : 0;
      // Leave a tiny 2px gap (roughly 0.01 * circumference) for visual separation unless it's 100%
      const gap = pct === 1 ? 0 : 2;
      const arcLength = Math.max(0, (pct * circumference) - gap);
      const color = typeColors[k] || '#a0aec0';
      
      svgArcs += `<circle class="donut-segment" cx="80" cy="80" r="${radius}" 
        fill="transparent" stroke="${color}" stroke-width="28" 
        stroke-dasharray="${arcLength} ${circumference}" 
        stroke-dashoffset="${-currentOffset}"></circle>`;
        
      currentOffset += pct * circumference;
      
      const displayPct = Math.round(pct * 100);
      legendHtml += `<div style="display:flex;align-items:center;font-size:13px;">
        <span style="width:10px;height:10px;border-radius:50%;background:${color};margin-right:8px;"></span>
        <span style="color:#4a5568;width:60px;">${esc(typeLabels[k] || k)}</span>
        <span style="color:#2d3748;font-weight:700;width:40px;">${n}</span>
        <span style="color:#a0aec0;">${displayPct}%</span>
      </div>`;
    });
    
    legendHtml += '</div>';
    
    typeHtml = `
      <div class="donut-container">
        <svg class="donut-svg" viewBox="0 0 160 160" width="160" height="160">
          <circle cx="80" cy="80" r="${radius}" fill="transparent" stroke="#edf2f7" stroke-width="28"></circle>
          ${svgArcs}
          <text x="80" y="75" text-anchor="middle" dominant-baseline="middle" transform="rotate(90 80 80)" fill="#2d3748" font-size="24" font-weight="bold">${totalVids}</text>
          <text x="80" y="98" text-anchor="middle" dominant-baseline="middle" transform="rotate(90 80 80)" fill="#a0aec0" font-size="12">条视频</text>
        </svg>
        ${legendHtml}
      </div>
    `;
  }
  document.getElementById('typeList').innerHTML = typeHtml;

  // 账号粉丝数排行 TOP 10：榜单海报风格
  const top10 = byFollowers.slice(0, 10);
  const rankMax = Math.max(1, ...top10.map(a => a.followers || 0));
  
  const rankHtml = top10.length === 0
    ? '<div style="color:#a0aec0;padding:20px;text-align:center">暂无数据</div>'
    : top10.map((a, i) => {
        const w = Math.round((a.followers / rankMax) * 100);
        
        let avatarHtml = '';
        let medalHtml = '';
        let barColor = 'linear-gradient(90deg, #4299e1, #63b3ed)'; // Default blue
        
        if (i < 3) {
          const medalColors = ['#F6AD55', '#CBD5E0', '#C05621']; // Gold, Silver, Bronze
          const barGradients = [
            'linear-gradient(90deg, #D69E2E, #F6AD55)',
            'linear-gradient(90deg, #A0AEC0, #CBD5E0)',
            'linear-gradient(90deg, #9C4221, #C05621)'
          ];
          barColor = barGradients[i];
          medalHtml = `<div class="lb-medal" style="background:${medalColors[i]}">${i+1}</div>`;
          
          if (a.avatar) {
            avatarHtml = `<img class="lb-avatar-top" src="${safeUrl(a.avatar)}" onerror="this.style.display='none'">`;
          } else {
            const initial = a.name ? a.name.charAt(0) : '?';
            const bgColors = ['#E53E3E', '#D69E2E', '#38A169', '#3182CE', '#805AD5', '#D53F8C'];
            const bg = bgColors[(a.name||'').length % bgColors.length];
            avatarHtml = `<div class="lb-avatar-top" style="background:${bg}">${esc(initial)}</div>`;
          }
          avatarHtml = `<div class="lb-avatar-wrap">${avatarHtml}${medalHtml}</div>`;
        } else {
          avatarHtml = `<div class="lb-avatar-wrap"><div class="lb-avatar-normal">${i+1}</div></div>`;
        }

        return `<div class="lb-row">
          ${avatarHtml}
          <div class="lb-info">
            <div class="lb-name">${esc(a.name)}</div>
            <div class="lb-bar-bg"><div class="lb-bar-fill" style="width:${w}%; background:${barColor}"></div></div>
          </div>
          <div class="lb-score">${fmt(a.followers)}</div>
        </div>`;
      }).join('');
  document.getElementById('rankList').innerHTML = rankHtml;
}

// ══════════════════════════════════════════════════════════════
//  2. 维护看板 (对标 generatePersonHtml 的分级维护逻辑)
// ══════════════════════════════════════════════════════════════
function renderMaint() {
  const el = document.getElementById('maint-content');
  if (allVideos.length === 0) return;
  const ROWS_INITIAL = 50;

  const TIERS = [
    { label:'10赞内',    color:'#2e7d32', icon:'🟢', max:10,       vids:[] },
    { label:'50赞内',    color:'#1565c0', icon:'🔵', max:50,       vids:[] },
    { label:'100赞内',   color:'#f57f17', icon:'🟡', max:100,      vids:[] },
    { label:'500赞内',   color:'#d84315', icon:'🟠', max:500,      vids:[] },
    { label:'1000赞内',  color:'#c62828', icon:'🔴', max:1000,     vids:[] },
    { label:'1000赞以上',color:'#6a1b9a', icon:'🟣', max:Infinity, vids:[] },
  ];

  let allMaint = 0;
  const l15Vids = allVideos.filter(v => isWithin15Days(v.publishedAt));

  allVideos.forEach(v => {
    const likes    = Number(v.likes)    || 0;
    const comments = Number(v.comments) || 0;
    const target   = getTargetComments(likes);
    const maint    = comments < target;
    const is15     = isWithin15Days(v.publishedAt);
    if (maint) allMaint++;
    const vObj = { ...v, isMaint: maint, isL15: is15, targetComments: target };
    for (const tier of TIERS) { if (likes <= tier.max) { tier.vids.push(vObj); break; } }
  });

  // Sort tiers: maint first, then newest
  TIERS.forEach(tier => {
    tier.vids.sort((a,b) => {
      if (a.isMaint && !b.isMaint) return -1;
      if (!a.isMaint && b.isMaint) return 1;
      return (b.publishedAt||'') > (a.publishedAt||'') ? 1 : -1;
    });
  });

  const l15MaintCount = l15Vids.filter(isMaintNeeded).length;
  const l15MissingCmts = l15Vids.filter(isMaintNeeded).reduce((s,v)=>
    s + Math.max(0, getTargetComments(Number(v.likes)||0) - (Number(v.comments)||0)), 0);

  const tierCardsHtml = TIERS.map(t => {
    const ok   = t.vids.filter(v => !v.isMaint).length;
    const warn = t.vids.filter(v =>  v.isMaint).length;
    return `<div class="tier-card" style="border-top-color:${t.color}">
      <div class="tier-icon">${t.icon}</div>
      <div class="tier-count" style="color:${t.color}">${t.vids.length}</div>
      <div class="tier-label" style="color:${t.color}">${t.label}</div>
      <div class="tier-sub">✅${ok} ⚠️${warn}</div>
    </div>`;
  }).join('');

  const tierPanelsHtml = TIERS.map((tier, idx) => {
    const l15MaintN = tier.vids.filter(v => v.isMaint && v.isL15).length;

    const rows = tier.vids.map((v, i) => {
      const actualIndex = i;
      const pubDate = (v.publishedAt||'').slice(0,10);
      const title   = esc((v.title||'').slice(0,40)) + ((v.title||'').length>40?'…':'');
      const cmtHtml = v.isMaint ? `${v.comments}<em style="color:#dc2626;font-size:11px">/${v.targetComments}</em>` : v.comments;
      return `<tr class="${v.isMaint?'row-maint':''}">
        <td>${actualIndex+1}</td>
        <td>${v.isMaint?'<span class="badge-maint">⚠️待维护</span>':'<span class="badge-ok">✅达标</span>'}</td>
        <td style="font-size:12px;color:#718096">${esc(v.account_name)}</td>
        <td><a href="${safeUrl(v.url)}" target="_blank" title="${esc(v.title)}">${title}</a></td>
        <td class="num">${v.likes}</td>
        <td class="num">${cmtHtml}</td>
        <td style="font-size:12px;white-space:nowrap">${pubDate}</td>
      </tr>`;
    }).join('');

    return `<div class="tier-panel">
      <div class="tier-panel-header">
        <span style="font-size:16px">${tier.icon}</span>
        <span style="font-size:14px;font-weight:700;color:${tier.color}">${tier.label}</span>
        <span class="tier-pill tier-pill-maint">⚠️ 15天待维护 ${l15MaintN}</span>
        <span class="tier-pill tier-pill-total">共 ${tier.vids.length} 条</span>
      </div>
      <div style="overflow-x:auto">
        <table>
          <thead><tr><th>#</th><th>状态</th><th>账号</th><th>标题</th><th class="num">点赞</th><th class="num">评论/目标</th><th>日期</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
  }).join('');

  el.innerHTML = `
    <div class="hero-stats" style="padding-top:20px">
      <div class="hero-card hero-blue"><div class="hero-icon">📅</div><div><div class="hero-num">${l15Vids.length}</div><div class="hero-lbl">近15天 发布视频</div></div></div>
      <div class="hero-card hero-red"><div class="hero-icon">⚠️</div><div><div class="hero-num">${l15MaintCount}</div><div class="hero-lbl">近15天 待维护视频</div></div></div>
      <div class="hero-card hero-orange"><div class="hero-icon">💬</div><div><div class="hero-num">${l15MissingCmts}</div><div class="hero-lbl">近15天 待补评论数</div></div></div>
    </div>
    <div class="stats-row">
      <div class="stat-card"><div class="number">${allVideos.length}</div><div class="label">全部视频</div></div>
      <div class="stat-card red"><div class="number">${allMaint}</div><div class="label">⚠️ 待维护(全部)</div></div>
      <div class="stat-card"><div class="number">${allVideos.length - allMaint}</div><div class="label">✅ 达标视频</div></div>
      <div class="stat-card"><div class="number">${allAccounts.length}</div><div class="label">监控账号数</div></div>
    </div>
    <div class="tier-row">${tierCardsHtml}</div>
    <div class="content">${tierPanelsHtml}</div>
  `;
}

// ══════════════════════════════════════════════════════════════
//  3. 账号列表面板
// ══════════════════════════════════════════════════════════════
function renderAccountsPanel(query = '') {
  const q = query.toLowerCase();
  let accs = [...accData];
  if (q) accs = accs.filter(a => a.name.toLowerCase().includes(q));
  accs.sort((a,b) => b.followers - a.followers);

  const tbody = document.getElementById('accounts-tbody');
  if (!tbody) return;

  tbody.innerHTML = accs.map((a, i) => {
    const actualIndex = i;
    const er = a.followers > 0 ? ((a.likes+a.comments)/a.followers).toFixed(2) : '-';
    return `<tr>
      <td>${actualIndex+1}</td>
      <td>
        <div style="display:flex;align-items:center;gap:10px">
          ${a.avatar?`<img src="${safeUrl(a.avatar)}" style="width:30px;height:30px;border-radius:50%;" onerror="this.style.display='none'">`:``}
          <strong>${esc(a.name)}</strong>
        </div>
      </td>
      <td>${fmt(a.followers)}</td>
      <td>${a.videos}</td>
      <td>${fmt(a.likes)}</td>
      <td>${a.comments.toLocaleString()}</td>
      <td>${er}</td>
      <td>
        <a href="#" class="action-open-detail" data-id="${esc(a.id)}">查看详情 →</a>
        <a href="#" class="action-delete-account" data-id="${esc(a.id)}" style="color:#e53e3e;margin-left:10px;">🗑️删除</a>
      </td>
    </tr>`;
  }).join('') || '<tr><td colspan="8" style="text-align:center;padding:40px;color:#a0aec0">暂无数据</td></tr>';
}

window.deleteAccount = function(accountId, btn) {
  if (!confirm('确定要删除该账号及与其关联的所有视频吗？')) return;

  // ── 防抖：禁用触发按钮，避免重复点击启动并行事务 ──
  let originalLabel = null;
  if (btn) {
    originalLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = '删除中…';
  }
  const restoreBtn = () => {
    if (btn && originalLabel !== null) {
      btn.disabled = false;
      btn.textContent = originalLabel;
    }
  };

  const tx = db.transaction(['accounts', 'videos'], 'readwrite');
  tx.onerror = (e) => {
    console.error('[DouyinSkill] Delete tx error:', e.target.error);
    alert('删除失败：' + (e.target.error?.message || '事务错误') + '，请重试');
    restoreBtn();
  };
  tx.onabort = (e) => {
    console.error('[DouyinSkill] Delete tx aborted:', e.target.error);
    alert('删除被中止：' + (e.target.error?.message || '操作冲突') + '，请重试');
    restoreBtn();
  };

  // ── P2: 先删 videos（cursor 链式），全部删完后再删 account ──
  // 这样避免 accounts.delete 提前完成触发事务 auto-commit，
  // 导致 cursor 后半段 videos 残留。
  const videoStore = tx.objectStore('videos');
  const index = videoStore.index('account_id');
  const req = index.openCursor(IDBKeyRange.only(accountId));
  req.onerror = (e) => {
    console.error('[DouyinSkill] openCursor error:', e.target.error);
  };
  req.onsuccess = (e) => {
    const cursor = e.target.result;
    if (cursor) {
      // ── P0: cursor.delete().onsuccess → cursor.continue() 链式 ──
      // 之前 delete 后立即 continue 违反 W3C IndexedDB 规范，
      // 触发事务 auto-commit / InvalidStateError 间歇失败。
      const delReq = cursor.delete();
      delReq.onsuccess = () => cursor.continue();
      delReq.onerror = (err) => {
        console.error('[DouyinSkill] Cursor delete failed:', err.target.error);
        // 即使单条失败也继续，不阻塞整体删除
        cursor.continue();
      };
    } else {
      // 游标走完，videos 全部删完，现在删 account
      tx.objectStore('accounts').delete(accountId);
    }
  };

  tx.oncomplete = () => {
    loadAll(); // Reload all data; renderAll() auto re-renders active panel
    updateHeaderDesc(); // Force update header
    document.getElementById('tab-detail').style.display = 'none';
    restoreBtn();
  };
};

document.getElementById('accountSearch').addEventListener('input', e => {
  renderAccountsPanel(e.target.value);
});

// ══════════════════════════════════════════════════════════════
//  4. 视频排行
// ══════════════════════════════════════════════════════════════
function renderRanking(sortKey='likes', query='') {
  let vids = [...allVideos];
  if (query) {
    const q = query.toLowerCase();
    vids = vids.filter(v => (v.title||'').toLowerCase().includes(q) || (v.account_name||'').toLowerCase().includes(q));
  }
  vids.sort((a,b) => sortKey === 'publishedAt'
    ? (b.publishedAt||'') > (a.publishedAt||'') ? 1 : -1
    : (Number(b[sortKey])||0) - (Number(a[sortKey])||0));

  const typeMap = { video:'视频', image_text:'图文', live_replay:'直播回放', live:'直播' };
  const tbody = document.getElementById('rank-tbody');
  if (!tbody) return;

  const limitedVids = vids.slice(0, 200);
  
  tbody.innerHTML = `<tr><td colspan="8" style="padding:10px 20px;color:#718096;font-size:13px;border-bottom:1px solid #edf2f7;background:#f7fafc;">共 ${vids.length} 条，展示 Top ${limitedVids.length}</td></tr>` +
  (limitedVids.map((v,i) => {
    const actualIndex = i;
    return `
    <tr>
      <td><span class="rank-num${actualIndex<3?' rank-'+(actualIndex+1):''}">${actualIndex+1}</span></td>
      <td style="white-space:nowrap;font-size:12px;color:#718096;cursor:pointer" class="action-open-detail" data-id="${esc(v.account_id)}">${esc(v.account_name)}</td>
      <td style="max-width:320px"><a href="${safeUrl(v.url)}" target="_blank">${esc((v.title||'(无标题)').slice(0,45))}${(v.title||'').length>45?'…':''}</a></td>
      <td><span style="font-size:11px;background:#ebf4ff;color:#3182ce;padding:2px 7px;border-radius:4px">${typeMap[v.type]||v.type||'—'}</span></td>
      <td style="white-space:nowrap;font-size:12px;color:#718096">${(v.publishedAt||'').slice(0,10)||'—'}</td>
      <td class="num" style="color:#e53e3e;font-weight:700">${fmt(v.likes)}</td>
      <td class="num">${fmt(v.comments)}</td>
      <td class="num">${fmt(v.shares)}</td>
    </tr>
  `}).join('') || '<tr><td colspan="8" style="text-align:center;padding:40px;color:#a0aec0">暂无数据</td></tr>');
}

document.getElementById('rankSortBy').addEventListener('change', e => {
  renderRanking(e.target.value, document.getElementById('rankSearch').value);
});
document.getElementById('rankSearch').addEventListener('input', e => {
  renderRanking(document.getElementById('rankSortBy').value, e.target.value);
});

// ══════════════════════════════════════════════════════════════
//  5. 账号详情
// ══════════════════════════════════════════════════════════════
window.openDetail = function(accountId) {
  const acc  = allAccounts.find(a => a.id === accountId);
  if (!acc) return;
  const vids = allVideos.filter(v => v.account_id === accountId);
  vids.sort((a,b) => (Number(b.likes)||0) - (Number(a.likes)||0));

  const maintVids  = vids.filter(isMaintNeeded);
  const l15        = vids.filter(v => isWithin15Days(v.publishedAt));
  const l15Maint   = l15.filter(isMaintNeeded);
  const totalCmts  = vids.reduce((s,v)=>s+(Number(v.comments)||0),0);
  const totalShares= vids.reduce((s,v)=>s+(Number(v.shares)||0),0);
  const totalFav   = vids.reduce((s,v)=>s+(Number(v.favorites)||0),0);
  const l15Missing = l15Maint.reduce((s,v)=>s+Math.max(0,getTargetComments(Number(v.likes)||0)-(Number(v.comments)||0)),0);

  document.getElementById('detail-content').innerHTML = `
    <div class="detail-header">
      ${acc.avatar?`<img class="detail-avatar" src="${safeUrl(acc.avatar)}" onerror="this.style.display='none'">`:``}
      <div>
        <div class="detail-name">${esc(acc.name)}</div>
        <div class="detail-sig">${esc(acc.signature||'')}</div>
        <a href="https://www.douyin.com/user/${esc(acc.id)}" target="_blank" style="color:#90cdf4;font-size:13px;margin-top:4px;display:inline-block">查看抖音主页 →</a>
      </div>
      <div style="margin-left:auto">
        <button class="action-export-csv" data-id="${esc(acc.id)}" style="background:rgba(255,255,255,0.15);color:#fff;border:none;padding:8px 16px;border-radius:6px;cursor:pointer;font-size:13px;font-weight:600;margin-right:8px;">⬇️ 导出 CSV</button>
        <button class="action-delete-account" data-id="${esc(acc.id)}" style="background:rgba(229,62,62,0.8);color:#fff;border:none;padding:8px 16px;border-radius:6px;cursor:pointer;font-size:13px;font-weight:600">🗑️ 删除账号</button>
      </div>
    </div>

    <div class="hero-stats" style="padding-top:16px">
      <div class="hero-card hero-blue"><div class="hero-icon">📅</div><div><div class="hero-num">${l15.length}</div><div class="hero-lbl">近15天 发布视频</div></div></div>
      <div class="hero-card hero-red"><div class="hero-icon">⚠️</div><div><div class="hero-num">${l15Maint.length}</div><div class="hero-lbl">近15天 待维护</div></div></div>
      <div class="hero-card hero-orange"><div class="hero-icon">💬</div><div><div class="hero-num">${l15Missing}</div><div class="hero-lbl">近15天 待补评论</div></div></div>
    </div>

    <div class="stats-row">
      <div class="stat-card"><div class="number">${fmt(acc.followers)}</div><div class="label">粉丝数</div></div>
      <div class="stat-card"><div class="number">${vids.length}</div><div class="label">采集视频</div></div>
      <div class="stat-card"><div class="number">${fmt(acc.totalLikes)}</div><div class="label">账号总获赞</div></div>
      <div class="stat-card"><div class="number">${fmt(totalCmts)}</div><div class="label">评论合计</div></div>
      <div class="stat-card"><div class="number">${fmt(totalShares)}</div><div class="label">分享合计</div></div>
      <div class="stat-card red"><div class="number">${maintVids.length}</div><div class="label">⚠️ 待维护视频（全部）</div></div>
    </div>

    <div class="content">
      <div class="card">
        <div class="card-header">📋 视频明细（${vids.length} 条）
          <input type="text" id="detailSearch" placeholder="搜索标题…" style="margin-left:auto;width:200px">
        </div>
        <div style="overflow-x:auto">
          <table>
            <thead><tr><th>#</th><th>状态</th><th>标题</th><th>发布</th><th class="num">点赞</th><th class="num">评论/目标</th><th class="num">分享</th><th class="num">收藏</th></tr></thead>
            <tbody id="detail-tbody">
              ${vids.map((v,i) => {
                const maint = isMaintNeeded(v);
                const target = getTargetComments(Number(v.likes)||0);
                const cmtHtml = maint ? `${v.comments}<em style="color:#dc2626;font-size:11px">/${target}</em>` : v.comments;
                return `<tr class="${maint?'row-maint':''}" data-title="${esc((v.title||'').toLowerCase())}">
                  <td style="color:#a0aec0">${i+1}</td>
                  <td>${maint?'<span class="badge-maint">⚠️待维护</span>':'<span class="badge-ok">✅达标</span>'}</td>
                  <td style="max-width:340px"><a href="${safeUrl(v.url)}" target="_blank">${esc((v.title||'(无标题)').slice(0,50))}${(v.title||'').length>50?'…':''}</a></td>
                  <td style="white-space:nowrap;font-size:12px;color:#718096">${(v.publishedAt||'').slice(0,10)||'—'}</td>
                  <td class="num" style="${maint?'color:#dc2626;font-weight:700':''}">${fmt(v.likes)}</td>
                  <td class="num">${cmtHtml}</td>
                  <td class="num">${fmt(v.shares)}</td>
                  <td class="num">${fmt(v.favorites)}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  document.getElementById('tab-detail').style.display = 'block';
  switchTab('detail');
};

window.filterDetail = function(q) {
  document.querySelectorAll('#detail-tbody tr').forEach(r => {
    r.classList.toggle('hidden', !r.dataset.title.includes(q.toLowerCase()));
  });
};

window.exportAccountCsv = function(id) {
  const acc  = allAccounts.find(a => a.id === id);
  const vids = allVideos.filter(v => v.account_id === id);
  exportCsv(acc ? acc.name : id, vids);
};

// ══════════════════════════════════════════════════════════════
//  6. Tab 切换
// ══════════════════════════════════════════════════════════════
function switchTab(name) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('panel-'+name).classList.add('active');
  document.querySelector(`[data-panel="${name}"]`).classList.add('active');
  
  // Lazy render: only fetch/render if data is stale or tab hasn't been rendered yet
  if (db && ['global', 'maint', 'accounts', 'ranking'].includes(name)) {
    if (window.__isBatchRunning || window.__isStale || !renderedPanels.has('global')) {
      loadAll();
      window.__isStale = false;
    } else if (!renderedPanels.has(name)) {
      renderPanel(name);
    }
  }
}

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.id === 'tab-detail') return; // 仅由 openDetail 打开
    switchTab(btn.dataset.panel);
  });
});

document.querySelector('[data-panel="detail"]').addEventListener('click', () => switchTab('detail'));

// ══════════════════════════════════════════════════════════════
//  7. CSV 导出
// ══════════════════════════════════════════════════════════════
function exportCsv(filename, videos) {
  const accMap = {};
  allAccounts.forEach(a => accMap[a.id] = a.name);
  const headers = ['账号ID','账号名称','视频URL','发布时间','类型','标题','点赞','评论','分享','收藏'];
  const rows = videos.map(v => [
    v.account_id, accMap[v.account_id]||v.account_name, v.url||'',
    v.publishedAt||'', v.type||'', `"${(v.title||'').replace(/"/g,'""')}"`,
    v.likes||0, v.comments||0, v.shares||0, v.favorites||0
  ]);
  const csv = '\uFEFF' + [headers.join(','), ...rows.map(r=>r.join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `抖音数据_${filename}_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
}

document.getElementById('btnExportAll').addEventListener('click', () => {
  if (!allVideos.length) return alert('暂无数据');
  
  // 按照创作者主页进行划分
  const grouped = {};
  allAccounts.forEach(a => grouped[a.id] = { name: a.name, videos: [] });
  allVideos.forEach(v => {
    if (!grouped[v.account_id]) grouped[v.account_id] = { name: v.account_name, videos: [] };
    grouped[v.account_id].videos.push(v);
  });

  const headers = ['账号ID','账号名称','视频URL','发布时间','类型','标题','点赞','评论','分享','收藏'];
  let csvBlocks = [];

  for (const accId in grouped) {
    const acc = grouped[accId];
    if (acc.videos.length === 0) continue;
    
    // 添加分割行
    csvBlocks.push(`"====== 创作者：${(acc.name||'').replace(/"/g,'""')} (ID: ${accId}) ======"`);
    csvBlocks.push(headers.join(','));
    
    const rows = acc.videos.map(v => [
      v.account_id, acc.name||v.account_name, v.url||'',
      v.publishedAt||'', v.type||'', `"${(v.title||'').replace(/"/g,'""')}"`,
      v.likes||0, v.comments||0, v.shares||0, v.favorites||0
    ]);
    
    csvBlocks.push(rows.map(r => r.join(',')).join('\n'));
    csvBlocks.push(''); // 账号之间的空行
  }

  const csv = '\uFEFF' + csvBlocks.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `抖音全量数据_按账号划分_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
});

// ══════════════════════════════════════════════════════════════
//  8. 清空数据库
// ══════════════════════════════════════════════════════════════
document.getElementById('btnClear').addEventListener('click', () => {
  // ── HIGH (症状 B 根因 #1)：二次验证 ──
  // 原代码：单一 confirm 容易被误点/脚本触发。
  // 改为：先 confirm 警示，再 prompt 要求输入 DELETE 才执行。
  // 防御：防止用户误触 / 自动化脚本 / 屏幕阅读器误触发。
  if (!confirm('⚠️ 警告：此操作将永久删除所有账号和视频数据，且不可恢复！\n\n下一步将要求您输入 DELETE 确认。')) return;
  const challenge = prompt('请输入大写字母 DELETE 以确认清空操作：');
  if (challenge !== 'DELETE') {
    alert('输入不正确，操作已取消。');
    return;
  }

  const tx = db.transaction(['accounts','videos'], 'readwrite');
  tx.onerror = (e) => {
    console.error('[DouyinSkill] Clear tx error:', e.target.error);
    alert('清空失败：' + (e.target.error?.message || '事务错误'));
  };
  tx.objectStore('accounts').clear();
  tx.objectStore('videos').clear();
  tx.oncomplete = () => {
    chrome.runtime.sendMessage({ type: 'RESET_STATS' }, () => {
      allAccounts = [];
      allVideos   = [];
      accData     = [];
      globalStats = {
        totalFollowers: 0,
        totalLikes: 0,
        totalComments: 0,
        activeAccounts: 0,
        tagCounts: {},
        videoTypes: { video: 0, image_text: 0, live: 0, live_replay: 0 }
      };
      renderAll();
      document.getElementById('tab-detail').style.display = 'none';
      switchTab('global');
      alert('✅ 数据库已清空');
    });
  };
});

// ══════════════════════════════════════════════════════════════
//  Event Delegation for CSP Compliance
// ══════════════════════════════════════════════════════════════
document.addEventListener('click', e => {
  const openDetailBtn = e.target.closest('.action-open-detail');
  if (openDetailBtn) {
    e.preventDefault();
    openDetail(openDetailBtn.dataset.id);
  }
  
  const deleteBtn = e.target.closest('.action-delete-account');
  if (deleteBtn) {
    e.preventDefault();
    deleteAccount(deleteBtn.dataset.id);
  }

  const exportBtn = e.target.closest('.action-export-csv');
  if (exportBtn) {
    e.preventDefault();
    exportAccountCsv(exportBtn.dataset.id);
  }
});

document.addEventListener('input', e => {
  if (e.target.id === 'detailSearch') {
    filterDetail(e.target.value);
  }
  if (e.target.id === 'batchUrls') {
    const text = e.target.value;
    const cleanedText = text.replace(/[\r\n\s]+/g, '');
    const urls = cleanedText.match(/https?:\/\/(?:www\.)?douyin\.com\/user\/[A-Za-z0-9_\-\.]+/g) || [];
    const uniqueUrls = [...new Set(urls)];
    document.getElementById('batchUrlCount').textContent = `已添加 ${urls.length} 个链接`;
    window.__isStale = true; // Data likely changes during batch
  }
});


// ══════════════════════════════════════════════════════════════
//  Batch Scrape Logic
// ══════════════════════════════════════════════════════════════
let batchPollInterval = null;

document.getElementById('btnStartBatch').addEventListener('click', () => {
  const text = document.getElementById('batchUrls').value;
  const cleanedText = text.replace(/[\r\n\s]+/g, '');
  const urls = cleanedText.match(/https?:\/\/(?:www\.)?douyin\.com\/user\/[A-Za-z0-9_\-\.]+/g) || [];
  const uniqueUrls = [...new Set(urls)];
  if (uniqueUrls.length === 0) return alert('未识别到有效的抖音主页链接，请检查输入格式');

  chrome.runtime.sendMessage({
    type: 'START_BATCH',
    urls: uniqueUrls
  }, res => {
    if (res && res.success) {
      document.getElementById('btnStartBatch').style.display = 'none';
      document.getElementById('btnStopBatch').style.display = 'inline-block';
      startBatchPoll();
    }
  });
});

document.getElementById('btnStopBatch').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'STOP_BATCH' }, () => {
    document.getElementById('btnStopBatch').style.display = 'none';
    document.getElementById('btnStartBatch').style.display = 'inline-block';
    stopBatchPoll();
  });
});

function startBatchPoll() {
  if (batchPollInterval) clearInterval(batchPollInterval);
  batchPollInterval = setInterval(updateBatchStatus, 1000);
  updateBatchStatus();
}

function stopBatchPoll() {
  if (batchPollInterval) clearInterval(batchPollInterval);
  batchPollInterval = null;
  updateBatchStatus();
}

function updateBatchStatus() {
  chrome.runtime.sendMessage({ type: 'GET_BATCH_STATUS' }, res => {
    if (!res) return;
    document.getElementById('batchTotal').textContent = res.total;
    document.getElementById('batchActive').textContent = res.active;
    document.getElementById('batchDone').textContent = res.done;
    
    const listEl = document.getElementById('batchActiveList');
    if (res.activeTasks.length === 0) {
      listEl.innerHTML = '<div style="color:#a0aec0;text-align:center;padding-top:40px">暂无活动任务</div>';
    } else {
      listEl.innerHTML = res.activeTasks.map(t => `
        <div style="display:flex;justify-content:space-between;border-bottom:1px solid #edf2f7;padding:6px 0">
          <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;width:70%"><a href="${esc(t.url)}" target="_blank">${esc(t.url)}</a></div>
          <div style="color:#3182ce">${t.status}</div>
        </div>
      `).join('');
    }

    if (res.isFinished) {
      document.getElementById('btnStopBatch').style.display = 'none';
      document.getElementById('btnStartBatch').style.display = 'inline-block';
      stopBatchPoll();
      loadAll(); // Reload data when finished
    }
  });
}

