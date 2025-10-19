class SubmitManager {
    constructor() {
        this.init();
    }

    init() {
        logInfo('SubmitManager initialized.');
        this.renderSubmitForm();
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
            if (cookies && cookies.__client_id && cookies._uid) {
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
            if (cookies && cookies.__client_id && cookies._uid) {
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

            submitStatus.textContent = '正在向洛谷提交...';
            submitStatus.style.color = 'orange';

            try {
                const submitData = {
                    lang: parseInt(language, 10),
                    code: codeContent.replace(/\n/g, '\n'), // 替换换行符
                    enableO2: enableO2
                };
                logInfo('向洛谷提交数据:', submitData);

                const result = await window.electronAPI.submitCodeToLuogu(
                    problemId,
                    submitData,
                    this.luoguCookies
                );

                if (result.success) {
                    submitStatus.textContent = '洛谷提交成功！';
                    submitStatus.style.color = 'green';
                } else {
                    submitStatus.textContent = `洛谷提交失败: ${result.error || '未知错误'}`;
                    submitStatus.style.color = 'red';
                }
            } catch (error) {
                logError('洛谷提交过程中发生错误:', error);
                submitStatus.textContent = `洛谷提交过程中发生错误: ${error.message || error}`;
                submitStatus.style.color = 'red';
            }
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