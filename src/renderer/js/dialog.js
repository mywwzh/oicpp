class DialogManager {
    constructor() {
        this.currentDialog = null;
        this._keydownHandler = null;
        this.createDialogContainer();
    }

    createDialogContainer() {
        const overlay = document.createElement('div');
        overlay.className = 'dialog-overlay';
        overlay.id = 'dialog-overlay';
        overlay.style.display = 'none';
        overlay.dataset.closeOnBackdrop = '0';

        const dialog = document.createElement('div');
        dialog.className = 'dialog-container';
        dialog.id = 'dialog-container';

        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        overlay.addEventListener('click', (e) => {
            try {
                if (e.target !== overlay) return;
                if (overlay.dataset.closeOnBackdrop !== '1') return;
                this.hideDialog();
            } catch (_) {
            }
        });
    }

    resetDialogState() {
        const overlay = document.getElementById('dialog-overlay');
        const container = document.getElementById('dialog-container');
        if (overlay) {
            overlay.dataset.closeOnBackdrop = '0';
        }
        if (container) {
            container.classList.remove('newyear-container');
        }
    }

    attachEscapeToClose() {
        try {
            if (this._keydownHandler) {
                document.removeEventListener('keydown', this._keydownHandler, true);
                this._keydownHandler = null;
            }
            this._keydownHandler = (e) => {
                try {
                    if (e.key === 'Escape') {
                        e.preventDefault();
                        this.hideDialog();
                    }
                } catch (_) {
                }
            };
            document.addEventListener('keydown', this._keydownHandler, true);
        } catch (_) {
        }
    }

    showInputDialog(title, defaultValue = '', placeholder = '', options = {}) {
        return new Promise((resolve, reject) => {
            this.resetDialogState();
            const overlay = document.getElementById('dialog-overlay');
            const container = document.getElementById('dialog-container');

            container.innerHTML = `
                <div class="dialog-header">
                    <h3>${title}</h3>
                    <button class="dialog-close" onclick="dialogManager.hideDialog()">&times;</button>
                </div>
                <div class="dialog-body">
                    <input type="text" id="dialog-input" placeholder="${placeholder}" value="${defaultValue}" spellcheck="false" autocapitalize="none" autocomplete="off" autocorrect="off" />
                </div>
                <div class="dialog-footer">
                    <button class="dialog-btn dialog-btn-cancel" onclick="dialogManager.hideDialog()">取消</button>
                    <button class="dialog-btn dialog-btn-confirm" onclick="dialogManager.confirmDialog()">确定</button>
                </div>
            `;

            overlay.style.display = 'flex';

            const input = document.getElementById('dialog-input');

            setTimeout(() => {
                if (input) {
                    input.focus();
                    const start = Number.isFinite(options.selectStart) ? options.selectStart : null;
                    const end = Number.isFinite(options.selectEnd) ? options.selectEnd : null;
                    if (start !== null && end !== null && end >= start) {
                        input.setSelectionRange(start, end);
                    } else {
                        input.select();
                    }
                }
            }, 50);

            if (input) {
                input.addEventListener('keydown', (e) => {
                    e.stopPropagation();

                    if (e.key === 'Enter') {
                        e.preventDefault();
                        this.confirmDialog();
                    } else if (e.key === 'Escape') {
                        e.preventDefault();
                        this.hideDialog();
                    }
                });
            }

            overlay.addEventListener('keydown', (e) => {
                e.stopPropagation();
            });

            this.currentDialog = {
                resolve: resolve,
                reject: reject
            };
        });
    }

    showConfirmDialog(title, message) {
        return new Promise((resolve, reject) => {
            this.resetDialogState();
            const overlay = document.getElementById('dialog-overlay');
            const container = document.getElementById('dialog-container');

            container.innerHTML = `
                <div class="dialog-header">
                    <h3>${title}</h3>
                    <button class="dialog-close" onclick="dialogManager.hideDialog()">&times;</button>
                </div>
                <div class="dialog-body">
                    <p>${message}</p>
                </div>
                <div class="dialog-footer">
                    <button class="dialog-btn dialog-btn-cancel" onclick="dialogManager.cancelDialog()">取消</button>
                    <button class="dialog-btn dialog-btn-confirm" onclick="dialogManager.confirmDialog()">确定</button>
                </div>
            `;

            overlay.style.display = 'flex';

            this.currentDialog = {
                resolve: resolve,
                reject: reject
            };
        });
    }

    showActionDialog(title, message, actions = []) {
        return new Promise((resolve, reject) => {
            this.resetDialogState();
            const overlay = document.getElementById('dialog-overlay');
            const container = document.getElementById('dialog-container');

            const buttonsHtml = (actions || []).map((action) => {
                const safeId = this.escapeHtml(String(action.id ?? ''));
                const safeLabel = this.escapeHtml(String(action.label ?? ''));
                const className = action.className ? ` ${this.escapeHtml(action.className)}` : '';
                return `<button class="dialog-btn${className}" data-action="${safeId}" onclick="dialogManager.actionDialog('${safeId}')">${safeLabel}</button>`;
            }).join('');

            container.innerHTML = `
                <div class="dialog-header">
                    <h3>${title}</h3>
                    <button class="dialog-close" onclick="dialogManager.hideDialog()">&times;</button>
                </div>
                <div class="dialog-body">
                    <p>${message}</p>
                </div>
                <div class="dialog-footer">
                    ${buttonsHtml}
                </div>
            `;

            overlay.style.display = 'flex';

            this.currentDialog = {
                resolve: resolve,
                reject: reject
            };
        });
    }

    showNewYearGreeting(now = new Date()) {
        return new Promise((resolve) => {
            this.resetDialogState();

            const overlay = document.getElementById('dialog-overlay');
            const container = document.getElementById('dialog-container');
            if (!overlay || !container) {
                resolve(false);
                return;
            }

            const isTestDate = (now instanceof Date) && (now.getMonth() === 11) && (now.getDate() === 21);
            const displayYear = isTestDate ? (now.getFullYear() + 1) : now.getFullYear();

            overlay.dataset.closeOnBackdrop = '1';
            container.classList.add('newyear-container');

            const safeYear = this.escapeHtml(String(displayYear));
            container.innerHTML = `
                <div class="dialog-header newyear-header">
                    <h3>新年快乐</h3>
                    <button class="dialog-close" onclick="dialogManager.hideDialog()" aria-label="关闭">&times;</button>
                </div>
                <div class="newyear-body">
                    <div class="newyear-hero">
                        <div class="newyear-badge" aria-hidden="true" data-ui-icon="sparkle"></div>
                        <div>
                            <p class="newyear-title">欢迎来到 ${safeYear}</p>
                            <div class="newyear-subtitle">愿你：灵感常在，思路清晰，提交一次就 AC。</div>
                        </div>
                    </div>
                    <div class="newyear-wishes">
                        <p>新的一年，继续把热爱写进每一行代码。</p>
                        <p class="muted">提示：点击空白处或按 Esc 也可关闭。</p>
                    </div>
                </div>
                <div class="newyear-footer">
                    <button class="dialog-btn dialog-btn-primary" onclick="dialogManager.confirmDialog()">开启新一年</button>
                </div>
            `;

            if (window.uiIcons && typeof window.uiIcons.hydrate === 'function') {
                window.uiIcons.hydrate(container);
            }

            overlay.style.display = 'flex';
            this.attachEscapeToClose();

            this.currentDialog = {
                resolve: resolve,
                reject: () => {}
            };
        });
    }

    showSpringFestivalGreeting(now = new Date()) {
        return new Promise((resolve) => {
            this.resetDialogState();

            const overlay = document.getElementById('dialog-overlay');
            const container = document.getElementById('dialog-container');
            if (!overlay || !container) {
                resolve(false);
                return;
            }

            const displayYear = (now instanceof Date) ? now.getFullYear() : new Date().getFullYear();
            const safeYear = this.escapeHtml(String(displayYear));

            overlay.dataset.closeOnBackdrop = '1';
            container.classList.add('newyear-container');

            container.innerHTML = `
                <div class="dialog-header newyear-header">
                    <h3>春节快乐</h3>
                    <button class="dialog-close" onclick="dialogManager.hideDialog()" aria-label="关闭">&times;</button>
                </div>
                <div class="newyear-body">
                    <div class="newyear-hero">
                        <div class="newyear-badge" aria-hidden="true" data-ui-icon="sparkle"></div>
                        <div>
                            <p class="newyear-title">${safeYear}，恭喜发财</p>
                            <div class="newyear-subtitle">愿你：思路清晰，调试顺利，提交一次就 AC。</div>
                        </div>
                    </div>
                    <div class="newyear-wishes">
                        <p>新春快乐，写题愉快。</p>
                        <p class="muted">提示：点击空白处或按 Esc 也可关闭。</p>
                    </div>
                </div>
                <div class="newyear-footer">
                    <button class="dialog-btn dialog-btn-primary" onclick="dialogManager.confirmDialog()">开工！</button>
                </div>
            `;

            if (window.uiIcons && typeof window.uiIcons.hydrate === 'function') {
                window.uiIcons.hydrate(container);
            }

            overlay.style.display = 'flex';
            this.attachEscapeToClose();

            this.currentDialog = {
                resolve: resolve,
                reject: () => {}
            };
        });
    }

    confirmDialog() {
        if (!this.currentDialog) return;

        const input = document.getElementById('dialog-input');
        const result = input ? input.value : true;

        this.currentDialog.resolve(result);
        this.hideDialog();
    }

    cancelDialog() {
        if (!this.currentDialog) return;

        this.currentDialog.resolve(null);
        this.hideDialog();
    }

    actionDialog(actionId) {
        if (!this.currentDialog) return;
        this.currentDialog.resolve(actionId);
        this.hideDialog();
    }

    hideDialog() {
        const overlay = document.getElementById('dialog-overlay');
        const pending = this.currentDialog;
        this.currentDialog = null;
        try {
            if (pending && typeof pending.resolve === 'function') {
                pending.resolve(null);
            }
        } catch (_) {
        }
        overlay.style.display = 'none';
        this.resetDialogState();
        try {
            if (this._keydownHandler) {
                document.removeEventListener('keydown', this._keydownHandler, true);
                this._keydownHandler = null;
            }
        } catch (_) {
        }
    }

    showGotoLineDialog() {
        return this.showInputDialog('跳转到行号', '1', '请输入行号');
    }

    showNewFileDialog(errorMessage = '', defaultName = 'untitled.cpp') {
        const title = errorMessage ? '新建文件 - 错误' : '新建文件';
        const placeholder = errorMessage ? `错误: ${errorMessage}\n请输入文件名（如：main.cpp, test.py, data.txt）` : '请输入文件名（如：main.cpp, test.py, data.txt）';
        const initial = defaultName && typeof defaultName === 'string' ? defaultName : 'untitled.cpp';
        return this.showInputDialog(title, initial, placeholder);
    }

    showNewFolderDialog() {
        return this.showInputDialog('新建文件夹', 'new-folder', '请输入文件夹名');
    }

    showError(message) {
        this.resetDialogState();
        try { logError('[DialogShowError]', { message: String(message) }); } catch (_) { }
        const overlay = document.getElementById('dialog-overlay');
        const container = document.getElementById('dialog-container');
        container.innerHTML = `
            <div class="dialog-header" style="background:#b00020;color:#fff;">
                <h3>错误</h3>
                <button class="dialog-close" onclick="dialogManager.hideDialog()" style="color:#fff">&times;</button>
            </div>
            <div class="dialog-body">
                <p style="white-space:pre-wrap;color:#b00020;background:#fff3f3;border:1px solid #f5c2c7;padding:8px;border-radius:4px;">${this.escapeHtml(String(message))}</p>
            </div>
            <div class="dialog-footer">
                <button class="dialog-btn dialog-btn-confirm" onclick="dialogManager.hideDialog()">确定</button>
            </div>
        `;
        overlay.style.display = 'flex';
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

let dialogManager;
document.addEventListener('DOMContentLoaded', () => {
    dialogManager = new DialogManager();
    if (typeof window !== 'undefined') {
        window.dialogManager = dialogManager;
    }

});
