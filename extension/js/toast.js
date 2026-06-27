/**
 * 抖音数据看板 - Toast 通知系统
 * 轻量级通知组件，替代 alert/confirm
 */
(function() {
  if (window.DouyinSkill && window.DouyinSkill.toast) return;
  
  const DS = window.DouyinSkill = window.DouyinSkill || {};
  
  // 创建样式
  if (!document.getElementById('douyin-toast-styles')) {
    const style = document.createElement('style');
    style.id = 'douyin-toast-styles';
    style.textContent = `
      .douyin-toast-container {
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 99999;
        display: flex;
        flex-direction: column;
        gap: 10px;
        pointer-events: none;
      }
      .douyin-toast {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 14px 20px;
        border-radius: 10px;
        font-size: 14px;
        font-weight: 500;
        box-shadow: 0 8px 30px rgba(0,0,0,0.15);
        animation: douyin-toast-in 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        pointer-events: auto;
        max-width: 380px;
        background: #fff;
        border-left: 4px solid #3182ce;
      }
      .douyin-toast.toast-success { border-left-color: #38a169; background: linear-gradient(135deg, #f0fff4, #fff); }
      .douyin-toast.toast-error { border-left-color: #dc2626; background: linear-gradient(135deg, #fef2f2, #fff); }
      .douyin-toast.toast-warning { border-left-color: #d97706; background: linear-gradient(135deg, #fffbeb, #fff); }
      .douyin-toast.toast-info { border-left-color: #3182ce; background: linear-gradient(135deg, #eff6ff, #fff); }
      .douyin-toast-icon { font-size: 20px; flex-shrink: 0; }
      .douyin-toast-message { flex: 1; color: #1a1a2e; line-height: 1.4; }
      .douyin-toast-close {
        background: none;
        border: none;
        font-size: 18px;
        cursor: pointer;
        color: #a0aec0;
        padding: 0;
        margin-left: 8px;
        transition: color 0.2s;
      }
      .douyin-toast-close:hover { color: #4a5568; }
      .douyin-toast-progress {
        position: absolute;
        bottom: 0;
        left: 0;
        height: 3px;
        border-radius: 0 0 10px 10px;
        transition: width linear;
      }
      .douyin-toast.toast-success .douyin-toast-progress { background: #38a169; }
      .douyin-toast.toast-error .douyin-toast-progress { background: #dc2626; }
      .douyin-toast.toast-warning .douyin-toast-progress { background: #d97706; }
      .douyin-toast.toast-info .douyin-toast-progress { background: #3182ce; }
      @keyframes douyin-toast-in {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
      }
      @keyframes douyin-toast-out {
        from { transform: translateX(0); opacity: 1; }
        to { transform: translateX(100%); opacity: 0; }
      }
      /* Confirm Dialog Styles */
      .douyin-confirm-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0,0,0,0.5);
        z-index: 99998;
        display: flex;
        align-items: center;
        justify-content: center;
        animation: douyin-fade-in 0.2s ease;
      }
      @keyframes douyin-fade-in {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      .douyin-confirm-dialog {
        background: #fff;
        border-radius: 14px;
        padding: 24px;
        max-width: 400px;
        width: 90%;
        box-shadow: 0 20px 60px rgba(0,0,0,0.2);
        animation: douyin-scale-in 0.25s cubic-bezier(0.16, 1, 0.3, 1);
      }
      @keyframes douyin-scale-in {
        from { transform: scale(0.9); opacity: 0; }
        to { transform: scale(1); opacity: 1; }
      }
      .douyin-confirm-icon { font-size: 48px; text-align: center; margin-bottom: 16px; }
      .douyin-confirm-title { font-size: 18px; font-weight: 700; text-align: center; margin-bottom: 8px; color: #1a1a2e; }
      .douyin-confirm-message { font-size: 14px; color: #4a5568; text-align: center; line-height: 1.6; margin-bottom: 20px; white-space: pre-line; }
      .douyin-confirm-prompt { display: none; margin-bottom: 16px; }
      .douyin-confirm-prompt label { display: block; font-size: 13px; color: #718096; margin-bottom: 6px; }
      .douyin-confirm-prompt input {
        width: 100%;
        padding: 10px 14px;
        border: 2px solid #e2e8f0;
        border-radius: 8px;
        font-size: 14px;
        outline: none;
        transition: border-color 0.2s;
        box-sizing: border-box;
      }
      .douyin-confirm-prompt input:focus { border-color: #3182ce; }
      .douyin-confirm-buttons { display: flex; gap: 12px; justify-content: center; }
      .douyin-confirm-btn {
        padding: 10px 24px;
        border-radius: 8px;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        border: none;
        transition: all 0.2s;
      }
      .douyin-confirm-btn-cancel {
        background: #e2e8f0;
        color: #4a5568;
      }
      .douyin-confirm-btn-cancel:hover { background: #cbd5e0; }
      .douyin-confirm-btn-confirm {
        background: #dc2626;
        color: #fff;
      }
      .douyin-confirm-btn-confirm:hover { background: #b91c1c; }
      .douyin-confirm-btn-confirm.primary { background: #3182ce; }
      .douyin-confirm-btn-confirm.primary:hover { background: #2c5aa0; }
      .douyin-confirm-btn-confirm:disabled { opacity: 0.5; cursor: not-allowed; }
    `;
    document.head.appendChild(style);
  }

  // 创建容器
  let container = document.querySelector('.douyin-toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'douyin-toast-container';
    document.body.appendChild(container);
  }

  /**
   * 显示 Toast 通知
   * @param {string} message - 消息内容
   * @param {string} type - 类型: success, error, warning, info
   * @param {number} duration - 显示时长(ms)，默认 4000
   */
  function showToast(message, type = 'info', duration = 4000) {
    const icons = {
      success: '✓',
      error: '✕',
      warning: '⚠',
      info: 'ℹ'
    };

    const toast = document.createElement('div');
    toast.className = `douyin-toast toast-${type}`;
    toast.innerHTML = `
      <span class="douyin-toast-icon">${icons[type] || icons.info}</span>
      <span class="douyin-toast-message">${escapeHtml(message)}</span>
      <button class="douyin-toast-close" aria-label="关闭">×</button>
      <div class="douyin-toast-progress" style="width: 100%"></div>
    `;

    const progress = toast.querySelector('.douyin-toast-progress');
    progress.style.transitionDuration = duration + 'ms';
    requestAnimationFrame(() => {
      progress.style.width = '0%';
    });

    const closeBtn = toast.querySelector('.douyin-toast-close');
    const close = () => {
      toast.style.animation = 'douyin-toast-out 0.3s ease forwards';
      setTimeout(() => toast.remove(), 300);
    };

    closeBtn.addEventListener('click', close);
    if (duration > 0) {
      setTimeout(close, duration);
    }

    container.appendChild(toast);
    return toast;
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Toast 快捷方法
   */
  DS.toast = showToast;
  DS.toastSuccess = (msg, duration) => showToast(msg, 'success', duration);
  DS.toastError = (msg, duration) => showToast(msg, 'error', duration);
  DS.toastWarning = (msg, duration) => showToast(msg, 'warning', duration);
  DS.toastInfo = (msg, duration) => showToast(msg, 'info', duration);

  /**
   * Confirm 对话框
   * @param {object} options - 配置
   * @param {string} options.icon - 图标 emoji
   * @param {string} options.title - 标题
   * @param {string} options.message - 消息内容
   * @param {boolean} options.showPrompt - 是否显示输入框
   * @param {string} options.promptPlaceholder - 输入框占位符
   * @param {string} options.promptRequired - 输入框必填值
   * @param {string} options.confirmText - 确认按钮文本
   * @param {string} options.cancelText - 取消按钮文本
   * @param {string} options.type - confirm 类型: danger, primary
   * @returns {Promise<boolean|string>} 用户选择或输入值
   */
  DS.toastConfirm = function(options) {
    return new Promise((resolve) => {
      const {
        icon = '⚠',
        title = '确认操作',
        message = '',
        showPrompt = false,
        promptPlaceholder = '',
        promptRequired = null,
        confirmText = '确认',
        cancelText = '取消',
        type = 'danger'
      } = options;

      const overlay = document.createElement('div');
      overlay.className = 'douyin-confirm-overlay';

      const dialog = document.createElement('div');
      dialog.className = 'douyin-confirm-dialog';

      const promptHtml = showPrompt ? `
        <div class="douyin-confirm-prompt" style="display:block">
          <label>请输入 <strong>${escapeHtml(promptRequired || '')}</strong> 确认：</label>
          <input type="text" id="confirmPromptInput" placeholder="${escapeHtml(promptPlaceholder)}" autocomplete="off">
        </div>
      ` : '';

      dialog.innerHTML = `
        <div class="douyin-confirm-icon">${icon}</div>
        <div class="douyin-confirm-title">${escapeHtml(title)}</div>
        <div class="douyin-confirm-message">${escapeHtml(message)}</div>
        ${promptHtml}
        <div class="douyin-confirm-buttons">
          <button class="douyin-confirm-btn douyin-confirm-btn-cancel">${escapeHtml(cancelText)}</button>
          <button class="douyin-confirm-btn douyin-confirm-btn-confirm ${type === 'primary' ? 'primary' : ''}" disabled>${escapeHtml(confirmText)}</button>
        </div>
      `;

      overlay.appendChild(dialog);
      document.body.appendChild(overlay);

      const cancelBtn = dialog.querySelector('.douyin-confirm-btn-cancel');
      const confirmBtn = dialog.querySelector('.douyin-confirm-btn-confirm');

      const close = (result) => {
        overlay.style.animation = 'douyin-fade-in 0.2s ease reverse';
        setTimeout(() => {
          overlay.remove();
          resolve(result);
        }, 200);
      };

      cancelBtn.addEventListener('click', () => close(false));

      if (showPrompt) {
        const promptInput = dialog.querySelector('#confirmPromptInput');
        promptInput.focus();

        const checkPrompt = () => {
          if (promptRequired) {
            confirmBtn.disabled = promptInput.value.trim() !== promptRequired;
          } else {
            confirmBtn.disabled = !promptInput.value.trim();
          }
        };

        promptInput.addEventListener('input', checkPrompt);
        promptInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && !confirmBtn.disabled) {
            close(promptInput.value.trim());
          }
          if (e.key === 'Escape') close(false);
        });
      }

      confirmBtn.addEventListener('click', () => {
        if (showPrompt) {
          const val = dialog.querySelector('#confirmPromptInput').value.trim();
          if (promptRequired && val !== promptRequired) {
            DS.toastError('输入不正确，操作已取消');
            return;
          }
          close(val || true);
        } else {
          close(true);
        }
      });

      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) close(false);
      });
    });
  };

  console.log('[DouyinSkill] Toast notification system initialized');
})();