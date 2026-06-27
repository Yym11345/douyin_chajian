(function() {
  // ── 诊断开关：生产版本已关闭，如需调试请改为 true ──
  const DEBUG = false;

  // Hook XMLHttpRequest
  const XHR = XMLHttpRequest.prototype;
  const open = XHR.open;
  const send = XHR.send;

  XHR.open = function(method, url) {
    this._url = url;
    return open.apply(this, arguments);
  };

  XHR.send = function() {
    this.addEventListener('load', function() {
      try {
        let text = null;
        if (!this.responseType || this.responseType === 'text') {
          text = this.responseText;
        } else if (this.responseType === 'json') {
          text = JSON.stringify(this.response);
        }
        if (text) {
          handleResponse(this._url, text, 'XHR');
        }
      } catch (e) {
        // Ignore read errors
      }
    });
    return send.apply(this, arguments);
  };

  // Hook Fetch
  const originalFetch = window.fetch;
  window.fetch = async function(...args) {
    const response = await originalFetch.apply(this, args);
    const clone = response.clone();
    
    clone.text().then(text => {
      let url = args[0];
      if (typeof url === 'object' && url.url) {
        url = url.url;
      }
      handleResponse(url, text, 'Fetch');
    }).catch(e => {});
    
    return response;
  };

  const MAX_RESPONSE_SIZE = 5 * 1024 * 1024; // 5MB

  function handleResponse(url, text, via) {
    if (typeof url !== 'string') return;
    if (text && text.length > MAX_RESPONSE_SIZE) return;

    // ── 诊断日志：打印所有请求 URL（过滤静态资源）──
    if (DEBUG) {
      const isApi = url.includes('douyin.com') || url.includes('tiktok.com') || url.includes('/api/');
      const isStatic = /\.(js|css|png|jpg|gif|woff|woff2|svg|ico|mp4|webm)(\?|$)/.test(url);
      if (isApi && !isStatic) {
        const hasAwemeList = text && text.includes('"aweme_list"');
        const hasProfile = text && text.includes('"sec_uid"') && text.includes('"follower_count"');
        if (hasAwemeList) {
          console.log(`%c[DouyinSkill] ✅ 视频列表命中! via=${via} url=${url.substring(0, 120)}`, 'color:green;font-weight:bold');
        } else if (hasProfile) {
          console.log(`%c[DouyinSkill] 👤 用户资料命中! via=${via} url=${url.substring(0, 120)}`, 'color:blue;font-weight:bold');
        } else {
          console.log(`%c[DouyinSkill] ⬜ API请求: via=${via} size=${text.length} url=${url.substring(0, 120)}`, 'color:#aaa');
        }
      }
    }

    try {
      // 1. Profile Endpoint
      if (url.includes('/aweme/v1/web/user/profile/other/')) {
        try {
          const json = JSON.parse(text);
          const user = json.user || (json.user_module && json.user_module.user);
          if (user && user.sec_uid) {
            console.log(`%c[DouyinSkill] 👤 发送用户资料: ${user.nickname}`, 'color:blue');
            window.postMessage({ type: 'DOUYIN_SKILL_PROFILE', data: json }, 'https://www.douyin.com');
          }
        } catch(e) {}
      }
      
      // 2. Post List — URL 优先匹配，再降级到内容检测（但排除非作品端点）
      const isPostUrl = url.includes('/aweme/v1/web/aweme/post/');
      const isNonPostAwemeList = (
        url.includes('/aweme/favorite/') ||
        url.includes('/aweme/mix/') ||
        url.includes('/aweme/collect/') ||
        url.includes('/aweme/v1/web/aweme/favorite/')
      );
      // 额外校验：真正的视频列表响应必须同时包含 "aweme_id" 字段
      const looksLikeVideoList = text && text.includes('"aweme_list"') && text.includes('"aweme_id"');
      if (isPostUrl || (looksLikeVideoList && !isNonPostAwemeList)) {
        const json = JSON.parse(text);
        if (json && json.aweme_list && Array.isArray(json.aweme_list)) {
          // 再次校验第一个 item 确实是视频对象（有 aweme_id）
          const firstItem = json.aweme_list[0];
          if (firstItem && !firstItem.aweme_id) {
            console.log(`%c[DouyinSkill] ⚠️ aweme_list存在但item无aweme_id，可能是用户列表，跳过`, 'color:orange');
            return;
          }
          console.log(`%c[DouyinSkill] ✅ 发送视频列表: ${json.aweme_list.length} 条`, 'color:green;font-weight:bold');
          window.postMessage({ type: 'DOUYIN_SKILL_POST', data: json }, 'https://www.douyin.com');
          
          if (json.has_more !== undefined) {
            // 只在作品列表端点才发送 HAS_MORE 信号，避免其他端点误触停止
            if (isPostUrl) {
              window.postMessage({ type: 'DOUYIN_SKILL_HAS_MORE', hasMore: !!json.has_more }, 'https://www.douyin.com');
            }
          }
        }
      }
    } catch (e) {
      // Ignored non-json or parse errors
    }
  }
})();
