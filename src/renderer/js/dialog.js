class DialogManager {
    constructor() {
        this.currentDialog = null;
        this.createDialogContainer();
    }

    createDialogContainer() {
        const overlay = document.createElement('div');
        overlay.className = 'dialog-overlay';
        overlay.id = 'dialog-overlay';
        overlay.style.display = 'none';

        const dialog = document.createElement('div');
        dialog.className = 'dialog-container';
        dialog.id = 'dialog-container';

        overlay.appendChild(dialog);
        document.body.appendChild(overlay);
    }

    showInputDialog(title, defaultValue = '', placeholder = '') {
        return new Promise((resolve, reject) => {
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
                    input.select();
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

    hideDialog() {
        const overlay = document.getElementById('dialog-overlay');
        overlay.style.display = 'none';
        this.currentDialog = null;
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
