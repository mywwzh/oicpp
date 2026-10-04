/**
 * 核桃OJ 题面视图。
 *
 * 作为编辑区右侧分组里的一个自定义标签（viewType: 'htoj-problem'），与左侧代码文件
 * 形成「代码 | 题面」分屏。内部提供 题面 / 提交记录 / 自测 三个子页签。
 */
(function () {
    if (typeof window === 'undefined') return;

    const STATUS_TAGS = {
        0: 'AC', 1: 'PE', 2: 'TLE', 3: 'MLE', 4: 'WA', 5: 'RE', 6: 'OLE', 7: 'CE', 8: 'SE', 9: 'SE',
        '-10': 'Judging', 99: '等待中'
    };

    const CPP_TEMPLATE = [
        '#include <bits/stdc++.h>',
        'using namespace std;',
        '',
        'int main() {',
        '    ios::sync_with_stdio(false);',
        '    cin.tie(nullptr);',
        '',
        '    return 0;',
        '}',
        ''
    ].join('\n');

    const PY_TEMPLATE = [
        'import sys',
        '',
        '',
        'def main():',
        '    data = sys.stdin.read().split()',
        '    ',
        '',
        '',
        'if __name__ == "__main__":',
        '    main()',
        ''
    ].join('\n');

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function normalizePath(p) {
        return typeof p === 'string' ? p.replace(/\\/g, '/') : '';
    }

    function statusColor(status) {
        const name = (status && status.name) || '';
        if (/accept|通过|正确/i.test(name)) return '#2ea043';
        if (/wrong|fail|error|exceed|错误|未通过|不通过/i.test(name)) return '#e5534b';
        return '';
    }

    class HtojProblemView {
        constructor() {
            this.containers = new Map();
            this.codeFileByPid = new Map();
            this._zone = null;
        }

        get zone() {
            return this._zone === 'python' ? 'python' : 'cpp';
        }

        async ensureZone() {
            if (this._zone) return this._zone;
            try {
                const cfg = await window.electronAPI.htojGetConfig();
                this._zone = cfg && cfg.zone === 'python' ? 'python' : 'cpp';
            } catch (_) {
                this._zone = 'cpp';
            }
            return this._zone;
        }

        problemKind(detail) {
            const type = detail && detail.problemBaseVO && detail.problemBaseVO.type;
            if (type === 2) return 2;
            if (type === 5) return 5;
            return 1;
        }

        resolveLanguage() {
            return this.zone === 'python' ? 'Python3' : 'C++17 With O2';
        }

        // ================= 打开题目（自动分屏） =================

        async openProblem({ pid, problemId, context }) {
            const numericPid = Number(pid);
            if (!Number.isFinite(numericPid) || numericPid <= 0) return;
            await this.ensureZone();

            let codeFilePath = this.codeFileByPid.get(numericPid) || null;
            if (!codeFilePath) {
                const openFile = await this.findOpenCodeFileByPid(numericPid);
                if (openFile) codeFilePath = openFile.filePath;
            }
            if (!codeFilePath) {
                codeFilePath = await this.pickCodeFile({ pid: numericPid, problemId, context: context || {} });
            }
            if (codeFilePath) this.codeFileByPid.set(numericPid, codeFilePath);

            await window.tabManager.openHtojProblem({
                pid: numericPid,
                problemId,
                context: context || {},
                codeFilePath
            });
        }

        // ================= 代码文件 =================

        async pickCodeFile(desc) {
            const action = await window.dialogManager.showActionDialog(
                '代码文件',
                `为 ${desc.problemId || ('P' + desc.pid)} 准备代码文件`,
                [
                    { id: 'new', label: '新建文件', className: 'dialog-btn-confirm' },
                    { id: 'open', label: '打开已有文件' },
                    { id: 'cancel', label: '暂不打开', className: 'dialog-btn-cancel' }
                ]
            );
            if (!action || action === 'cancel') return null;
            if (action === 'open') {
                const result = await window.electronAPI.showOpenDialog({
                    title: '选择代码文件',
                    properties: ['openFile'],
                    filters: [{ name: 'Code', extensions: ['cpp', 'cc', 'cxx', 'py', 'txt'] }]
                });
                const filePath = result && result.filePaths && result.filePaths[0];
                return filePath || null;
            }
            return this.createCodeFileInteractive(desc);
        }

        async createCodeFileInteractive(desc) {
            const defaultExt = this.zone === 'python' ? '.py' : '.cpp';
            const dir = await this.defaultDirectory();
            const base = this.sanitizeName(desc.problemId || ('P' + desc.pid));
            const defaultPath = dir
                ? await window.electronAPI.pathJoin(dir, base + defaultExt)
                : base + defaultExt;

            const result = await window.electronAPI.showSaveDialog({
                title: '新建代码文件',
                defaultPath,
                filters: [
                    { name: 'C++', extensions: ['cpp', 'cc', 'cxx'] },
                    { name: 'Python', extensions: ['py'] },
                    { name: 'Text', extensions: ['txt'] }
                ]
            });
            const targetPath = result && result.filePath;
            if (!targetPath) return null;

            const lower = targetPath.toLowerCase();
            let ext = defaultExt;
            if (lower.endsWith('.py')) ext = '.py';
            else if (lower.endsWith('.cpp') || lower.endsWith('.cc') || lower.endsWith('.cxx')) ext = '.cpp';

            let content = '';
            if (await window.electronAPI.checkFileExists(targetPath)) {
                content = (await window.electronAPI.readFileContent(targetPath)) || '';
            }
            if (!/@htoj\s+pid=/.test(content)) {
                const header = this.buildHeader(desc, ext);
                content = content.trim() ? `${header}\n${content}` : `${header}\n${this.codeBodyFor(ext)}`;
                await window.electronAPI.createFile(targetPath, content);
            }
            return targetPath;
        }

        async findOpenCodeFileByPid(pid) {
            try {
                const tabManager = window.tabManager;
                const editorMgr = window.editorManager || window.monacoEditorManager;
                if (!tabManager || !tabManager.tabs) return null;
                for (const [, tab] of tabManager.tabs) {
                    if (!tab || tab.viewType !== 'code' || !tab.filePath) continue;
                    if (!/\.(cpp|cc|cxx|py|txt)$/i.test(tab.filePath)) continue;
                    let content = '';
                    const editor = editorMgr && editorMgr.editors && editorMgr.editors.get(tab.tabId);
                    if (editor && typeof editor.getValue === 'function') {
                        content = editor.getValue() || '';
                    } else if (typeof tab.content === 'string') {
                        content = tab.content;
                    }
                    const marker = this.parseMarker(content);
                    if (marker && Number(marker.pid) === Number(pid)) {
                        return { filePath: tab.filePath, content };
                    }
                }
            } catch (_) { }
            return null;
        }

        buildHeader(desc, ext) {
            const context = desc.context || {};
            const prefix = ext === '.py' ? '#' : '//';
            const params = [`pid=${desc.pid}`, `problemId=${desc.problemId || ''}`];
            if (context.cid) params.push(`cid=${context.cid}`);
            if (context.tid) params.push(`tid=${context.tid}`);
            if (context.gid) params.push(`gid=${context.gid}`);
            const linkParams = [`pid=${desc.pid}`];
            if (context.cid) linkParams.push(`cid=${context.cid}`);
            if (context.tid) linkParams.push(`tid=${context.tid}`);
            if (context.gid) linkParams.push(`gid=${context.gid}`);
            return [
                `${prefix} @htoj ${params.join(' ')}`,
                `${prefix} 题目：${desc.problemId || ''}`,
                `${prefix} 链接：https://htoj.com.cn/${this.zone}/oj/problem/detail?${linkParams.join('&')}`,
                ''
            ].join('\n');
        }

        codeBodyFor(ext) {
            return ext === '.py' ? PY_TEMPLATE : CPP_TEMPLATE;
        }

        sanitizeName(name) {
            return String(name || 'solution').replace(/[\\/:*?"<>|]/g, '_').trim().slice(0, 60) || 'solution';
        }

        async defaultDirectory() {
            try {
                const filesPanel = window.sidebarManager && window.sidebarManager.getPanelManager
                    ? window.sidebarManager.getPanelManager('files') : null;
                if (filesPanel && filesPanel.workspacePath) return filesPanel.workspacePath;
            } catch (_) { }
            try {
                return await window.electronAPI.getUserHome();
            } catch (_) { }
            return '';
        }

        async openPathInEditor(filePath) {
            const content = await window.electronAPI.readFileContent(filePath);
            const fileName = filePath.split(/[\\/]/).pop();
            await window.tabManager.openFile(fileName, typeof content === 'string' ? content : '', false, filePath);
            if (window.tabManager.markTabAsSavedByUniqueKey) {
                window.tabManager.markTabAsSavedByUniqueKey(normalizePath(filePath));
            }
        }

        /** 工具栏「代码文件」按钮：切换/新建本题代码文件。 */
        async ensureCodeFile(container) {
            const state = container._htojState;
            let codeFilePath = this.codeFileByPid.get(state.pid) || null;
            if (!codeFilePath) {
                const openFile = await this.findOpenCodeFileByPid(state.pid);
                if (openFile) codeFilePath = openFile.filePath;
            }
            if (!codeFilePath) {
                codeFilePath = await this.pickCodeFile({ pid: state.pid, problemId: state.problemId, context: state.context });
            }
            if (!codeFilePath) return null;
            this.codeFileByPid.set(state.pid, codeFilePath);
            state.codeFilePath = codeFilePath;
            await this.openPathInEditor(codeFilePath);
            return codeFilePath;
        }

        async resolveCode(state) {
            const editor = window.editorManager && window.editorManager.currentEditor;
            const activePath = window.oicppApp && window.oicppApp.getActiveFilePath && window.oicppApp.getActiveFilePath();
            const codeFilePath = state.codeFilePath || this.codeFileByPid.get(state.pid) || null;

            if (editor && activePath && codeFilePath && normalizePath(activePath) === normalizePath(codeFilePath)) {
                try {
                    return { code: editor.getValue() || '', filePath: activePath };
                } catch (_) { }
            }
            if (editor && activePath) {
                try {
                    const content = editor.getValue() || '';
                    const marker = this.parseMarker(content);
                    if (marker && Number(marker.pid) === Number(state.pid)) {
                        return { code: content, filePath: activePath };
                    }
                } catch (_) { }
            }
            if (codeFilePath) {
                try {
                    const content = await window.electronAPI.readFileContent(codeFilePath);
                    if (typeof content === 'string') return { code: content, filePath: codeFilePath };
                } catch (_) { }
            }
            const openFile = await this.findOpenCodeFileByPid(state.pid);
            if (openFile && openFile.content && openFile.content.trim()) {
                return { code: openFile.content, filePath: openFile.filePath };
            }
            return null;
        }

        parseMarker(content) {
            if (!content) return null;
            const head = String(content).split('\n').slice(0, 12).join('\n');
            const match = head.match(/@htoj\s+pid=(\d+)(?:\s+problemId=(\S+))?(?:\s+cid=(\d+))?(?:\s+tid=(\d+))?(?:\s+gid=(\d+))?/);
            if (!match) return null;
            const context = {};
            if (match[3]) context.cid = Number(match[3]);
            if (match[4]) context.tid = Number(match[4]);
            if (match[5]) context.gid = Number(match[5]);
            return { pid: Number(match[1]), problemId: match[2] || '?', context };
        }

        // ================= 容器生命周期 =================

        async createContainer({ groupId, tabId, payload }) {
            const group = window.tabManager && window.tabManager.groups && window.tabManager.groups.get(groupId);
            if (!group || !group.editorArea) return null;
            const container = document.createElement('div');
            container.className = 'htoj-problem-container';
            container.dataset.tabId = tabId;
            container.dataset.groupId = groupId;
            container.style.display = 'none';
            container._htojState = {
                pid: Number(payload && payload.pid),
                problemId: (payload && payload.problemId) || '',
                context: (payload && payload.context) || {},
                detail: null,
                language: this.resolveLanguage(),
                codeFilePath: this.codeFileByPid.get(Number(payload && payload.pid)) || null,
                view: 'statement',
                submissions: [],
                expandedSubmitId: null,
                detailCache: new Map(),
                selftest: { running: false },
                banner: null
            };
            group.editorArea.appendChild(container);
            this.containers.set(tabId, container);
            this.bind(container);
            container.innerHTML = '<div class="htoj-loading">正在加载题面…</div>';
            this.load(container);
            return container;
        }

        ensureContainer({ groupId, tabId, payload, container }) {
            if (container && container.parentElement) {
                if (container.dataset.groupId !== groupId) {
                    const group = window.tabManager && window.tabManager.groups && window.tabManager.groups.get(groupId);
                    if (group && group.editorArea) {
                        group.editorArea.appendChild(container);
                        container.dataset.groupId = groupId;
                    }
                }
                return container;
            }
            this.createContainer({ groupId, tabId, payload });
            return this.containers.get(tabId) || null;
        }

        destroy(tabId) {
            this.containers.delete(tabId);
        }

        async load(container) {
            const state = container._htojState;
            container.innerHTML = '<div class="htoj-loading">正在加载题面…</div>';
            try {
                await this.ensureZone();
                const detail = await window.htojApi.problem.detail(state.pid, state.context);
                state.detail = detail;
                const base = (detail && detail.problemBaseVO) || {};
                state.problemId = base.problemId || state.problemId;
                this.renderShell(container);
                this.loadSubmissions(container);
            } catch (error) {
                container.innerHTML = `<div class="htoj-error">题面加载失败：${escapeHtml(error.message)}</div>`;
            }
        }

        // ================= 渲染 =================

        renderShell(container) {
            const state = container._htojState;
            const detail = state.detail || {};
            const base = detail.problemBaseVO || {};
            const choice = detail.problemChoiceDetailVO || null;
            const kind = this.problemKind(detail);
            const isProgramming = kind === 1;

            const metaHtml = this.buildMetaHtml(state, detail, kind);

            container.innerHTML = `
                <div class="htoj-stmt">
                    <div class="htoj-stmt-bar">
                        <div class="htoj-stmt-title">
                            <span class="htoj-stmt-id">${escapeHtml(base.problemId || state.problemId || '')}</span>
                            <span class="htoj-stmt-name">${escapeHtml(base.title || '')}</span>
                        </div>
                        <div class="htoj-stmt-actions">
                            ${isProgramming ? '<button class="htoj-btn" data-action="code">代码文件</button>' : ''}
                            ${isProgramming
                                ? '<button class="htoj-btn primary" data-action="submit">提交</button>'
                                : '<button class="htoj-btn primary" data-action="submitAnswers">提交答案</button>'}
                            <button class="htoj-iconbtn" data-action="refresh" title="刷新">↻</button>
                            <button class="htoj-iconbtn" data-action="browser" title="在浏览器中打开">↗</button>
                        </div>
                    </div>
                    <div class="htoj-stmt-banner" data-role="banner" style="display:none;"></div>
                    <div class="htoj-stmt-tabs">
                        <button class="htoj-tabbtn active" data-action="view" data-view="statement">题面</button>
                        <button class="htoj-tabbtn" data-action="view" data-view="submissions">提交记录</button>
                        ${isProgramming ? '<button class="htoj-tabbtn" data-action="view" data-view="selftest">自测</button>' : ''}
                    </div>
                    <div class="htoj-stmt-body">
                        <section class="htoj-view active" data-view="statement">
                            <div class="htoj-meta">${metaHtml}</div>
                            <div class="htoj-statement markdown-body" data-role="statement"></div>
                        </section>
                        <section class="htoj-view" data-view="submissions">
                            <div data-role="submissions"></div>
                        </section>
                        ${isProgramming ? `<section class="htoj-view" data-view="selftest">
                            <div class="htoj-field-label">测试输入（可为空，上限 1MB）</div>
                            <textarea class="htoj-selftest-input" placeholder="粘贴测试输入…"></textarea>
                            <div class="htoj-selftest-actions">
                                <button class="htoj-btn primary" data-action="selftest">运行自测</button>
                            </div>
                            <div data-role="selfresult"></div>
                        </section>` : ''}
                    </div>
                </div>
            `;

            const statementEl = container.querySelector('[data-role="statement"]');
            if (statementEl) {
                const parsed = this.extractSamples(base.content || '');
                if (window.markdownAPI) {
                    statementEl.innerHTML = window.markdownAPI.render(parsed.markdown, undefined);
                } else {
                    statementEl.textContent = parsed.markdown;
                }
                this.mountSamples(statementEl, parsed.samples);
            }
            if (choice) this.renderChoice(statementEl, choice);
            if (kind === 5 && statementEl) this.transformObjective(statementEl);

            this.renderSubmissions(container);
            this.renderSelfTest(container);
            this.applyView(container, state.view);
        }

        buildMetaHtml(state, detail, kind) {
            const base = detail.problemBaseVO || {};
            const oj = detail.problemOjDetailVO || {};
            const parts = [];

            const difficulty = base.difficulty;
            if (difficulty && difficulty.name) {
                const color = difficulty.color || '';
                parts.push(`<span class="htoj-pill" style="${color ? `color:${escapeHtml(color)};border-color:${escapeHtml(color)}` : ''}">${escapeHtml(difficulty.name)}</span>`);
            }
            const tags = Array.isArray(base.tags) ? base.tags : [];
            tags.forEach((t) => {
                if (t && t.name) parts.push(`<span class="htoj-pill">${escapeHtml(t.name)}</span>`);
            });

            const total = Number(base.total) || 0;
            const ac = Number(base.ac) || 0;
            const rate = total > 0 ? ((ac / total) * 100).toFixed(1) + '%' : '-';
            let limitText = '';
            if (kind === 1) {
                const ioName = (oj.ioMode && oj.ioMode.name) || '标准IO';
                limitText = `${oj.timeLimit != null ? oj.timeLimit : '-'}ms · ${oj.memoryLimit != null ? oj.memoryLimit : '-'}MB · ${ioName}`;
                if (oj.ioMode && oj.ioMode.id === 2) {
                    limitText += ` · 读 ${oj.ioReadFileName || ''} 写 ${oj.ioWriteFileName || ''}`;
                }
            } else {
                limitText = kind === 2 ? '选择题' : '客观题';
            }

            const ctxTag = state.context.cid ? '比赛题目' : state.context.tid ? '题单题目' : state.context.gid ? '小组题目' : '';
            const accepted = base.accepted ? '<span class="htoj-accepted">✓ 已通过</span>' : '';

            return `
                <div class="htoj-meta-pills">
                    ${accepted}
                    ${parts.join('')}
                    ${ctxTag ? `<span class="htoj-pill htoj-pill-ctx">${ctxTag}</span>` : ''}
                </div>
                <div class="htoj-meta-line">${escapeHtml(limitText)} · 通过率 ${rate}（${ac}/${total}）</div>
            `;
        }

        /**
         * 题面里的样例是 ```input1 / ```output1 代码块。
         * 这里把它们抽出来、在原位放一个锚点，渲染后替换成左右并排的样例卡片。
         */
        extractSamples(markdown) {
            const lines = String(markdown || '').split('\n');
            const out = [];
            const samples = [];
            let pending = null;
            const flush = () => {
                if (pending && pending.items.length) {
                    samples.push(pending.items);
                    out.push('');
                    out.push(`<div class="htoj-samples-anchor" data-samples-index="${samples.length - 1}"></div>`);
                    out.push('');
                }
                pending = null;
            };
            let i = 0;
            while (i < lines.length) {
                const fence = lines[i].match(/^\s*```\s*([A-Za-z0-9_-]+)\s*$/);
                if (fence && /^(input|output)\d+$/i.test(fence[1])) {
                    const lang = fence[1].toLowerCase();
                    const code = [];
                    i += 1;
                    while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
                        code.push(lines[i]);
                        i += 1;
                    }
                    i += 1;
                    if (!pending) pending = { items: [] };
                    pending.items.push({ lang, code: code.join('\n') });
                    continue;
                }
                if (lines[i].trim() !== '') flush();
                out.push(lines[i]);
                i += 1;
            }
            flush();
            return { markdown: out.join('\n'), samples };
        }

        mountSamples(root, samples) {
            if (!root || !samples || !samples.length) return;
            root.querySelectorAll('.htoj-samples-anchor').forEach((anchor) => {
                const items = samples[Number(anchor.dataset.samplesIndex)];
                if (!items) { anchor.remove(); return; }
                const pairs = new Map();
                items.forEach((item) => {
                    const m = item.lang.match(/^(input|output)(\d+)$/);
                    if (!m) return;
                    const num = m[2];
                    if (!pairs.has(num)) pairs.set(num, {});
                    pairs.get(num)[m[1]] = item.code;
                });
                const grid = document.createElement('div');
                grid.className = 'htoj-samples';
                Array.from(pairs.keys()).sort((a, b) => Number(a) - Number(b)).forEach((num) => {
                    const pair = pairs.get(num);
                    const row = document.createElement('div');
                    row.className = 'htoj-sample';
                    row.innerHTML = `
                        <div class="htoj-sample-col">
                            <div class="htoj-sample-label">样例输入 #${escapeHtml(num)}</div>
                            <pre>${escapeHtml(pair.input || '')}</pre>
                        </div>
                        <div class="htoj-sample-col">
                            <div class="htoj-sample-label">样例输出 #${escapeHtml(num)}</div>
                            <pre>${escapeHtml(pair.output || '')}</pre>
                        </div>
                    `;
                    grid.appendChild(row);
                });
                anchor.replaceWith(grid);
            });
        }

        renderChoice(statementEl, choice) {
            if (!statementEl) return;
            const options = Array.isArray(choice.options) ? choice.options : [];
            if (!options.length) return;
            const multi = choice.choiceType === 4;
            const box = document.createElement('div');
            box.className = 'htoj-choice-box';
            options.forEach((opt, index) => {
                const letter = String.fromCharCode(65 + index);
                const label = document.createElement('label');
                label.className = 'htoj-choice-option';
                const input = document.createElement('input');
                input.type = multi ? 'checkbox' : 'radio';
                input.name = 'htoj-choice';
                input.className = 'htoj-choice-input';
                input.value = String(opt.id);
                label.appendChild(input);
                const text = document.createElement('span');
                text.className = 'htoj-choice-text';
                text.innerHTML = `<b>${letter}.</b> ${opt.label != null ? escapeHtml(opt.label) : ''}`;
                if (opt.picUrl) {
                    const img = document.createElement('img');
                    img.className = 'htoj-choice-img';
                    img.src = opt.picUrl;
                    text.appendChild(img);
                }
                label.appendChild(text);
                box.appendChild(label);
            });
            statementEl.appendChild(box);
        }

        transformObjective(root) {
            const regex = /\{\{\s*(input|select|multiselect|textarea)\(\s*(\d+(?:-\d+)?)\s*\)\s*\}\}/g;
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
            const targets = [];
            let node;
            while ((node = walker.nextNode())) {
                const value = node.nodeValue || '';
                if (!value.includes('{{')) continue;
                if (node.parentElement && node.parentElement.closest('pre')) continue;
                regex.lastIndex = 0;
                if (regex.test(value)) targets.push(node);
            }
            targets.forEach((textNode) => {
                const text = textNode.nodeValue || '';
                const parent = textNode.parentElement;
                const frag = document.createDocumentFragment();
                let lastIndex = 0;
                let match;
                regex.lastIndex = 0;
                while ((match = regex.exec(text))) {
                    if (match.index > lastIndex) {
                        frag.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
                    }
                    frag.appendChild(this.buildObjectiveField(match[1], match[2], parent));
                    lastIndex = match.index + match[0].length;
                }
                if (lastIndex < text.length) {
                    frag.appendChild(document.createTextNode(text.slice(lastIndex)));
                }
                if (textNode.parentNode) textNode.parentNode.replaceChild(frag, textNode);
            });
        }

        buildObjectiveField(kind, num, parentEl) {
            const wrap = document.createElement('span');
            wrap.className = 'htoj-obj-field';
            if (kind === 'input') {
                const input = document.createElement('input');
                input.type = 'text';
                input.className = 'htoj-answer htoj-obj-input';
                input.name = String(num);
                wrap.appendChild(input);
                return wrap;
            }
            if (kind === 'textarea') {
                const ta = document.createElement('textarea');
                ta.className = 'htoj-answer htoj-obj-textarea';
                ta.name = String(num);
                wrap.appendChild(ta);
                return wrap;
            }
            const multi = kind === 'multiselect';
            const list = parentEl ? parentEl.nextElementSibling : null;
            const items = (list && list.tagName === 'UL') ? Array.from(list.querySelectorAll(':scope > li')) : [];
            const group = document.createElement('span');
            group.className = 'htoj-obj-options';
            items.forEach((li, index) => {
                const letter = String.fromCharCode(65 + index);
                const label = document.createElement('label');
                label.className = 'htoj-obj-option';
                const input = document.createElement('input');
                input.type = multi ? 'checkbox' : 'radio';
                input.className = 'htoj-answer';
                input.name = String(num);
                input.value = letter;
                label.appendChild(input);
                const span = document.createElement('span');
                span.className = 'htoj-obj-option-text';
                span.innerHTML = li.innerHTML;
                label.appendChild(span);
                group.appendChild(label);
            });
            wrap.appendChild(group);
            if (list && list.tagName === 'UL') list.remove();
            return wrap;
        }

        collectObjectiveAnswers(root) {
            const answers = {};
            if (!root) return answers;
            const fields = Array.from(root.querySelectorAll('.htoj-answer'));
            const groups = new Map();
            fields.forEach((field) => {
                const name = field.name || '';
                if (!groups.has(name)) groups.set(name, []);
                groups.get(name).push(field);
            });
            groups.forEach((els, name) => {
                const first = els[0];
                if (first.type === 'checkbox') {
                    const values = els.filter((e) => e.checked).map((e) => e.value).sort();
                    if (values.length) answers[name] = values.join(',');
                } else if (first.type === 'radio') {
                    const checked = els.find((e) => e.checked);
                    if (checked) answers[name] = checked.value;
                } else {
                    const value = (first.value || '').trim();
                    if (value) answers[name] = value;
                }
            });
            return answers;
        }

        // ================= 子页签 / 事件 =================

        bind(container) {
            container.addEventListener('click', (event) => {
                const target = event.target.closest('[data-action]');
                if (!target) return;
                switch (target.dataset.action) {
                    case 'code': this.ensureCodeFile(container); break;
                    case 'submit': this.submit(container); break;
                    case 'submitAnswers': this.submitAnswers(container); break;
                    case 'refresh': this.load(container); break;
                    case 'browser': this.openInBrowser(container); break;
                    case 'selftest': this.runSelfTest(container); break;
                    case 'view': this.applyView(container, target.dataset.view); break;
                    case 'toggle-submission': this.onToggleSubmission(container, target.dataset.submitId); break;
                }
            });
        }

        applyView(container, view) {
            const state = container._htojState;
            state.view = view || 'statement';
            container.querySelectorAll('.htoj-tabbtn').forEach((btn) => {
                btn.classList.toggle('active', btn.dataset.view === state.view);
            });
            container.querySelectorAll('.htoj-view').forEach((section) => {
                section.classList.toggle('active', section.dataset.view === state.view);
            });
        }

        // ================= 提交 =================

        async submit(container) {
            const state = container._htojState;
            if (!state.detail || this.problemKind(state.detail) !== 1) return;
            let resolved = await this.resolveCode(state);
            if (!resolved) {
                const picked = await this.ensureCodeFile(container);
                if (!picked) {
                    this.toast('请先新建或打开本题代码文件', 'warning');
                    return;
                }
                resolved = await this.resolveCode(state);
            }
            if (!resolved) {
                this.toast('请先打开本题代码文件', 'warning');
                return;
            }
            const bytes = new TextEncoder().encode(resolved.code || '').length;
            if (bytes > 102400) {
                this.toast('代码超过 100KB，请改用自测验证', 'warning');
                return;
            }
            const oj = state.detail.problemOjDetailVO || {};
            const body = {
                id: state.pid,
                ioMode: (oj.ioMode && oj.ioMode.id) || 1,
                language: state.language,
                code: resolved.code,
                ...state.context
            };
            this.setBanner(container, { type: 'loading', text: '正在提交…' });
            try {
                const submitId = await window.htojApi.problem.submit(body);
                this.setBanner(container, { type: 'loading', text: `评测中（提交号 ${submitId}）…` });
                const result = await this.pollSubmission(submitId);
                state.detailCache.set(submitId, result);
                this.showJudgeResult(container, result);
                state.expandedSubmitId = submitId;
                await this.loadSubmissions(container);
                this.applyView(container, 'submissions');
            } catch (error) {
                this.setBanner(container, { type: 'error', text: error.message });
            }
        }

        async submitAnswers(container) {
            const state = container._htojState;
            if (!state.detail) return;
            const kind = this.problemKind(state.detail);
            const statementEl = container.querySelector('[data-role="statement"]');
            let body;
            if (kind === 2) {
                const checked = statementEl ? Array.from(statementEl.querySelectorAll('.htoj-choice-input:checked')) : [];
                if (!checked.length) {
                    this.toast('请先作答', 'warning');
                    return;
                }
                const multi = state.detail.problemChoiceDetailVO && state.detail.problemChoiceDetailVO.choiceType === 4;
                body = { id: state.pid, language: multi ? 'multipleChoice' : 'choice', code: checked.map((c) => c.value).join(','), ...state.context };
            } else {
                const answers = this.collectObjectiveAnswers(statementEl);
                if (!Object.keys(answers).length) {
                    this.toast('请先作答', 'warning');
                    return;
                }
                body = { id: state.pid, language: 'objective', answers, ...state.context };
            }
            this.setBanner(container, { type: 'loading', text: '正在提交答案…' });
            try {
                const submitId = await window.htojApi.problem.submit(body);
                this.setBanner(container, { type: 'loading', text: `评测中（提交号 ${submitId}）…` });
                const result = await this.pollSubmission(submitId);
                state.detailCache.set(submitId, result);
                this.showJudgeResult(container, result);
                state.expandedSubmitId = submitId;
                await this.loadSubmissions(container);
                this.applyView(container, 'submissions');
            } catch (error) {
                this.setBanner(container, { type: 'error', text: error.message });
            }
        }

        async pollSubmission(submitId) {
            const interval = 2000;
            const timeout = 60000;
            const start = Date.now();
            let last = null;
            while (Date.now() - start < timeout) {
                const data = await window.htojApi.problem.submissionDetail(submitId);
                last = data;
                if (data && data.resultCode !== 0) return data;
                await new Promise((resolve) => setTimeout(resolve, interval));
            }
            if (last) return last;
            throw new Error('评测超时，请稍后在提交记录中查看');
        }

        setBanner(container, banner) {
            const el = container.querySelector('[data-role="banner"]');
            if (!el) return;
            if (!banner) {
                el.style.display = 'none';
                el.innerHTML = '';
                return;
            }
            const cls = banner.type === 'error' ? 'error' : banner.type === 'loading' ? 'loading' : 'ok';
            el.style.display = '';
            el.className = `htoj-stmt-banner ${cls}`;
            el.textContent = banner.text;
        }

        showJudgeResult(container, detail) {
            const status = detail.status || {};
            const name = status.name || (detail.resultCode === 1 ? 'Accepted' : '评测未通过');
            const score = detail.score != null ? detail.score : (status.score != null ? status.score : 0);
            const color = statusColor(status) || (detail.resultCode === 1 ? '#2ea043' : '#e5534b');
            this.setBanner(container, { type: 'result', text: `${name} · 得分 ${score}` });
            const el = container.querySelector('[data-role="banner"]');
            if (el) el.style.color = color;
        }

        // ================= 提交记录 =================

        async loadSubmissions(container, options = {}) {
            const state = container._htojState;
            try {
                const data = await window.htojApi.problem.submissionList({
                    pid: state.pid,
                    ...state.context,
                    limit: 20
                });
                state.submissions = (data && data.records) || [];
                if (options.expandSubmitId != null) state.expandedSubmitId = options.expandSubmitId;
                if (state.expandedSubmitId == null && state.submissions[0]) state.expandedSubmitId = state.submissions[0].submitId;
            } catch (_) {
                state.submissions = state.submissions || [];
            }
            this.renderSubmissions(container);
            const expandedId = state.expandedSubmitId;
            if (expandedId != null && !state.detailCache.has(expandedId)) {
                try {
                    const detail = await window.htojApi.problem.submissionDetail(expandedId);
                    state.detailCache.set(expandedId, detail || {});
                } catch (error) {
                    state.detailCache.set(expandedId, { error: error.message });
                }
                this.renderSubmissions(container);
            }
        }

        renderSubmissions(container) {
            const el = container.querySelector('[data-role="submissions"]');
            if (!el) return;
            const state = container._htojState;
            const list = state.submissions || [];
            if (!list.length) {
                el.innerHTML = '<div class="htoj-empty">暂无提交记录</div>';
                return;
            }
            el.innerHTML = list.map((item) => {
                const expanded = item.submitId === state.expandedSubmitId;
                const status = item.status || {};
                const tag = status.shortName || STATUS_TAGS[item.resultCode] || status.name || '';
                const summary = `<div class="htoj-sub ${expanded ? 'open' : ''}" data-action="toggle-submission" data-submit-id="${item.submitId}">
                        <span class="htoj-sub-arrow">▶</span>
                        <span class="htoj-sub-status" style="color:${statusColor(status)}">${escapeHtml(tag)}</span>
                        <span class="htoj-sub-score">${item.score != null ? item.score : 0} 分</span>
                        <span class="htoj-sub-time">${escapeHtml(item.submitTime || '')}</span>
                        <span class="htoj-sub-meta">${escapeHtml(item.language || '')}${item.time != null ? ' · ' + item.time + 'ms' : ''}${item.memory != null ? ' · ' + item.memory + 'KB' : ''}</span>
                    </div>`;
                if (!expanded) return summary;
                return summary + `<div class="htoj-sub-detail">${this.submissionDetailHtml(state, item.submitId)}</div>`;
            }).join('');
        }

        submissionDetailHtml(state, submitId) {
            const cached = state.detailCache.get(submitId);
            if (!cached) return '<div class="htoj-empty">加载中…</div>';
            if (cached.error) return `<div class="htoj-error-inline">${escapeHtml(cached.error)}</div>`;
            const groups = Array.isArray(cached.caseGroups) ? cached.caseGroups : [];
            const answers = Array.isArray(cached.answers) ? cached.answers : [];
            if (answers.length) {
                return `<table class="htoj-table"><thead><tr><th>#</th><th>我的答案</th><th>正确答案</th><th>状态</th><th>得分</th></tr></thead><tbody>${
                    answers.map((a) => `<tr><td>${a.id != null ? a.id : ''}</td><td>${escapeHtml(a.myAnswer || '')}</td><td>${escapeHtml(a.answer || '')}</td><td>${escapeHtml(this.answerStatusText(a.status))}</td><td>${a.myScore != null ? a.myScore : ''}</td></tr>`).join('')
                }</tbody></table>`;
            }
            const rows = [];
            groups.forEach((group) => {
                (group.caseResult || []).forEach((c) => {
                    const s = c.status || {};
                    rows.push(`<tr><td>${c.seq != null ? c.seq : ''}</td><td style="color:${statusColor(s)}">${escapeHtml(s.name || '')}</td><td>${c.score != null ? c.score : ''}</td><td>${c.time != null ? c.time : ''}</td><td>${c.memory != null ? c.memory : ''}</td></tr>`);
                });
            });
            if (!rows.length) return '<div class="htoj-empty">暂无测试点明细</div>';
            return `<table class="htoj-table"><thead><tr><th>#</th><th>状态</th><th>分数</th><th>用时(ms)</th><th>内存(KB)</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
        }

        answerStatusText(status) {
            switch (status) {
                case -1: return '未作答';
                case 1: return '正确';
                case 2: return '错误';
                case 3: return '已作答';
                default: return '';
            }
        }

        async onToggleSubmission(container, rawId) {
            const state = container._htojState;
            const submitId = Number(rawId);
            if (state.expandedSubmitId === submitId) {
                state.expandedSubmitId = null;
                this.renderSubmissions(container);
                return;
            }
            state.expandedSubmitId = submitId;
            this.renderSubmissions(container);
            if (!state.detailCache.has(submitId)) {
                try {
                    const detail = await window.htojApi.problem.submissionDetail(submitId);
                    state.detailCache.set(submitId, detail || {});
                } catch (error) {
                    state.detailCache.set(submitId, { error: error.message });
                }
                this.renderSubmissions(container);
            }
        }

        // ================= 自测 =================

        async runSelfTest(container) {
            const state = container._htojState;
            if (!state.detail) return;
            const inputEl = container.querySelector('.htoj-selftest-input');
            const userInput = inputEl ? inputEl.value : '';
            if (new TextEncoder().encode(userInput).length > 1024 * 1024) {
                this.toast('自测输入超过 1MB', 'warning');
                return;
            }
            let resolved = await this.resolveCode(state);
            if (!resolved) {
                const picked = await this.ensureCodeFile(container);
                if (!picked) {
                    this.toast('请先新建或打开本题代码文件', 'warning');
                    return;
                }
                resolved = await this.resolveCode(state);
            }
            if (!resolved) return;
            const oj = state.detail.problemOjDetailVO || {};
            state.selftest = { running: true };
            this.renderSelfTest(container);
            try {
                const testJudgeKey = await window.htojApi.problem.testSubmit({
                    id: state.pid,
                    ioMode: (oj.ioMode && oj.ioMode.id) || 1,
                    language: state.language,
                    code: resolved.code,
                    userInput,
                    ...state.context
                });
                const result = await this.pollSelfTest(testJudgeKey);
                state.selftest = { running: false, result };
            } catch (error) {
                state.selftest = { running: false, error: error.message };
            }
            this.renderSelfTest(container);
        }

        async pollSelfTest(testJudgeKey) {
            const interval = 2000;
            const timeout = 60000;
            const start = Date.now();
            let last = null;
            while (Date.now() - start < timeout) {
                const data = await window.htojApi.problem.testResult(testJudgeKey);
                last = data;
                if (data && data.resultCode !== 0) return data;
                await new Promise((resolve) => setTimeout(resolve, interval));
            }
            if (last) return last;
            throw new Error('自测超时');
        }

        renderSelfTest(container) {
            const el = container.querySelector('[data-role="selfresult"]');
            if (!el) return;
            const st = (container._htojState.selftest) || {};
            if (st.running) {
                el.innerHTML = '<div class="htoj-empty">自测运行中…</div>';
                return;
            }
            if (st.error) {
                el.innerHTML = `<div class="htoj-error-inline">${escapeHtml(st.error)}</div>`;
                return;
            }
            const result = st.result;
            if (!result) {
                el.innerHTML = '';
                return;
            }
            const statusName = (result.status && result.status.name) || '完成';
            const parts = [`<div class="htoj-st-status" style="color:${statusColor(result.status)}">${escapeHtml(statusName)}</div>`];
            parts.push(`<div class="htoj-st-meta">用时 ${result.time != null ? result.time : '-'}ms · 内存 ${result.memory != null ? result.memory : '-'}KB</div>`);
            if (result.userInput) parts.push(this.codeBlock('输入', result.userInput));
            if (result.userOutput) parts.push(this.codeBlock('输出', result.userOutput));
            if (result.stderr) parts.push(this.codeBlock('错误输出', result.stderr));
            el.innerHTML = parts.join('');
        }

        codeBlock(title, content) {
            return `<div class="htoj-code-block"><div class="htoj-code-title">${escapeHtml(title)}</div><pre>${escapeHtml(content)}</pre></div>`;
        }

        async openInBrowser(container) {
            const state = container._htojState;
            const params = [`pid=${state.pid}`];
            if (state.context.cid) params.push(`cid=${state.context.cid}`);
            if (state.context.tid) params.push(`tid=${state.context.tid}`);
            if (state.context.gid) params.push(`gid=${state.context.gid}`);
            try {
                await window.electronAPI.openExternal(`https://htoj.com.cn/${this.zone}/oj/problem/detail?${params.join('&')}`);
            } catch (_) { }
        }

        toast(message, type) {
            if (window.oicppApp && window.oicppApp.showMessage) {
                window.oicppApp.showMessage(message, type || 'info');
            }
        }
    }

    window.HtojProblemView = HtojProblemView;
    if (!window.htojProblemView) {
        window.htojProblemView = new HtojProblemView();
    }
})();
