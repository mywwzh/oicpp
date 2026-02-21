class LuoguPanel {
    constructor() {
        this.isLoggedIn = false;
        this.user = null;
        this.currentRecord = null;
        this.recordPollInterval = null;
        this.captchaBase64 = null;
    }

    activate() {
        logInfo('[LuoguPanel] 激活面板');
        this.checkLoginStatus();
    }

    async checkLoginStatus() {
        if (!window.electronAPI?.luoguCheckLogin) {
            this.renderNotSupported();
            return;
        }

        this.renderLoading();
        
        try {
            const result = await window.electronAPI.luoguCheckLogin();
            if (result.loggedIn) {
                this.isLoggedIn = true;
                this.user = result.user;
                this.renderLoggedIn();
            } else {
                this.isLoggedIn = false;
                this.user = null;
                this.renderLoginForm();
            }
        } catch (e) {
            logError('[LuoguPanel] 检查登录状态失败:', e);
            this.isLoggedIn = false;
            this.renderLoginForm();
        }
    }

    renderLoading() {
        const container = document.getElementById('luogu-content');
        if (!container) return;
        
        container.innerHTML = `
            <div class="luogu-loading">
                <div class="luogu-loading-spinner"></div>
                <span>加载中...</span>
            </div>
        `;
    }

    renderNotSupported() {
        const container = document.getElementById('luogu-content');
        if (!container) return;
        
        container.innerHTML = `
            <div class="luogu-empty-state">
                <div class="luogu-empty-icon">⚠️</div>
                <div class="luogu-empty-text">洛谷功能不可用</div>
            </div>
        `;
    }

    renderLoginForm() {
        const container = document.getElementById('luogu-content');
        if (!container) return;
        
        container.innerHTML = `
            <div class="luogu-panel">
                <div class="luogu-login-section">
                    <div class="luogu-form-title">登录洛谷</div>
                    <div class="luogu-login-form" id="luogu-login-form">
                        <div class="luogu-form-group">
                            <label class="luogu-form-label">用户名 / 手机号</label>
                            <input type="text" class="luogu-form-input" id="luogu-username" placeholder="输入用户名或手机号">
                        </div>
                        <div class="luogu-form-group">
                            <label class="luogu-form-label">密码</label>
                            <input type="password" class="luogu-form-input" id="luogu-password" placeholder="输入密码">
                        </div>
                        <div class="luogu-form-group">
                            <label class="luogu-form-label">验证码</label>
                            <div class="luogu-captcha-row">
                                <input type="text" class="luogu-form-input luogu-captcha-input" id="luogu-captcha" placeholder="输入验证码">
                                <img class="luogu-captcha-image" id="luogu-captcha-img" title="点击刷新验证码">
                                <button class="luogu-captcha-refresh" id="luogu-captcha-refresh" title="刷新验证码">
                                    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                                        <path d="M13.65 2.35a8 8 0 0 0-11.3 0 8 8 0 0 0 0 11.3 8 8 0 0 0 11.3 0 8 8 0 0 0 0-11.3zm-1.41 9.9a6 6 0 0 1-8.48 0 6 6 0 0 1 0-8.48 6 6 0 0 1 8.48 0 6 6 0 0 1 0 8.48z"/>
                                    </svg>
                                </button>
                            </div>
                        </div>
                        <div id="luogu-login-error" style="display: none;"></div>
                        <button class="luogu-login-btn" id="luogu-login-btn">登录</button>
                    </div>
                </div>
            </div>
        `;

        this.bindLoginEvents();
        this.refreshCaptcha();
    }

    bindLoginEvents() {
        const loginBtn = document.getElementById('luogu-login-btn');
        const captchaImg = document.getElementById('luogu-captcha-img');
        const captchaRefresh = document.getElementById('luogu-captcha-refresh');

        if (loginBtn) {
            loginBtn.addEventListener('click', () => this.handleLogin());
        }

        if (captchaImg) {
            captchaImg.addEventListener('click', () => this.refreshCaptcha());
        }

        if (captchaRefresh) {
            captchaRefresh.addEventListener('click', () => this.refreshCaptcha());
        }

        const passwordInput = document.getElementById('luogu-password');
        if (passwordInput) {
            passwordInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') this.handleLogin();
            });
        }

        const captchaInput = document.getElementById('luogu-captcha');
        if (captchaInput) {
            captchaInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') this.handleLogin();
            });
        }
    }

    async refreshCaptcha() {
        try {
            const result = await window.electronAPI.luoguGetCaptcha();
            if (result.success) {
                this.captchaBase64 = result.captcha;
                const img = document.getElementById('luogu-captcha-img');
                if (img) {
                    img.src = `data:image/png;base64,${result.captcha}`;
                }
            }
        } catch (e) {
            logError('[LuoguPanel] 获取验证码失败:', e);
        }
    }

    async handleLogin() {
        const username = document.getElementById('luogu-username')?.value?.trim();
        const password = document.getElementById('luogu-password')?.value;
        const captcha = document.getElementById('luogu-captcha')?.value?.trim();
        const errorDiv = document.getElementById('luogu-login-error');
        const loginBtn = document.getElementById('luogu-login-btn');

        if (!username || !password || !captcha) {
            if (errorDiv) {
                errorDiv.style.display = 'block';
                errorDiv.className = 'luogu-error-message';
                errorDiv.textContent = '请填写所有字段';
            }
            return;
        }

        if (loginBtn) {
            loginBtn.disabled = true;
            loginBtn.textContent = '登录中...';
        }

        try {
            const result = await window.electronAPI.luoguLogin(username, password, captcha);
            
            if (result.success) {
                if (result.locked) {
                    this.render2FAForm();
                } else {
                    this.isLoggedIn = true;
                    await this.checkLoginStatus();
                }
            } else {
                if (errorDiv) {
                    errorDiv.style.display = 'block';
                    errorDiv.className = 'luogu-error-message';
                    errorDiv.textContent = result.errorMessage || '登录失败';
                }
                await this.refreshCaptcha();
            }
        } catch (e) {
            if (errorDiv) {
                errorDiv.style.display = 'block';
                errorDiv.className = 'luogu-error-message';
                errorDiv.textContent = e.message || '登录失败';
            }
        } finally {
            if (loginBtn) {
                loginBtn.disabled = false;
                loginBtn.textContent = '登录';
            }
        }
    }

    render2FAForm() {
        const container = document.getElementById('luogu-content');
        if (!container) return;

        container.innerHTML = `
            <div class="luogu-panel">
                <div class="luogu-2fa-section">
                    <div class="luogu-2fa-title">两步验证</div>
                    <div class="luogu-2fa-hint">请输入验证器应用中的代码或邮箱验证码</div>
                    <div class="luogu-form-group">
                        <input type="text" class="luogu-form-input" id="luogu-2fa-code" placeholder="输入验证码" maxlength="6">
                    </div>
                    <div id="luogu-2fa-error" style="display: none;"></div>
                    <button class="luogu-login-btn" id="luogu-2fa-btn">验证</button>
                </div>
            </div>
        `;

        const btn = document.getElementById('luogu-2fa-btn');
        const input = document.getElementById('luogu-2fa-code');

        if (btn) {
            btn.addEventListener('click', () => this.handle2FA());
        }
        if (input) {
            input.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') this.handle2FA();
            });
        }
    }

    async handle2FA() {
        const code = document.getElementById('luogu-2fa-code')?.value?.trim();
        const errorDiv = document.getElementById('luogu-2fa-error');
        const btn = document.getElementById('luogu-2fa-btn');

        if (!code) {
            if (errorDiv) {
                errorDiv.style.display = 'block';
                errorDiv.className = 'luogu-error-message';
                errorDiv.textContent = '请输入验证码';
            }
            return;
        }

        if (btn) {
            btn.disabled = true;
            btn.textContent = '验证中...';
        }

        try {
            const result = await window.electronAPI.luoguUnlock2FA(code);
            if (result.success) {
                this.isLoggedIn = true;
                await this.checkLoginStatus();
            } else {
                if (errorDiv) {
                    errorDiv.style.display = 'block';
                    errorDiv.className = 'luogu-error-message';
                    errorDiv.textContent = result.errorMessage || '验证失败';
                }
            }
        } catch (e) {
            if (errorDiv) {
                errorDiv.style.display = 'block';
                errorDiv.className = 'luogu-error-message';
                errorDiv.textContent = e.message || '验证失败';
            }
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.textContent = '验证';
            }
        }
    }

    renderLoggedIn() {
        const container = document.getElementById('luogu-content');
        if (!container) return;

        const userColor = this.getUserColor(this.user?.color);
        const ccfBadge = this.user?.ccfLevel ? this.getCCFBadge(this.user.ccfLevel) : '';

        container.innerHTML = `
            <div class="luogu-panel">
                <div class="luogu-user-section">
                    <div class="luogu-user-info">
                        <div class="luogu-user-avatar" style="background: ${userColor}">
                            ${this.user?.name?.charAt(0)?.toUpperCase() || '?'}
                        </div>
                        <div class="luogu-user-details">
                            <div class="luogu-username">${this.escapeHtml(this.user?.name || '未知用户')} ${ccfBadge}</div>
                            <div class="luogu-user-meta">
                                ${this.user?.rating ? `Rating: ${this.user.rating}` : ''}
                                ${this.user?.ranking ? ` | 排名: #${this.user.ranking}` : ''}
                            </div>
                        </div>
                        <button class="luogu-logout-btn" id="luogu-logout-btn">退出</button>
                    </div>
                </div>

                <div class="luogu-submit-section">
                    <div class="luogu-section-title">提交代码</div>
                    <div class="luogu-submit-form">
                        <div class="luogu-pid-row">
                            <input type="text" class="luogu-form-input luogu-pid-input" id="luogu-pid" placeholder="题目编号 (如 P1001)">
                        </div>
                        <select class="luogu-language-select" id="luogu-language">
                            <option value="11">C++14</option>
                            <option value="12">C++17</option>
                            <option value="27">C++20</option>
                            <option value="28" selected>C++14 (GCC 9)</option>
                            <option value="34">C++23</option>
                            <option value="7">Python 3</option>
                            <option value="25">PyPy 3</option>
                            <option value="8">Java 8</option>
                            <option value="33">Java 21</option>
                        </select>
                        <div class="luogu-checkbox-row">
                            <input type="checkbox" class="luogu-checkbox" id="luogu-o2" checked>
                            <label class="luogu-checkbox-label" for="luogu-o2">开启 O2 优化</label>
                        </div>
                        <button class="luogu-submit-btn" id="luogu-submit-btn">
                            <svg width="14" height="14" viewBox="0 0 14 14">
                                <path d="M4 2l8 5-8 5V2z" fill="currentColor"/>
                            </svg>
                            提交当前文件
                        </button>
                    </div>
                </div>

                <div class="luogu-records-section">
                    <div class="luogu-records-header">
                        <span class="luogu-section-title">评测记录</span>
                        <button class="luogu-refresh-btn" id="luogu-refresh-records" title="刷新">
                            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                                <path d="M13.65 2.35a8 8 0 0 0-11.3 0 8 8 0 0 0 0 11.3 8 8 0 0 0 11.3 0 8 8 0 0 0 0-11.3zm-1.41 9.9a6 6 0 0 1-8.48 0 6 6 0 0 1 0-8.48 6 6 0 0 1 8.48 0 6 6 0 0 1 0 8.48z"/>
                            </svg>
                        </button>
                    </div>
                    <div class="luogu-records-list" id="luogu-records-list">
                        <div class="luogu-loading">
                            <div class="luogu-loading-spinner"></div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        this.bindLoggedInEvents();
        this.loadRecords();
    }

    bindLoggedInEvents() {
        const logoutBtn = document.getElementById('luogu-logout-btn');
        const submitBtn = document.getElementById('luogu-submit-btn');
        const refreshBtn = document.getElementById('luogu-refresh-records');

        if (logoutBtn) {
            logoutBtn.addEventListener('click', () => this.handleLogout());
        }

        if (submitBtn) {
            submitBtn.addEventListener('click', () => this.handleSubmit());
        }

        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => this.loadRecords());
        }
    }

    async handleLogout() {
        try {
            await window.electronAPI.luoguLogout();
            this.isLoggedIn = false;
            this.user = null;
            this.renderLoginForm();
        } catch (e) {
            logError('[LuoguPanel] 退出登录失败:', e);
        }
    }

    async handleSubmit() {
        const pidInput = document.getElementById('luogu-pid');
        const langSelect = document.getElementById('luogu-language');
        const o2Checkbox = document.getElementById('luogu-o2');
        const submitBtn = document.getElementById('luogu-submit-btn');

        const pid = pidInput?.value?.trim();
        if (!pid) {
            if (window.oicppApp?.showMessage) {
                window.oicppApp.showMessage('请输入题目编号', 'warning');
            }
            return;
        }

        const code = window.editorManager?.currentEditor?.getValue?.();
        if (!code) {
            if (window.oicppApp?.showMessage) {
                window.oicppApp.showMessage('请先打开一个文件', 'warning');
            }
            return;
        }

        const languageId = parseInt(langSelect?.value || '28');
        const enableO2 = o2Checkbox?.checked ?? true;

        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerHTML = `
                <div class="luogu-loading-spinner" style="width: 12px; height: 12px; margin-right: 4px;"></div>
                提交中...
            `;
        }

        try {
            const result = await window.electronAPI.luoguSubmit(pid, code, languageId, enableO2, null);
            
            if (result.success) {
                if (window.oicppApp?.showMessage) {
                    window.oicppApp.showMessage('提交成功！', 'success');
                }
                await this.loadRecords();
                if (result.rid) {
                    this.pollRecordStatus(result.rid);
                }
            } else if (result.needCaptcha) {
                if (window.oicppApp?.showMessage) {
                    window.oicppApp.showMessage('需要验证码，请稍后重试', 'warning');
                }
            } else {
                if (window.oicppApp?.showMessage) {
                    window.oicppApp.showMessage(result.errorMessage || '提交失败', 'error');
                }
            }
        } catch (e) {
            if (window.oicppApp?.showMessage) {
                window.oicppApp.showMessage(e.message || '提交失败', 'error');
            }
        } finally {
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerHTML = `
                    <svg width="14" height="14" viewBox="0 0 14 14">
                        <path d="M4 2l8 5-8 5V2z" fill="currentColor"/>
                    </svg>
                    提交当前文件
                `;
            }
        }
    }

    async loadRecords() {
        const listContainer = document.getElementById('luogu-records-list');
        if (!listContainer) return;

        listContainer.innerHTML = `
            <div class="luogu-loading">
                <div class="luogu-loading-spinner"></div>
            </div>
        `;

        try {
            const result = await window.electronAPI.luoguGetRecords();
            
            if (result.success && result.records?.length > 0) {
                listContainer.innerHTML = result.records.map(record => `
                    <div class="luogu-record-item" data-rid="${record.id}">
                        <div class="luogu-record-header">
                            <span class="luogu-record-pid">${this.escapeHtml(record.problem?.pid || 'Unknown')}</span>
                            <span class="luogu-record-status ${this.getStatusClass(record.status)}">${record.statusShort}</span>
                        </div>
                        <div class="luogu-record-meta">
                            <span>${this.formatTime(record.submitTime)}</span>
                        </div>
                    </div>
                `).join('');

                listContainer.querySelectorAll('.luogu-record-item').forEach(item => {
                    item.addEventListener('click', () => {
                        const rid = item.dataset.rid;
                        if (rid) this.showRecordDetail(parseInt(rid));
                    });
                });
            } else {
                listContainer.innerHTML = `
                    <div class="luogu-empty-state">
                        <div class="luogu-empty-icon">📝</div>
                        <div class="luogu-empty-text">暂无评测记录</div>
                    </div>
                `;
            }
        } catch (e) {
            logError('[LuoguPanel] 加载记录失败:', e);
            listContainer.innerHTML = `
                <div class="luogu-empty-state">
                    <div class="luogu-empty-icon">❌</div>
                    <div class="luogu-empty-text">加载失败</div>
                </div>
            `;
        }
    }

    async showRecordDetail(rid) {
        try {
            const result = await window.electronAPI.luoguGetRecord(rid);
            
            if (result.success) {
                this.currentRecord = result.record;
                this.renderRecordDetail(result.record);
            }
        } catch (e) {
            logError('[LuoguPanel] 获取记录详情失败:', e);
        }
    }

    renderRecordDetail(record) {
        let detailHtml = `
            <div class="luogu-record-detail" id="luogu-record-detail">
                <div class="luogu-detail-header">
                    <span class="luogu-detail-title">R${record.id} 详情</span>
                    <button class="luogu-detail-close" id="luogu-detail-close">✕</button>
                </div>
                <div class="luogu-detail-info">
                    <div class="luogu-detail-item">
                        <span class="luogu-detail-label">状态</span>
                        <span class="luogu-detail-value" style="color: ${record.statusColor}">${record.statusText}</span>
                    </div>
                    <div class="luogu-detail-item">
                        <span class="luogu-detail-label">分数</span>
                        <span class="luogu-detail-value">${record.score ?? '-'}</span>
                    </div>
                    <div class="luogu-detail-item">
                        <span class="luogu-detail-label">时间</span>
                        <span class="luogu-detail-value">${record.time ? record.time + ' ms' : '-'}</span>
                    </div>
                    <div class="luogu-detail-item">
                        <span class="luogu-detail-label">内存</span>
                        <span class="luogu-detail-value">${record.memory ? this.formatMemory(record.memory) : '-'}</span>
                    </div>
                    <div class="luogu-detail-item">
                        <span class="luogu-detail-label">语言</span>
                        <span class="luogu-detail-value">${record.language}${record.enableO2 ? ' O2' : ''}</span>
                    </div>
                    <div class="luogu-detail-item">
                        <span class="luogu-detail-label">题目</span>
                        <span class="luogu-detail-value">${record.problem?.pid || '-'}</span>
                    </div>
                </div>
        `;

        if (record.detail && record.detail.length > 0) {
            detailHtml += `
                <div class="luogu-test-cases">
                    ${record.detail.map((tc, i) => `
                        <div class="luogu-test-case">
                            <span class="luogu-test-case-num">#${i + 1}</span>
                            <span class="luogu-test-case-status" style="color: ${this.getTestCaseColor(tc.status)}">${this.getTestCaseStatus(tc.status)}</span>
                            <span class="luogu-test-case-info">${tc.time ? tc.time + 'ms' : ''} ${tc.memory ? this.formatMemory(tc.memory) : ''}</span>
                        </div>
                    `).join('')}
                </div>
            `;
        }

        detailHtml += '</div>';

        const existingDetail = document.getElementById('luogu-record-detail');
        if (existingDetail) {
            existingDetail.remove();
        }

        const recordsList = document.getElementById('luogu-records-list');
        if (recordsList) {
            recordsList.insertAdjacentHTML('afterend', detailHtml);
        }

        const closeBtn = document.getElementById('luogu-detail-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                const detail = document.getElementById('luogu-record-detail');
                if (detail) detail.remove();
            });
        }
    }

    async pollRecordStatus(rid) {
        if (this.recordPollInterval) {
            clearInterval(this.recordPollInterval);
        }

        const poll = async () => {
            try {
                const result = await window.electronAPI.luoguGetRecord(rid);
                if (result.success) {
                    const status = result.record.status;
                    if (status !== 0 && status !== 1) {
                        clearInterval(this.recordPollInterval);
                        this.recordPollInterval = null;
                        await this.loadRecords();
                        this.showRecordDetail(rid);
                    }
                }
            } catch (e) {
                logError('[LuoguPanel] 轮询记录状态失败:', e);
            }
        };

        this.recordPollInterval = setInterval(poll, 2000);
        setTimeout(() => {
            if (this.recordPollInterval) {
                clearInterval(this.recordPollInterval);
                this.recordPollInterval = null;
            }
        }, 60000);
    }

    getUserColor(colorName) {
        const colors = {
            'Gray': '#bfbfbf',
            'Blue': '#3498db',
            'Green': '#52c41a',
            'Orange': '#f39c11',
            'Red': '#fe4c61',
            'Purple': '#9d3dcf',
            'Cheater': '#ad8b00'
        };
        return colors[colorName] || colors['Gray'];
    }

    getCCFBadge(level) {
        if (!level || level < 3) return '';
        const colors = {
            3: '#52c41a',
            4: '#52c41a',
            5: '#52c41a',
            6: '#3498db',
            7: '#3498db',
            8: '#ffc116'
        };
        const color = colors[level] || '#ffc116';
        return `<span style="color: ${color}; font-size: 10px;">CCF Lv.${level}</span>`;
    }

    getStatusClass(status) {
        const map = {
            12: 'ac',
            6: 'wa',
            5: 'tle',
            4: 'mle',
            7: 're',
            2: 'ce',
            1: 'judging',
            0: 'waiting'
        };
        return map[status] || '';
    }

    getTestCaseColor(status) {
        return status === 12 ? '#52c41a' : '#fb6340';
    }

    getTestCaseStatus(status) {
        const map = {
            12: 'AC',
            6: 'WA',
            5: 'TLE',
            4: 'MLE',
            7: 'RE',
            2: 'CE'
        };
        return map[status] || '??';
    }

    formatTime(timestamp) {
        if (!timestamp) return '-';
        const date = new Date(timestamp * 1000);
        return date.toLocaleString('zh-CN', {
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    formatMemory(kb) {
        if (kb < 1024) return kb + ' KB';
        return (kb / 1024).toFixed(2) + ' MB';
    }

    escapeHtml(text) {
        if (!text) return '';
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
}

if (typeof window !== 'undefined') {
    window.LuoguPanel = LuoguPanel;
}
