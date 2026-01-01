class WysiwygEditor {
    constructor(options = {}) {
        this.container = null;
        this.toolbar = null;
        this.editorArea = null;
        this.filePath = options.filePath || null;
        this.tabId = options.tabId || null;
        this.groupId = options.groupId || null;
        this.onChange = options.onChange || null;
        this.onSave = options.onSave || null;
        this._isUpdating = false;
        this._lastMarkdown = '';
        this._debounceTimer = null;
    }

    create(parentElement, initialContent = '') {
        this.container = document.createElement('div');
        this.container.className = 'wysiwyg-editor-container';
        this.container.dataset.tabId = this.tabId;
        this.container.dataset.groupId = this.groupId;

        this.toolbar = this._createToolbar();
        this.container.appendChild(this.toolbar);

        this.editorArea = document.createElement('div');
        this.editorArea.className = 'wysiwyg-editor-area markdown-body';
        this.editorArea.contentEditable = 'true';
        this.editorArea.spellcheck = false;
        this.editorArea.dataset.tabId = this.tabId;
        
        this.container.appendChild(this.editorArea);
        parentElement.appendChild(this.container);

        this.setContent(initialContent);
        this._lastMarkdown = initialContent;

        this._bindEvents();

        return this.container;
    }

    _createToolbar() {
        const toolbar = document.createElement('div');
        toolbar.className = 'wysiwyg-toolbar';

        const buttons = [
            { icon: 'B', command: 'bold', title: '加粗 (Ctrl+B)', style: 'font-weight: bold;' },
            { icon: 'I', command: 'italic', title: '斜体 (Ctrl+I)', style: 'font-style: italic;' },
            { icon: 'S', command: 'strikethrough', title: '删除线', style: 'text-decoration: line-through;' },
            { type: 'separator' },
            { icon: 'H1', command: 'h1', title: '标题1', custom: true },
            { icon: 'H2', command: 'h2', title: '标题2', custom: true },
            { icon: 'H3', command: 'h3', title: '标题3', custom: true },
            { type: 'separator' },
            { icon: '•', command: 'insertUnorderedList', title: '无序列表' },
            { icon: '1.', command: 'insertOrderedList', title: '有序列表' },
            { iconSvg: 'task', command: 'taskList', title: '任务列表', custom: true },
            { type: 'separator' },
            { icon: '""', command: 'blockquote', title: '引用', custom: true },
            { icon: '< >', command: 'code', title: '行内代码', custom: true },
            { icon: '```', command: 'codeBlock', title: '代码块', custom: true },
            { type: 'separator' },
            { iconSvg: 'link', command: 'link', title: '链接 (Ctrl+K)', custom: true },
            { iconSvg: 'image', command: 'image', title: '图片', custom: true },
            { icon: '—', command: 'insertHorizontalRule', title: '分割线' },
            { type: 'separator' },
            { iconSvg: 'undo', command: 'undo', title: '撤销 (Ctrl+Z)' },
            { iconSvg: 'redo', command: 'redo', title: '重做 (Ctrl+Y)' },
        ];

        buttons.forEach(btn => {
            if (btn.type === 'separator') {
                const sep = document.createElement('div');
                sep.className = 'wysiwyg-toolbar-separator';
                toolbar.appendChild(sep);
            } else {
                const button = document.createElement('button');
                button.className = 'wysiwyg-toolbar-btn';
                if (btn.iconSvg && window.uiIcons && typeof window.uiIcons.svg === 'function') {
                    button.innerHTML = window.uiIcons.svg(btn.iconSvg);
                } else {
                    button.innerHTML = btn.icon;
                }
                button.title = btn.title;
                if (btn.style) {
                    button.style.cssText = btn.style;
                }
                button.addEventListener('click', (e) => {
                    e.preventDefault();
                    this._executeCommand(btn.command, btn.custom);
                });
                toolbar.appendChild(button);
            }
        });

        return toolbar;
    }

    _executeCommand(command, isCustom = false) {
        this.editorArea.focus();

        if (isCustom) {
            this._executeCustomCommand(command);
        } else {
            document.execCommand(command, false, null);
        }
        
        this._triggerChange();
    }

    _executeCustomCommand(command) {
        switch (command) {
            case 'h1':
            case 'h2':
            case 'h3':
                this._formatHeading(command);
                break;
            case 'blockquote':
                this._formatBlockquote();
                break;
            case 'code':
                this._formatInlineCode();
                break;
            case 'codeBlock':
                this._insertCodeBlock();
                break;
            case 'link':
                this._insertLink();
                break;
            case 'image':
                this._insertImage();
                break;
            case 'taskList':
                this._insertTaskList();
                break;
        }
    }

    _formatHeading(level) {
        const tag = level.toUpperCase();
        document.execCommand('formatBlock', false, tag);
    }

    _formatBlockquote() {
        document.execCommand('formatBlock', false, 'BLOCKQUOTE');
    }

    _formatInlineCode() {
        const selection = window.getSelection();
        if (!selection.rangeCount) return;

        const range = selection.getRangeAt(0);
        const selectedText = range.toString();

        if (selectedText) {
            const code = document.createElement('code');
            code.textContent = selectedText;
            range.deleteContents();
            range.insertNode(code);
            
            range.setStartAfter(code);
            range.setEndAfter(code);
            selection.removeAllRanges();
            selection.addRange(range);
        } else {
            const code = document.createElement('code');
            code.innerHTML = '&nbsp;';
            range.insertNode(code);
            range.selectNodeContents(code);
            selection.removeAllRanges();
            selection.addRange(range);
        }
    }

    _insertCodeBlock() {
        const selection = window.getSelection();
        if (!selection.rangeCount) return;

        const range = selection.getRangeAt(0);
        const selectedText = range.toString() || '// 在此输入代码';

        const pre = document.createElement('pre');
        const code = document.createElement('code');
        code.textContent = selectedText;
        pre.appendChild(code);

        range.deleteContents();
        range.insertNode(pre);

        const p = document.createElement('p');
        p.innerHTML = '<br>';
        pre.parentNode.insertBefore(p, pre.nextSibling);

        range.setStart(code, 0);
        range.setEnd(code, code.childNodes.length);
        selection.removeAllRanges();
        selection.addRange(range);
    }

    _insertLink() {
        const selection = window.getSelection();
        const selectedText = selection.toString() || '链接文本';

        this._openMiniPrompt({
            title: '插入链接',
            fields: [
                { name: 'url', label: '链接地址', placeholder: 'https://', value: 'https://' },
                { name: 'text', label: '链接文本', placeholder: '', value: selectedText },
            ],
            submitText: '插入',
        }).then((result) => {
            if (!result) return;
            const url = (result.url || '').trim();
            const text = (result.text ?? '').toString();
            if (!url) return;
            const safeUrl = this._escapeHtml(url);
            const safeText = this._escapeHtml(text || url);
            document.execCommand('insertHTML', false, `<a href="${safeUrl}">${safeText}</a>`);
            this._triggerChange();
        }).catch(() => { });
    }

    _insertImage() {
        this._openMiniPrompt({
            title: '插入图片',
            fields: [
                { name: 'url', label: '图片地址', placeholder: 'https://', value: 'https://' },
                { name: 'alt', label: '图片描述(可选)', placeholder: '', value: '' },
            ],
            submitText: '插入',
        }).then((result) => {
            if (!result) return;
            const url = (result.url || '').trim();
            const alt = (result.alt ?? '').toString();
            if (!url) return;
            const safeUrl = this._escapeHtml(url);
            const safeAlt = this._escapeHtml(alt);
            document.execCommand('insertHTML', false, `<img src="${safeUrl}" alt="${safeAlt}">`);
            this._triggerChange();
        }).catch(() => { });
    }

    _escapeHtml(input) {
        return String(input)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    _openMiniPrompt(options = {}) {
        const title = options.title || '输入';
        const fields = Array.isArray(options.fields) ? options.fields : [];
        const submitText = options.submitText || '确定';

        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.style.cssText = [
                'position: fixed',
                'inset: 0',
                'background: rgba(0,0,0,0.45)',
                'display: flex',
                'align-items: center',
                'justify-content: center',
                'z-index: 99999',
            ].join(';');

            const dialog = document.createElement('div');
            dialog.style.cssText = [
                'width: min(460px, 86vw)',
                'border-radius: 10px',
                'padding: 14px 14px 12px',
                'background: var(--card-bg, #2d2d30)',
                'color: var(--text-color, #ccc)',
                'border: 1px solid var(--border-color, #3c3c3c)',
                'box-shadow: 0 18px 48px rgba(0,0,0,0.45)',
                'font-size: 13px',
            ].join(';');

            const header = document.createElement('div');
            header.textContent = title;
            header.style.cssText = 'font-weight: 600; font-size: 14px; margin-bottom: 10px;';
            dialog.appendChild(header);

            const form = document.createElement('form');
            form.autocomplete = 'off';
            form.style.cssText = 'display: flex; flex-direction: column; gap: 10px;';

            const inputs = new Map();
            fields.forEach((f, idx) => {
                const row = document.createElement('div');
                row.style.cssText = 'display: flex; flex-direction: column; gap: 6px;';
                const label = document.createElement('div');
                label.textContent = f.label || f.name;
                label.style.cssText = 'opacity: 0.9;';
                const input = document.createElement('input');
                input.type = 'text';
                input.value = f.value ?? '';
                input.placeholder = f.placeholder ?? '';
                input.style.cssText = [
                    'height: 30px',
                    'border-radius: 6px',
                    'border: 1px solid var(--border-color, #464647)',
                    'background: var(--primary-bg, #252526)',
                    'color: inherit',
                    'padding: 0 10px',
                    'outline: none',
                ].join(';');
                row.appendChild(label);
                row.appendChild(input);
                form.appendChild(row);
                inputs.set(f.name, input);
                if (idx === 0) setTimeout(() => { try { input.focus(); input.select(); } catch (_) { } }, 0);
            });

            const actions = document.createElement('div');
            actions.style.cssText = 'display: flex; justify-content: flex-end; gap: 10px; margin-top: 4px;';

            const cancelBtn = document.createElement('button');
            cancelBtn.type = 'button';
            cancelBtn.textContent = '取消';
            cancelBtn.style.cssText = [
                'height: 30px',
                'padding: 0 12px',
                'border-radius: 6px',
                'border: 1px solid var(--border-color, #464647)',
                'background: transparent',
                'color: inherit',
                'cursor: pointer',
            ].join(';');

            const okBtn = document.createElement('button');
            okBtn.type = 'submit';
            okBtn.textContent = submitText;
            okBtn.style.cssText = [
                'height: 30px',
                'padding: 0 12px',
                'border-radius: 6px',
                'border: 1px solid rgba(255,255,255,0.18)',
                'background: rgba(255,255,255,0.08)',
                'color: inherit',
                'cursor: pointer',
            ].join(';');

            actions.appendChild(cancelBtn);
            actions.appendChild(okBtn);
            form.appendChild(actions);
            dialog.appendChild(form);
            overlay.appendChild(dialog);

            const cleanup = (result) => {
                try {
                    document.removeEventListener('keydown', onKeyDown, true);
                    overlay.remove();
                } catch (_) { }
                resolve(result);
            };

            const onKeyDown = (e) => {
                if (e.key === 'Escape') {
                    e.preventDefault();
                    cleanup(null);
                }
            };

            cancelBtn.addEventListener('click', () => cleanup(null));
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) cleanup(null);
            });
            form.addEventListener('submit', (e) => {
                e.preventDefault();
                const result = {};
                for (const [name, input] of inputs.entries()) {
                    result[name] = input.value;
                }
                cleanup(result);
            });

            document.addEventListener('keydown', onKeyDown, true);
            document.body.appendChild(overlay);
        });
    }

    _insertTaskList() {
        const selection = window.getSelection();
        if (!selection.rangeCount) return;

        const range = selection.getRangeAt(0);
        
        const ul = document.createElement('ul');
        ul.className = 'task-list';
        
        const li = document.createElement('li');
        li.className = 'task-list-item';
        
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'task-list-item-checkbox';
        
        li.appendChild(checkbox);
        li.appendChild(document.createTextNode(' 任务项'));
        ul.appendChild(li);
        
        range.deleteContents();
        range.insertNode(ul);
        
        range.setStart(li.lastChild, 1);
        range.setEnd(li.lastChild, li.lastChild.textContent.length);
        selection.removeAllRanges();
        selection.addRange(range);
    }

    _bindEvents() {
        this.editorArea.addEventListener('input', () => {
            this._triggerChange();
        });

        this.editorArea.addEventListener('keydown', (e) => {
            if (e.ctrlKey || e.metaKey) {
                switch (e.key.toLowerCase()) {
                    case 'b':
                        e.preventDefault();
                        this._executeCommand('bold');
                        break;
                    case 'i':
                        e.preventDefault();
                        this._executeCommand('italic');
                        break;
                    case 'k':
                        e.preventDefault();
                        this._executeCommand('link', true);
                        break;
                    case 's':
                        e.preventDefault();
                        if (this.onSave) {
                            this.onSave(this.getMarkdown());
                        }
                        break;
                }
            }

            if (e.key === 'Tab') {
                e.preventDefault();
                document.execCommand('insertText', false, '    ');
            }
        });

        this.editorArea.addEventListener('paste', (e) => {
            e.preventDefault();
            
            let text = e.clipboardData.getData('text/plain');
            
            const html = e.clipboardData.getData('text/html');
            if (html && !text) {
                const temp = document.createElement('div');
                temp.innerHTML = html;
                text = temp.textContent || temp.innerText;
            }
            
            if (text) {
                document.execCommand('insertText', false, text);
            }
        });

        this.editorArea.addEventListener('click', (e) => {
            if (e.target.type === 'checkbox' && e.target.classList.contains('task-list-item-checkbox')) {
                this._triggerChange();
            }
        });
    }

    _triggerChange() {
        if (this._isUpdating) return;

        clearTimeout(this._debounceTimer);
        this._debounceTimer = setTimeout(() => {
            const markdown = this.getMarkdown();
            if (markdown !== this._lastMarkdown) {
                this._lastMarkdown = markdown;
                if (this.onChange) {
                    this.onChange(markdown);
                }
            }
        }, 300);
    }

    setContent(markdown) {
        this._isUpdating = true;
        
        if (window.markdownAPI) {
            this.editorArea.innerHTML = window.markdownAPI.render(markdown, this.filePath);
        } else {
            this.editorArea.textContent = markdown;
        }
        
        this._lastMarkdown = markdown;
        this._isUpdating = false;
    }

    getMarkdown() {
        if (window.turndownAPI) {
            return window.turndownAPI.toMarkdown(this.editorArea.innerHTML);
        }
        return this.editorArea.textContent || '';
    }

    getHtml() {
        return this.editorArea.innerHTML;
    }

    focus() {
        if (this.editorArea) {
            this.editorArea.focus();
        }
    }

    destroy() {
        clearTimeout(this._debounceTimer);
        if (this.container && this.container.parentNode) {
            this.container.parentNode.removeChild(this.container);
        }
        this.container = null;
        this.toolbar = null;
        this.editorArea = null;
    }

    show() {
        if (this.container) {
            this.container.style.display = 'flex';
        }
    }

    hide() {
        if (this.container) {
            this.container.style.display = 'none';
        }
    }
}

window.WysiwygEditor = WysiwygEditor;
