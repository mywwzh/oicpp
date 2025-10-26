class SubmitManager {
    constructor() {
        this.luoguCookies = null;
        this.captchaId = null;
        this.pendingSubmitData = null;
        this.init();
    }

    init() {
        logInfo('SubmitManager initialized.');
        this.renderSubmitForm();
        this.setupCaptchaModal();
        window.electronAPI.on('request-luogu-captcha', () => this.handleCaptchaRequest());
    }

    setupCaptchaModal() {
        this.captchaModalOverlay = document.getElementById('captcha-modal-overlay');
        this.captchaImage = document.getElementById('captcha-image');
        this.captchaInput = document.getElementById('captcha-input');
        this.captchaSubmitBtn = document.getElementById('captcha-submit-btn');
        this.captchaCancelBtn = document.getElementById('captcha-cancel-btn');
        this.captchaCloseBtn = document.getElementById('captcha-close-btn');

        this.captchaSubmitBtn.addEventListener('click', () => this.submitCaptcha());
        this.captchaCancelBtn.addEventListener('click', () => this.hideCaptchaModal());
        this.captchaCloseBtn.addEventListener('click', () => this.hideCaptchaModal());
        this.captchaInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                this.submitCaptcha();
            }
        });
    }

    async handleCaptchaRequest() {
        logInfo('收到验证码请求');
        this.showCaptchaModal();
    }

    async showCaptchaModal() {
        this.captchaInput.value = '';
        this.captchaModalOverlay.classList.add('visible');
        this.captchaInput.focus();

        try {
            const result = await window.electronAPI.getLuoguCaptcha();
            if (result.success) {
                this.captchaImage.src = result.image;
                this.captchaId = result.captchaId;
                logInfo('获取验证码成功，captchaId:', this.captchaId);
            } else {
                logError('获取验证码失败:', result.error);
                alert(`获取验证码失败: ${result.error}`);
                this.hideCaptchaModal();
            }
        } catch (error) {
            logError('获取验证码时发生错误:', error);
            alert(`获取验证码时发生错误: ${error.message}`);
            this.hideCaptchaModal();
        }
    }

    hideCaptchaModal() {
        this.captchaModalOverlay.classList.remove('visible');
        this.captchaId = null;
        this.pendingSubmitData = null;
    }

    async submitCaptcha() {
        const captcha = this.captchaInput.value.trim();
        if (!captcha) {
            alert('请输入验证码');
            return;
        }

        this.hideCaptchaModal();

        if (this.pendingSubmitData) {
            logInfo('重新提交代码，带上验证码');
            const { problemId, submitData, cookies } = this.pendingSubmitData;
            // Clear pending data to avoid re-submission loops
            this.pendingSubmitData = null;
            await this.submitCodeToLuogu(problemId, submitData, cookies, captcha, this.captchaId);
        } else {
            logWarn('没有待处理的提交数据，无法提交验证码。');
        }
    }

    renderSubmitForm() {
        const submitPanel = document.getElementById('submit-panel');
        if (!submitPanel) {
            logError('Submit panel not found.');
            return;
        }

        submitPanel.innerHTML = `
            <div class="panel-header">
                <span class="panel-title">提交代码</span>
            </div>
            <div class="submit-content">
                <div class="form-group">
                    <label for="oj-select">选择 OJ:</label>
                    <select id="oj-select">
                        <option value="none">请选择</option>
                        <option value="luogu">洛谷</option>
                        <!-- 其他 OJ 选项 -->
                    </select>
                </div>
                <div class="form-group">
                    <label for="problem-id">题目 ID:</label>
                    <input type="text" id="problem-id" placeholder="请输入题目 ID">
                </div>
                <div class="form-group">
                    <label for="language">语言:</label>
                    <select id="language">
                        <option value="28">C++ 14(GCC9)</option>
                        <option value="3">C++ 98</option>
                        <option value="4">C++ 11</option>
                        <option value="11">C++ 14</option>
                        <option value="12">C++ 17</option>
                        <option value="27">C++ 20</option>
                        <option value="34">C++ 23</option>
                    </select>
                </div>
                <div class="form-group">
                    <label class="setting-checkbox">
                        <input type="checkbox" id="enable-o2">
                        <span class="setting-label">启用 O2 优化</span>
                    </label>
                </div>
                <div class="form-group">
                    <label for="code-file">选择代码文件:</label>
                    <input type="file" id="code-file" accept=".cpp,.c,.java,.py">
                </div>
                <button id="submit-btn">提交</button>
                <div id="submit-status"></div>
            </div>
        `;

        document.getElementById('submit-btn').addEventListener('click', () => this.handleSubmit());
        document.getElementById('oj-select').addEventListener('change', () => this.handleOjChange());

        this.luoguLoginStatusDiv = document.createElement('div');
        this.luoguLoginStatusDiv.id = 'luogu-login-status';
        this.luoguLoginStatusDiv.style.marginTop = '10px';
        this.luoguLoginStatusDiv.style.textAlign = 'center';
        this.luoguLoginStatusDiv.style.color = 'red';
        document.querySelector('.submit-content').insertBefore(this.luoguLoginStatusDiv, document.getElementById('submit-btn'));

        this.checkLuoguLogin();
    }

    async handleOjChange() {
        const ojSelect = document.getElementById('oj-select');
        if (ojSelect.value === 'luogu') {
            await this.checkLuoguLogin();
        } else {
            this.luoguLoginStatusDiv.innerHTML = '';
        }
    }

    async checkLuoguLogin() {
        this.luoguLoginStatusDiv.innerHTML = '正在检查洛谷登录状态...';
        this.luoguLoginStatusDiv.style.color = 'orange';

        try {
            const cookies = await window.electronAPI.getLuoguCookies();
            if (cookies && cookies.__client_id && cookies._uid && cookies.C3VK) {
                this.luoguCookies = cookies;
                this.luoguLoginStatusDiv.innerHTML = '洛谷已登录。';
                this.luoguLoginStatusDiv.style.color = 'green';
            } else {
                this.luoguCookies = null;
                this.luoguLoginStatusDiv.innerHTML = `
                    未登录洛谷。
                    <button id="login-luogu-btn" style="margin-left: 10px; padding: 5px 10px; cursor: pointer;">登录洛谷</button>
                `;
                this.luoguLoginStatusDiv.style.color = 'red';
                document.getElementById('login-luogu-btn').addEventListener('click', () => this.loginToLuogu());
            }
        } catch (error) {
            logError('获取洛谷 Cookies 失败:', error);
            this.luoguLoginStatusDiv.innerHTML = '检查洛谷登录状态失败。';
            this.luoguLoginStatusDiv.style.color = 'red';
        }
    }

    async loginToLuogu() {
        this.luoguLoginStatusDiv.innerHTML = '正在打开浏览器进行洛谷登录...';
        this.luoguLoginStatusDiv.style.color = 'orange';

        try {
            const cookies = await window.electronAPI.openLuoguLoginWindow();
            if (cookies && cookies.__client_id && cookies._uid && cookies.C3VK) {
                this.luoguCookies = cookies;
                await window.electronAPI.setLuoguCookies(cookies);
                this.luoguLoginStatusDiv.innerHTML = '洛谷登录成功！';
                this.luoguLoginStatusDiv.style.color = 'green';
            } else {
                this.luoguLoginStatusDiv.innerHTML = '洛谷登录失败或取消。';
                this.luoguLoginStatusDiv.style.color = 'red';
            }
        } catch (error) {
            logError('洛谷登录失败:', error);
            this.luoguLoginStatusDiv.innerHTML = '洛谷登录过程中发生错误。';
            this.luoguLoginStatusDiv.style.color = 'red';
        }
    }

    async submitCodeToLuogu(problemId, submitData, cookies, captcha = null, captchaId = null) {
        const submitStatus = document.getElementById('submit-status');
        submitStatus.textContent = '正在向洛谷提交...';
        submitStatus.style.color = 'orange';

        try {
            const result = await window.electronAPI.submitCodeToLuogu(
                problemId,
                submitData,
                cookies,
                captcha,
                captchaId
            );

            if (result.success) {
                submitStatus.textContent = '洛谷提交成功！';
                submitStatus.style.color = 'green';
                if (result.rid) {
                    this.fetchAndDisplayLuoguRecord(result.rid);
                }
            } else if (result.captchaRequired) {
                logInfo('洛谷提交需要验证码，请求用户输入。');
                this.pendingSubmitData = { problemId, submitData, cookies };
                this.handleCaptchaRequest();
            } else {
                submitStatus.textContent = `洛谷提交失败: ${result.error || '未知错误'}`;
                submitStatus.style.color = 'red';
            }
        } catch (error) {
            logError('洛谷提交过程中发生错误:', error);
            submitStatus.textContent = `洛谷提交过程中发生错误: ${error.message || error}`;
            submitStatus.style.color = 'red';
        }
    }

    async handleSubmit() {
        const ojSelect = document.getElementById('oj-select');
        const selectedOj = ojSelect.value;
        const problemId = document.getElementById('problem-id').value;
        const language = document.getElementById('language').value;
        const enableO2 = document.getElementById('enable-o2').checked ? 1 : 0;
        const submitStatus = document.getElementById('submit-status');

        if (!problemId) {
            submitStatus.textContent = '请填写题目 ID。';
            submitStatus.style.color = 'red';
            return;
        }

        // 获取当前编辑器中的代码
        let codeContent = '';
        if (window.editorManager && window.editorManager.currentEditor) {
            codeContent = window.editorManager.currentEditor.getValue();
        } else {
            submitStatus.textContent = '无法获取编辑器中的代码，请确保已打开文件。';
            submitStatus.style.color = 'red';
            return;
        }

        if (!codeContent.trim()) {
            submitStatus.textContent = '提交代码不能为空。';
            submitStatus.style.color = 'red';
            return;
        }

        if (selectedOj === 'luogu') {
            if (!this.luoguCookies || !this.luoguCookies.__client_id || !this.luoguCookies._uid || !this.luoguCookies.C3VK) {
                submitStatus.textContent = '请先登录洛谷并确保获取到所有 Cookies (C3VK)。';
                submitStatus.style.color = 'red';
                return;
            }

            const submitData = {
                lang: parseInt(language, 10),
                code: codeContent.replace(/\r\n/g, '\n'), // 替换换行符
                enableO2: enableO2
            };
            logInfo('向洛谷提交数据:', submitData);
            await this.submitCodeToLuogu(problemId, submitData, this.luoguCookies);

        } else if (selectedOj === 'none') {
            submitStatus.textContent = '请选择一个 OJ。';
            submitStatus.style.color = 'red';
        } else {
            logInfo(`正在向 ${selectedOj} 提交题目 ID: ${problemId}, 语言: ${language}, O2: ${enableO2}`);
            submitStatus.textContent = `正在向 ${selectedOj} 提交...`;
            submitStatus.style.color = 'orange';
            setTimeout(() => {
                const success = Math.random() > 0.5;
                if (success) {
                    submitStatus.textContent = `${selectedOj} 提交成功！`;
                    submitStatus.style.color = 'green';
                } else {
                    submitStatus.textContent = `${selectedOj} 提交失败，请重试。`;
                    submitStatus.style.color = 'red';
                }
            }, 2000);
        }
    }

    async fetchAndDisplayLuoguRecord(rid) {
        const submitStatus = document.getElementById('submit-status');
        submitStatus.textContent = `正在抓取洛谷评测记录 #${rid}...`;
        submitStatus.style.color = 'blue';

        try {
            const recordUrl = `https://www.luogu.com.cn/record/${rid}`;
            const response = await window.electronAPI.fetchLuoguRecord(recordUrl); 
            
            if (response.success && response.html) {
                const parser = new DOMParser();
                const doc = parser.parseFromString(response.html, 'text/html');
                const testCaseWraps = doc.querySelectorAll('.test-case-wrap');
                
                let displayHtml = '';
                testCaseWraps.forEach(wrap => {
                    displayHtml += wrap.outerHTML;
                });

                if (displayHtml) {
                    submitStatus.innerHTML = `洛谷评测记录 #${rid} 结果：<br>${displayHtml}`;
                    submitStatus.style.color = 'black'; 
                } else {
                    submitStatus.textContent = `未能从评测记录 #${rid} 中提取到测试点信息。`;
                    submitStatus.style.color = 'red';
                }
            } else {
                submitStatus.textContent = `抓取洛谷评测记录 #${rid} 失败: ${response.error || '未知错误'}`;
                submitStatus.style.color = 'red';
            }
        } catch (error) {
            logError('抓取洛谷评测记录时发生错误:', error);
            submitStatus.textContent = `抓取洛谷评测记录 #${rid} 过程中发生错误: ${error.message || error}`;
            submitStatus.style.color = 'red';
        }
    }

    activate() {
        logInfo('SubmitManager activated.');
        const ojSelect = document.getElementById('oj-select');
        if (ojSelect.value === 'luogu') {
            this.checkLuoguLogin();
        }
    }
}

if (typeof window !== 'undefined') {
    window.SubmitManager = SubmitManager;
}