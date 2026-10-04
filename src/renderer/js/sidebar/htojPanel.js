/**
 * 核桃OJ 侧边栏面板。
 *
 * 结构：顶部账户栏（用户 / 分区 / 刷新） + 工具栏（题目页为搜索框与题单·比赛入口，
 * 二级页为返回与标题） + 列表区。题目为主视图，题单 / 比赛为二级页。
 */
(function () {
    if (typeof window === 'undefined') return;

    const PAGE_SIZE = 20;
    const PAGE_META = {
        problems: { title: '题目' },
        trainings: { title: '题单' },
        contests: { title: '比赛' },
        contest: { title: '比赛详情' }
    };

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function fmtDuration(ms) {
        if (!Number.isFinite(ms) || ms <= 0) return '';
        const sec = Math.floor(ms / 1000);
        const day = Math.floor(sec / 86400);
        const hour = Math.floor((sec % 86400) / 3600);
        const minute = Math.floor((sec % 3600) / 60);
        if (day > 0) return `${day}天${hour}时`;
        if (hour > 0) return `${hour}时${minute}分`;
        return `${minute}分`;
    }

    function fmtCountdown(ms) {
        if (!Number.isFinite(ms) || ms <= 0) return '00:00';
        const total = Math.floor(ms / 1000);
        const day = Math.floor(total / 86400);
        const hour = Math.floor((total % 86400) / 3600);
        const minute = Math.floor((total % 3600) / 60);
        const second = total % 60;
        const pad = (n) => String(n).padStart(2, '0');
        if (day > 0) return `${day}天${pad(hour)}时`;
        if (hour > 0) return `${pad(hour)}:${pad(minute)}:${pad(second)}`;
        return `${pad(minute)}:${pad(second)}`;
    }

    function acStatusClass(acStatus) {
        if (acStatus == null) return 'none';
        let id = acStatus;
        let name = '';
        if (typeof acStatus === 'object') {
            id = acStatus.id;
            name = acStatus.name || acStatus.shortName || acStatus.chineseName || '';
        }
        if (name) {
            if (/已通过|accept/i.test(name)) return 'passed';
            if (/未提交|未作答|untried|not submit/i.test(name)) return 'untried';
            if (/未通过|wrong|error|exceed|fail|答案错误/i.test(name)) return 'failed';
        }
        const n = Number(id);
        if (n === 4) return 'passed';
        if (n === 3) return 'failed';
        if (n === 2) return 'untried';
        return 'none';
    }

    function contestState(record) {
        if (record.status === -1) return { cls: 'pending', text: '未开始' };
        if (record.status === 1) return { cls: 'ended', text: '已结束' };
        return { cls: 'running', text: '进行中' };
    }

    // get-contest-info 不含可靠的 registered 字段，需结合列表项与 registerState 判断。
    function isContestRegistered(info, record) {
        if (info && typeof info.registered === 'boolean') return info.registered;
        if (record && typeof record.registered === 'boolean') return record.registered;
        const rs = info && info.registerState;
        if (rs === 3 || rs === 2) return true;
        return isContestStarted(info, record);
    }

    function isContestStarted(info, record) {
        if (info && info.started === true) return true;
        if (record && record.started === true) return true;
        return false;
    }

    class HtojPanel {
        constructor() {
            this.rootEl = null;
            this.listEl = null;
            this.user = null;
            this.zone = 'cpp';
            this.loggedIn = false;
            this.page = 'problems';
            this.contextMenu = null;
            this.countdownTimer = null;
            this.countdownEl = null;
            this._searchTimer = null;
            this.state = {
                problems: { page: 0, hasMore: true, items: [], keyword: '', loading: false },
                trainings: { page: 0, hasMore: true, items: [], loading: false, expanded: new Set(), children: new Map() },
                contests: { page: 0, hasMore: true, items: [], loading: false }
            };
            this.contestDetail = null;
            this.countdown = { mode: 'auto', cid: null, gid: null, title: '', snapshot: null, syncedAt: 0 };
            this.init();
        }

        init() {
            this.rootEl = document.querySelector('#htoj-panel [data-role="htoj-root"]');
            if (!this.rootEl) return;
            this.rootEl.addEventListener('click', (event) => this.onClick(event));
            this.rootEl.addEventListener('contextmenu', (event) => this.onContextMenu(event));
            this.ensureCountdownEl();
            this.bindGlobal();
            this.applyLoginStatus();
        }

        bindGlobal() {
            try {
                if (window.electronAPI && window.electronAPI.onHtojUpdated) {
                    window.electronAPI.onHtojUpdated((payload) => {
                        if (payload && (payload.type === 'login' || payload.type === 'logout')) {
                            this.applyLoginStatus();
                        }
                    });
                }
            } catch (_) { }
            window.addEventListener('htoj:unauthorized', () => {
                this.loggedIn = false;
                this.user = null;
                this.render();
            });
            window.addEventListener('beforeunload', () => this.stopCountdown());
        }

        async applyLoginStatus() {
            try {
                const status = await window.electronAPI.htojLoginStatus();
                this.loggedIn = !!(status && status.loggedIn);
                this.user = (status && status.user) || null;
                this.zone = (status && status.zone) || 'cpp';
            } catch (_) {
                this.loggedIn = false;
                this.user = null;
            }
            this.render();
            if (this.loggedIn) {
                this.ensurePageData(this.page);
                this.startCountdown();
            } else {
                this.stopCountdown();
            }
        }

        // ================= 渲染 =================

        render() {
            if (!this.rootEl) return;
            this.rootEl.innerHTML = `${this.topbarHtml()}${this.toolbarHtml()}<div class="htoj-list" data-role="list"></div>`;
            this.listEl = this.rootEl.querySelector('[data-role="list"]');
            this.bindSearchInput();
            this.renderList();
            this.applyAvatar();
            this.renderCountdown();
        }

        /** CDN 头像有防盗链，经主进程带 Referer 拉取后以 data URL 显示。 */
        async applyAvatar() {
            const img = this.rootEl && this.rootEl.querySelector('[data-role="avatar"]');
            if (!img) return;
            const url = this.user && this.user.avatar;
            if (!url) return;
            if (this._avatarUrl === url && this._avatarData) {
                img.src = this._avatarData;
                return;
            }
            try {
                const res = await window.electronAPI.htojFetchImage(url);
                if (res && res.ok && res.dataUrl) {
                    this._avatarUrl = url;
                    this._avatarData = res.dataUrl;
                    const target = this.rootEl && this.rootEl.querySelector('[data-role="avatar"]');
                    if (target) target.src = res.dataUrl;
                }
            } catch (_) { }
        }

        topbarHtml() {
            const name = this.loggedIn
                ? (this.user && (this.user.nickname || this.user.username)) || '已登录'
                : '未登录';
            const avatar = this.loggedIn
                ? '<img class="htoj-avatar" data-role="avatar" alt="">'
                : '<span class="htoj-avatar htoj-avatar-placeholder"></span>';
            return `
                <div class="htoj-topbar">
                    <div class="htoj-user" data-action="account">
                        ${avatar}
                        <span class="htoj-username">${escapeHtml(name)}</span>
                    </div>
                    <div class="htoj-topbar-actions">
                        ${this.loggedIn ? `<button class="htoj-chip" data-action="switch-zone">${this.zone === 'python' ? 'Python' : 'C++'}</button>` : ''}
                        ${this.loggedIn ? '<button class="htoj-iconbtn" data-action="refresh" title="刷新">↻</button>' : ''}
                    </div>
                </div>
            `;
        }

        toolbarHtml() {
            if (!this.loggedIn) return '';
            if (this.page === 'problems') {
                return `
                    <div class="htoj-toolbar">
                        <div class="htoj-search">
                            <span class="htoj-search-icon">⌕</span>
                            <input class="htoj-search-input" data-role="search-input" type="text" placeholder="搜索题号或名称" value="${escapeHtml(this.state.problems.keyword)}">
                            <span class="htoj-search-clear" data-action="search-clear">×</span>
                        </div>
                        <button class="htoj-iconbtn" data-action="page" data-page="trainings" title="题单">▤</button>
                        <button class="htoj-iconbtn" data-action="page" data-page="contests" title="比赛">◷</button>
                    </div>
                `;
            }
            return `
                <div class="htoj-toolbar">
                    <button class="htoj-iconbtn" data-action="page-back" title="返回">←</button>
                    <span class="htoj-page-title">${PAGE_META[this.page] ? PAGE_META[this.page].title : ''}</span>
                    <span class="htoj-toolbar-spacer"></span>
                    <button class="htoj-iconbtn" data-action="refresh" title="刷新">↻</button>
                </div>
            `;
        }

        bindSearchInput() {
            const input = this.rootEl.querySelector('[data-role="search-input"]');
            if (!input) return;
            input.addEventListener('input', () => {
                clearTimeout(this._searchTimer);
                this._searchTimer = setTimeout(() => {
                    this.state.problems.keyword = input.value.trim();
                    this.loadProblems(true);
                }, 300);
            });
            input.addEventListener('keydown', (event) => {
                if (event.key === 'Enter') {
                    clearTimeout(this._searchTimer);
                    this.state.problems.keyword = input.value.trim();
                    this.loadProblems(true);
                }
            });
        }

        renderList() {
            if (!this.listEl) return;
            if (!this.loggedIn) {
                this.listEl.innerHTML = this.loginHtml();
                return;
            }
            if (this.page === 'problems') this.listEl.innerHTML = this.problemsHtml();
            else if (this.page === 'trainings') this.listEl.innerHTML = this.trainingsHtml();
            else if (this.page === 'contests') this.listEl.innerHTML = this.contestsHtml();
            else if (this.page === 'contest') this.listEl.innerHTML = this.contestDetailHtml();
        }

        loginHtml() {
            return `
                <div class="htoj-login">
                    <div class="htoj-login-logo">核桃 OJ</div>
                    <div class="htoj-login-sub">登录后可浏览题目、题单、比赛，并一键提交代码</div>
                    <button class="htoj-btn primary block" data-action="login-qr">微信扫码登录</button>
                    <button class="htoj-btn block" data-action="login-password">手机号 + 密码登录</button>
                    <button class="htoj-btn block" data-action="login-token">粘贴 Token 登录</button>
                </div>
            `;
        }

        // ---------- 题目 ----------

        problemsHtml() {
            const state = this.state.problems;
            if (state.loading && !state.items.length) return '<div class="htoj-state">加载中…</div>';
            if (!state.items.length) return '<div class="htoj-state">暂无题目</div>';
            const rows = state.items.map((item) => {
                const difficulty = item.difficulty || {};
                const total = Number(item.total) || 0;
                const ac = Number(item.ac) || 0;
                const rate = total > 0 ? `${((ac / total) * 100).toFixed(1)}%` : '';
                const diff = difficulty.name
                    ? `<span class="htoj-diff" style="${difficulty.color ? `color:${escapeHtml(difficulty.color)}` : ''}">${escapeHtml(difficulty.name)}</span>`
                    : '';
                return `<div class="htoj-item" data-node="problem" data-pid="${escapeHtml(item.pid)}" data-problem-id="${escapeHtml(item.problemId)}">
                    <span class="htoj-item-status ${acStatusClass(item.acStatus)}"></span>
                    <div class="htoj-item-body">
                        <div class="htoj-item-title"><span class="htoj-item-id">${escapeHtml(item.problemId || '')}</span>${escapeHtml(item.title || '')}</div>
                        <div class="htoj-item-sub">${diff}${rate ? `<span class="htoj-rate">通过率 ${rate}</span>` : ''}</div>
                    </div>
                </div>`;
            }).join('');
            return rows + this.moreHtml('problems');
        }

        // ---------- 题单 ----------

        trainingsHtml() {
            const state = this.state.trainings;
            if (state.loading && !state.items.length) return '<div class="htoj-state">加载中…</div>';
            if (!state.items.length) return '<div class="htoj-state">暂无题单</div>';
            const rows = state.items.map((item) => {
                const expanded = state.expanded.has(item.id);
                const count = Number(item.problemCount) || 0;
                const done = Number(item.completeCount) || 0;
                const total = Number(item.totalCount) || 0;
                const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
                const progressText = total > 0 ? `${done}/${total}` : `${count} 题`;
                const children = expanded ? (state.children.get(item.id) || []) : [];
                const childRows = children.map((child) => this.trainingChildHtml(child, item.id)).join('');
                return `<div class="htoj-item htoj-item-parent" data-node="training" data-tid="${escapeHtml(item.id)}">
                        <span class="htoj-item-arrow ${expanded ? 'open' : ''}">▶</span>
                        <div class="htoj-item-body">
                            <div class="htoj-item-title">${escapeHtml(item.title || ('题单 ' + item.id))}</div>
                            <div class="htoj-item-sub">
                                <span class="htoj-rate">${progressText}${item.isAttend ? ' · 已参与' : ''}</span>
                            </div>
                            ${total > 0 ? `<div class="htoj-progress"><div class="htoj-progress-fill" style="width:${pct}%"></div></div>` : ''}
                        </div>
                    </div>${childRows}`;
            }).join('');
            return rows + this.moreHtml('trainings');
        }

        trainingChildHtml(child, tid) {
            if (!child) return '';
            if (child.kind === 'join') {
                return `<div class="htoj-child htoj-child-action" data-node="join-training" data-tid="${escapeHtml(tid)}">开始练习（参加该题单）</div>`;
            }
            if (child.kind === 'chapter') {
                return `<div class="htoj-child htoj-chapter">${escapeHtml(child.title || '')}</div>`;
            }
            const difficulty = child.difficulty && child.difficulty.name;
            return `<div class="htoj-child htoj-child-problem" data-node="problem" data-pid="${escapeHtml(child.pid)}" data-problem-id="${escapeHtml(child.problemId)}" data-tid="${escapeHtml(tid)}">
                <span class="htoj-item-status ${acStatusClass(child.acStatus)}"></span>
                <span class="htoj-child-title"><b>${escapeHtml(child.problemId || '')}</b> ${escapeHtml(child.title || '')}</span>
                ${difficulty ? `<span class="htoj-diff">${escapeHtml(difficulty)}</span>` : ''}
            </div>`;
        }

        // ---------- 比赛 ----------

        contestsHtml() {
            const state = this.state.contests;
            if (state.loading && !state.items.length) return '<div class="htoj-state">加载中…</div>';
            if (!state.items.length) return '<div class="htoj-state">暂无比赛</div>';
            const rows = state.items.map((item) => {
                const cs = contestState(item);
                const typeName = (item.typeDesc && item.typeDesc.name) || '';
                const remain = item.status === 0 ? fmtDuration(item.contestRemainTime != null ? item.contestRemainTime : item.remainTime) : '';
                const subParts = [typeName, remain].filter(Boolean).join(' · ');
                return `<div class="htoj-item" data-node="contest" data-cid="${escapeHtml(item.id)}">
                    <div class="htoj-item-body">
                        <div class="htoj-item-title">${escapeHtml(item.title || ('比赛 ' + item.id))}</div>
                        <div class="htoj-item-sub">
                            <span class="htoj-chip-status ${cs.cls}">${cs.text}</span>
                            ${subParts ? `<span class="htoj-rate">${escapeHtml(subParts)}</span>` : ''}
                        </div>
                    </div>
                    <span class="htoj-chevron">›</span>
                </div>`;
            }).join('');
            return rows + this.moreHtml('contests');
        }

        contestDetailHtml() {
            const detail = this.contestDetail;
            if (!detail) return '<div class="htoj-state">未选择比赛</div>';
            if (detail.loading && !detail.info) return '<div class="htoj-state">加载中…</div>';
            const info = detail.info || {};
            const cs = contestState(info);
            const typeName = (info.typeDesc && info.typeDesc.name) || '';
            const remain = info.status === 0 ? fmtDuration(info.contestRemainTime != null ? info.contestRemainTime : info.remainTime) : '';
            const action = this.contestAction(info, detail.needsStart, detail.listRecord);
            const stats = [];
            if (info.problemCount != null) stats.push(`题目 ${info.problemCount}`);
            if (info.count != null) stats.push(`报名 ${info.count}`);
            if (detail.rank) stats.push(`得分 ${detail.rank.score} · 排名 ${detail.rank.rank}`);

            const metaParts = [typeName, remain ? `剩余 ${remain}` : '', stats.join(' · ')].filter(Boolean);

            let problemsHtml;
            if (detail.needsStart) {
                problemsHtml = '<div class="htoj-state">需先开始比赛才能查看题目</div>';
            } else if (!detail.problems.length) {
                problemsHtml = '<div class="htoj-state">暂无题目</div>';
            } else {
                problemsHtml = detail.problems.map((child) => {
                    const difficulty = child.difficulty && child.difficulty.name;
                    const title = child.displayTitle || child.problemId || '';
                    const index = child.indexTitle || child.displayId || '';
                    return `<div class="htoj-item" data-node="problem" data-pid="${escapeHtml(child.pid)}" data-problem-id="${escapeHtml(child.problemId)}" data-cid="${escapeHtml(info.id)}">
                        <span class="htoj-item-status ${acStatusClass(child.status)}"></span>
                        <div class="htoj-item-body">
                            <div class="htoj-item-title">${index ? `<span class="htoj-item-id">${escapeHtml(index)}</span>` : ''}${escapeHtml(title)}</div>
                            ${difficulty ? `<div class="htoj-item-sub"><span class="htoj-diff">${escapeHtml(difficulty)}</span></div>` : ''}
                        </div>
                    </div>`;
                }).join('');
            }

            const actions = [];
            if (action === 'register') actions.push(`<button class="htoj-btn primary" data-action="contest-register" data-cid="${escapeHtml(info.id)}">报名比赛</button>`);
            else if (action === 'start') actions.push(`<button class="htoj-btn primary" data-action="contest-start" data-cid="${escapeHtml(info.id)}">开始比赛</button>`);
            actions.push(`<button class="htoj-btn" data-action="contest-countdown" data-cid="${escapeHtml(info.id)}">设为倒计时</button>`);
            actions.push(`<button class="htoj-btn" data-action="contest-browser" data-cid="${escapeHtml(info.id)}">在浏览器打开</button>`);

            return `
                <div class="htoj-detail">
                    <div class="htoj-detail-head">
                        <div class="htoj-detail-title">
                            <span>${escapeHtml(info.title || '')}</span>
                            <span class="htoj-chip-status ${cs.cls}">${cs.text}</span>
                        </div>
                        ${metaParts.length ? `<div class="htoj-detail-meta">${escapeHtml(metaParts.join(' · '))}</div>` : ''}
                        <div class="htoj-detail-actions">${actions.join('')}</div>
                    </div>
                    <div class="htoj-detail-problems">${problemsHtml}</div>
                </div>
            `;
        }

        contestAction(info, forceStart, listRecord) {
            if (!info) return 'none';
            const registered = isContestRegistered(info, listRecord);
            const started = isContestStarted(info, listRecord);
            if (!registered) return 'register';
            if (forceStart || (info.status === 0 && !started)) return 'start';
            return 'none';
        }

        moreHtml(section) {
            const state = this.state[section];
            if (!state.hasMore) return '';
            if (state.loading) return '<div class="htoj-state">加载中…</div>';
            return `<div class="htoj-more" data-action="load-more" data-section="${section}">加载更多</div>`;
        }

        // ================= 交互 =================

        onClick(event) {
            const actionEl = event.target.closest('[data-action]');
            if (actionEl) {
                this.handleAction(actionEl.dataset.action, actionEl);
                return;
            }
            const node = event.target.closest('[data-node]');
            if (!node) return;
            switch (node.dataset.node) {
                case 'problem': this.openProblem(node); break;
                case 'training': this.toggleTraining(node.dataset.tid); break;
                case 'contest': this.openContestDetail(node.dataset.cid); break;
                case 'join-training': this.joinTraining(node.dataset.tid); break;
            }
        }

        handleAction(action, el) {
            if (!this.loggedIn && ['switch-zone', 'refresh', 'page', 'page-back'].includes(action)) return;
            switch (action) {
                case 'login-qr': this.loginQr(); break;
                case 'login-password': this.loginPassword(); break;
                case 'login-token': this.loginToken(); break;
                case 'page': this.gotoPage(el.dataset.page); break;
                case 'page-back': this.gotoPage(this.page === 'contest' ? 'contests' : 'problems'); break;
                case 'contest-register': this.joinContest(el.dataset.cid); break;
                case 'contest-start': this.startContest(el.dataset.cid); break;
                case 'contest-browser': this.openContestInBrowser(el.dataset.cid); break;
                case 'contest-countdown': this.pinCountdown(el.dataset.cid, (this.contestDetail && this.contestDetail.info && this.contestDetail.info.title) || ''); break;
                case 'load-more': this.loadMore(el.dataset.section); break;
                case 'search-clear': this.clearSearch(); break;
                case 'switch-zone': this.switchZone(); break;
                case 'refresh': this.refresh(); break;
                case 'account': this.showAccountMenu(); break;
            }
        }

        gotoPage(page) {
            if (!PAGE_META[page]) return;
            this.page = page;
            this.render();
            this.ensurePageData(page);
        }

        ensurePageData(page) {
            if (page === 'problems' && !this.state.problems.items.length) this.loadProblems(true);
            else if (page === 'trainings' && !this.state.trainings.items.length) this.loadTrainings(true);
            else if (page === 'contests' && !this.state.contests.items.length) this.loadContests(true);
        }

        refresh() {
            if (this.page === 'problems') this.loadProblems(true);
            else if (this.page === 'trainings') this.loadTrainings(true);
            else if (this.page === 'contests') this.loadContests(true);
            else if (this.page === 'contest' && this.contestDetail) this.loadContestDetail(this.contestDetail.id);
        }

        loadMore(section) {
            const state = this.state[section];
            if (!state || state.loading || !state.hasMore) return;
            if (section === 'problems') this.loadProblems(false);
            else if (section === 'trainings') this.loadTrainings(false);
            else this.loadContests(false);
        }

        async loadProblems(reset) {
            const state = this.state.problems;
            if (state.loading) return;
            state.loading = true;
            if (reset) { state.page = 0; state.items = []; state.hasMore = true; }
            this.renderList();
            try {
                const data = await window.htojApi.problem.list({
                    currentPage: state.page + 1,
                    limit: PAGE_SIZE,
                    keyword: state.keyword || undefined
                });
                const records = (data && data.records) || [];
                state.items = reset ? records : state.items.concat(records);
                state.page += 1;
                const total = data && typeof data.total === 'number' ? data.total : state.items.length;
                state.hasMore = state.items.length < total;
            } catch (error) {
                this.toast(error.message, 'error');
                state.hasMore = false;
            } finally {
                state.loading = false;
                if (this.page === 'problems') this.renderList();
            }
        }

        async loadTrainings(reset) {
            const state = this.state.trainings;
            if (state.loading) return;
            state.loading = true;
            if (reset) { state.page = 0; state.items = []; state.hasMore = true; }
            this.renderList();
            try {
                const data = await window.htojApi.training.list({ currentPage: state.page + 1, limit: 50 });
                const records = (data && data.records) || [];
                state.items = reset ? records : state.items.concat(records);
                state.page += 1;
                const total = data && typeof data.total === 'number' ? data.total : state.items.length;
                state.hasMore = state.items.length < total;
            } catch (error) {
                this.toast(error.message, 'error');
                state.hasMore = false;
            } finally {
                state.loading = false;
                if (this.page === 'trainings') this.renderList();
            }
        }

        async loadContests(reset) {
            const state = this.state.contests;
            if (state.loading) return;
            state.loading = true;
            if (reset) { state.page = 0; state.items = []; state.hasMore = true; }
            this.renderList();
            try {
                const data = await window.htojApi.contest.list({ currentPage: state.page + 1, limit: PAGE_SIZE });
                const records = (data && data.records) || [];
                state.items = reset ? records : state.items.concat(records);
                state.page += 1;
                const total = data && typeof data.total === 'number' ? data.total : state.items.length;
                state.hasMore = state.items.length < total;
            } catch (error) {
                this.toast(error.message, 'error');
                state.hasMore = false;
            } finally {
                state.loading = false;
                if (this.page === 'contests') this.renderList();
                this.maybeAutoCountdown();
            }
        }

        // ---------- 展开 ----------

        async toggleTraining(rawId) {
            const id = Number(rawId);
            const state = this.state.trainings;
            if (state.expanded.has(id)) {
                state.expanded.delete(id);
                this.renderList();
                return;
            }
            state.expanded.add(id);
            this.renderList();
            if (!state.children.has(id)) await this.loadTrainingChildren(id);
        }

        async loadTrainingChildren(id) {
            const state = this.state.trainings;
            try {
                const data = await window.htojApi.training.problems({ tid: id, currentPage: 1, limit: 200 });
                const records = (data && data.records) || [];
                const children = [];
                const record = state.items.find((t) => t.id === id);
                if (record && record.isAttend === false) children.push({ kind: 'join' });
                let lastChapter = null;
                for (const item of records) {
                    const chapter = item.trainingChapterVO;
                    if (chapter && chapter.title && (!lastChapter || lastChapter.id !== chapter.id)) {
                        children.push({ kind: 'chapter', title: chapter.title, id: chapter.id });
                        lastChapter = chapter;
                    }
                    for (const problem of (item.problemVOList || [])) {
                        children.push({ kind: 'problem', ...problem });
                    }
                }
                state.children.set(id, children);
            } catch (error) {
                if (/开始练习|参加/.test(error.message || '')) state.children.set(id, [{ kind: 'join' }]);
                else {
                    state.children.set(id, []);
                    this.toast(error.message, 'error');
                }
            }
            this.renderList();
        }

        async joinTraining(rawId) {
            const id = Number(rawId);
            if (!(await this.confirm('开始练习', '确定参加该题单吗？'))) return;
            try {
                await window.htojApi.training.register(id);
                const record = this.state.trainings.items.find((t) => t.id === id);
                if (record) record.isAttend = true;
                this.state.trainings.children.delete(id);
                this.toast('已参加题单', 'success');
                await this.loadTrainingChildren(id);
            } catch (error) {
                this.toast(error.message, 'error');
            }
        }

        async openContestDetail(rawId) {
            const id = Number(rawId);
            if (!Number.isFinite(id) || id <= 0) return;
            this.page = 'contest';
            this.contestDetail = { id, loading: true, info: null, problems: [], needsStart: false, rank: null };
            this.render();
            await this.loadContestDetail(id);
        }

        async loadContestDetail(cid) {
            const listRecord = this.state.contests.items.find((c) => String(c.id) === String(cid)) || null;
            const detail = { id: cid, loading: true, info: null, problems: [], needsStart: false, rank: null, listRecord };
            this.contestDetail = detail;
            if (this.page === 'contest') this.renderList();
            try {
                detail.info = await window.htojApi.contest.info({ cid });
            } catch (error) {
                this.toast(error.message, 'error');
            }
            try {
                const data = await window.htojApi.contest.problems({ cid, currentPage: 1, limit: 100 });
                detail.problems = (data && data.records) || [];
            } catch (error) {
                if (/开始比赛|开始/.test(error.message || '')) detail.needsStart = true;
                else this.toast(error.message, 'error');
            }
            detail.rank = await this.fetchMyRank(cid, detail.info, listRecord);
            detail.loading = false;
            if (this.page === 'contest') this.renderList();
        }

        async fetchMyRank(cid, info, record) {
            if (!info || !this.user || info.type === 1) return null;
            if (!isContestRegistered(info, record)) return null;
            try {
                const userId = this.user.userId != null ? this.user.userId : this.user.uid;
                const data = await window.htojApi.contest.scoreboard({ cid, keyword: String(userId), currentPage: 1, limit: 20 });
                const mine = ((data && data.records) || []).find((row) => String(row.uid) === String(this.user.uid));
                return mine ? { score: mine.totalScore, rank: mine.rank } : null;
            } catch (_) {
                return null;
            }
        }

        async joinContest(rawId) {
            const id = Number(rawId);
            let info = null;
            try { info = await window.htojApi.contest.info({ cid: id }); } catch (_) { }
            if (info && info.registered) {
                this.toast('你已报名该比赛', 'info');
                return;
            }
            const needPassword = info && info.needPassword;
            if (!(await this.confirm('报名比赛', needPassword ? '该比赛需要密码，确定报名吗？' : '确定报名该比赛吗？'))) return;
            let password;
            if (needPassword) {
                password = await window.dialogManager.showInputDialog('比赛密码', '', '请输入比赛密码');
                if (password == null) return;
            }
            try {
                const result = await window.htojApi.contest.register({ cid: id, password });
                if (result && result.registerState === 1) {
                    this.toast('该比赛需要补充报名信息，请到网页端完成', 'warning');
                    return;
                }
                const record = this.state.contests.items.find((c) => c.id === id);
                if (record) record.registered = true;
                this.toast('报名成功', 'success');
                await this.loadContestDetail(id);
            } catch (error) {
                this.toast(error.message || '报名失败', 'error');
            }
        }

        async startContest(rawId) {
            const id = Number(rawId);
            let info = null;
            try { info = await window.htojApi.contest.info({ cid: id }); } catch (_) { }
            if (info && info.started) {
                this.toast('比赛已开始', 'info');
                return;
            }
            if (!(await this.confirm('开始比赛', '开始后将开启计时且无法撤销，确定现在开始吗？'))) return;
            try {
                await window.htojApi.contest.start({ cid: id });
                const record = this.state.contests.items.find((c) => c.id === id);
                if (record) record.started = true;
                this.toast('比赛已开始', 'success');
                await this.loadContestDetail(id);
                this.pinCountdown(id, (info && info.title) || (record && record.title) || '');
            } catch (error) {
                this.toast(error.message || '开始比赛失败', 'error');
            }
        }

        openContestInBrowser(rawId) {
            const id = Number(rawId);
            const gid = this.contestDetail && this.contestDetail.info && this.contestDetail.info.gid;
            const suffix = gid ? `&gid=${gid}` : '';
            window.electronAPI.openExternal(`https://htoj.com.cn/${this.zone}/oj/contest/detail?cid=${id}${suffix}`);
        }

        // ---------- 打开题目 ----------

        openProblem(node) {
            const pid = Number(node.dataset.pid);
            if (!Number.isFinite(pid) || pid <= 0) return;
            const context = {};
            if (node.dataset.cid) context.cid = Number(node.dataset.cid);
            if (node.dataset.tid) context.tid = Number(node.dataset.tid);
            const problemId = node.dataset.problemId || '';
            if (window.htojProblemView) {
                window.htojProblemView.openProblem({ pid, problemId, context });
            }
        }

        // ---------- 搜索 / 语言 / 账户 ----------

        clearSearch() {
            const input = this.rootEl.querySelector('[data-role="search-input"]');
            if (input) input.value = '';
            this.state.problems.keyword = '';
            this.loadProblems(true);
        }

        async switchZone() {
            const target = this.zone === 'cpp' ? 'python' : 'cpp';
            if (!(await this.confirm('切换题库语言', `切换到 ${target === 'python' ? 'Python' : 'C++'} 分区？`))) return;
            try {
                const result = await window.electronAPI.htojSetZone(target);
                this.zone = (result && result.zone) || target;
                this.resetAll();
                this.render();
                this.ensurePageData(this.page);
                if (window.htojProblemView) window.htojProblemView._zone = this.zone;
            } catch (error) {
                this.toast(error.message || '切换失败', 'error');
            }
        }

        async showAccountMenu() {
            if (!this.loggedIn) {
                this.loginQr();
                return;
            }
            const label = this.user ? (this.user.nickname || this.user.username || '已登录') : '已登录';
            const action = await window.dialogManager.showActionDialog('核桃OJ', `${label} · ${this.zone === 'python' ? 'Python' : 'C++'}`, [
                { id: 'refresh-user', label: '刷新用户信息' },
                { id: 'logout', label: '退出登录', className: 'dialog-btn-cancel' }
            ]);
            if (action === 'logout') {
                try { await window.electronAPI.htojLogout(); } catch (_) { }
                this.applyLoginStatus();
            } else if (action === 'refresh-user') {
                try {
                    const result = await window.electronAPI.htojRefreshUser();
                    if (result && result.ok) {
                        this.user = result.user;
                        this.toast('已刷新', 'success');
                    }
                } catch (error) {
                    this.toast(error.message || '刷新失败', 'error');
                }
            }
        }

        resetAll() {
            this.state.problems = { page: 0, hasMore: true, items: [], keyword: '', loading: false };
            this.state.trainings = { page: 0, hasMore: true, items: [], loading: false, expanded: new Set(), children: new Map() };
            this.state.contests = { page: 0, hasMore: true, items: [], loading: false };
            this.contestDetail = null;
        }

        // ================= 登录 =================

        async loginToken() {
            const token = await window.dialogManager.showInputDialog('粘贴 Token 登录', '', '粘贴 KEY_USER_LOGIN_TOKEN 的值');
            if (!token || !token.trim()) return;
            try {
                const result = await window.electronAPI.htojLoginToken(token.trim());
                if (result && result.ok) {
                    this.toast('登录成功', 'success');
                    this.applyLoginStatus();
                } else {
                    this.toast((result && result.message) || '登录失败', 'error');
                }
            } catch (error) {
                this.toast(error.message || '登录失败', 'error');
            }
        }

        async loginPassword() {
            const phone = await window.dialogManager.showInputDialog('手机号登录', '', '请输入手机号');
            if (!phone) return;
            const password = await window.dialogManager.showInputDialog('手机号登录', '', '请输入密码');
            if (!password) return;
            try {
                const result = await window.electronAPI.htojLoginPassword(phone.trim(), password);
                if (result && result.ok) {
                    this.toast('登录成功', 'success');
                    this.applyLoginStatus();
                } else {
                    this.toast((result && result.message) || '登录失败', 'error');
                }
            } catch (error) {
                this.toast(error.message || '登录失败', 'error');
            }
        }

        async loginQr() {
            let created;
            try {
                created = await window.electronAPI.htojQrCreate();
            } catch (error) {
                this.toast(error.message || '获取二维码失败', 'error');
                return;
            }
            if (!created || !created.ok || !created.ticketBase64) {
                this.toast((created && created.message) || '获取二维码失败', 'error');
                return;
            }
            this.showQrModal(created.ticketBase64, created.sessionId);
        }

        showQrModal(ticketBase64, sessionId) {
            const overlay = document.createElement('div');
            overlay.className = 'htoj-modal-overlay';
            overlay.innerHTML = `
                <div class="htoj-modal">
                    <div class="htoj-modal-title">微信扫码登录</div>
                    <img class="htoj-qr-img" alt="二维码" src="data:image/jpeg;base64,${ticketBase64}">
                    <div class="htoj-qr-status" data-role="qr-status">请使用微信扫码并在手机上确认</div>
                    <div class="htoj-modal-actions">
                        <button class="htoj-btn" data-role="qr-refresh">刷新二维码</button>
                        <button class="htoj-btn" data-role="qr-close">取消</button>
                    </div>
                </div>
            `;
            document.body.appendChild(overlay);
            const statusEl = overlay.querySelector('[data-role="qr-status"]');
            const imgEl = overlay.querySelector('.htoj-qr-img');
            let pollTimer = null;
            let stopped = false;
            const timeoutAt = Date.now() + 5 * 60 * 1000;

            const close = () => {
                stopped = true;
                if (pollTimer) clearInterval(pollTimer);
                overlay.remove();
            };

            const poll = async () => {
                if (stopped) return;
                if (Date.now() > timeoutAt) {
                    if (statusEl) statusEl.textContent = '二维码已过期，请刷新';
                    if (pollTimer) clearInterval(pollTimer);
                    return;
                }
                try {
                    const result = await window.electronAPI.htojQrCheck(sessionId);
                    if (!result || !result.ok) return;
                    if (result.token) {
                        close();
                        const login = await window.electronAPI.htojLoginToken(result.token);
                        if (login && login.ok) {
                            this.toast('登录成功', 'success');
                            this.applyLoginStatus();
                        } else {
                            this.toast((login && login.message) || '登录失败', 'error');
                        }
                        return;
                    }
                    if (result.qrCodeStatus === 2 && statusEl) statusEl.textContent = '已扫码，请在手机上确认';
                    else if (result.qrCodeStatus === 3 && statusEl) statusEl.textContent = '已确认，正在登录…';
                } catch (_) { }
            };

            pollTimer = setInterval(poll, 2000);
            overlay.querySelector('[data-role="qr-close"]').addEventListener('click', close);
            overlay.querySelector('[data-role="qr-refresh"]').addEventListener('click', async () => {
                try {
                    const refreshed = await window.electronAPI.htojQrCreate();
                    if (refreshed && refreshed.ok && refreshed.ticketBase64) {
                        imgEl.src = `data:image/jpeg;base64,${refreshed.ticketBase64}`;
                        sessionId = refreshed.sessionId;
                        if (statusEl) statusEl.textContent = '请使用微信扫码并在手机上确认';
                    }
                } catch (_) { }
            });
            overlay.addEventListener('click', (event) => {
                if (event.target === overlay) close();
            });
        }

        // ================= 倒计时 =================

        ensureCountdownEl() {
            if (this.countdownEl && document.body.contains(this.countdownEl)) return;
            const titlebar = document.querySelector('.titlebar');
            if (!titlebar) return;
            const el = document.createElement('button');
            el.className = 'htoj-chip htoj-countdown-chip';
            el.dataset.role = 'countdown';
            el.style.display = 'none';
            el.addEventListener('click', () => this.openCountdownContest());
            const controls = titlebar.querySelector('.titlebar-controls');
            if (controls) titlebar.insertBefore(el, controls);
            else titlebar.appendChild(el);
            this.countdownEl = el;
        }

        openCountdownContest() {
            const cid = this.countdown.cid;
            if (!cid) return;
            const gid = this.countdown.gid ? `&gid=${this.countdown.gid}` : '';
            window.electronAPI.openExternal(`https://htoj.com.cn/${this.zone}/oj/contest/detail?cid=${cid}${gid}`);
        }

        pinCountdown(cid, title) {
            this.countdown.mode = 'pin';
            this.countdown.cid = Number(cid);
            this.countdown.gid = null;
            this.countdown.title = title || '';
            this.syncCountdown(true);
        }

        maybeAutoCountdown() {
            if (this.countdown.mode === 'auto' && this.loggedIn) this.syncCountdown(true);
        }

        startCountdown() {
            this.ensureCountdownEl();
            this.syncCountdown(true);
            if (this.countdownTimer) clearInterval(this.countdownTimer);
            this.countdownTimer = setInterval(() => {
                this.renderCountdown();
                if (Date.now() - this.countdown.syncedAt > 60000) this.syncCountdown(false);
            }, 1000);
        }

        stopCountdown() {
            if (this.countdownTimer) {
                clearInterval(this.countdownTimer);
                this.countdownTimer = null;
            }
            this.renderCountdown();
        }

        getAutoTarget() {
            const items = this.state.contests.items || [];
            return items
                .filter((c) => c.status === 0 && (c.registered === true || c.started === true) && Number(c.endTime) > Date.now())
                .sort((a, b) => Number(a.endTime) - Number(b.endTime))[0] || null;
        }

        async syncCountdown() {
            if (!this.loggedIn || this._countdownSyncing) return;
            this._countdownSyncing = true;
            try {
                let targetCid;
                let targetGid = null;
                if (this.countdown.mode === 'pin' && this.countdown.cid) {
                    targetCid = this.countdown.cid;
                    targetGid = this.countdown.gid;
                } else {
                    if (!this.state.contests.items.length) {
                        try { await this.loadContests(true); } catch (_) { }
                    }
                    const target = this.getAutoTarget();
                    if (!target) {
                        this.countdown.snapshot = null;
                        this.countdown.cid = null;
                        this.renderCountdown();
                        return;
                    }
                    targetCid = target.id;
                }
                const info = await window.htojApi.contest.info({ cid: targetCid, gid: targetGid || undefined });
                if (!info) return;
                this.countdown.cid = info.id;
                this.countdown.gid = info.gid || targetGid || null;
                this.countdown.title = info.title || this.countdown.title;
                this.countdown.snapshot = {
                    anchor: Date.now(),
                    serverNow: Number(info.now) || Date.now(),
                    remainSeconds: Number(info.remainTime) || 0,
                    started: info.started === true,
                    status: info.status,
                    startTime: Number(info.startTime) || 0,
                    endTime: Number(info.endTime) || 0
                };
                this.countdown.syncedAt = Date.now();
            } catch (_) { }
            finally {
                this._countdownSyncing = false;
            }
            this.renderCountdown();
        }

        renderCountdown() {
            this.ensureCountdownEl();
            const el = this.countdownEl;
            if (!el) return;
            const snap = this.countdown.snapshot;
            if (!this.loggedIn || !snap || snap.status === 1) {
                el.style.display = 'none';
                return;
            }
            const elapsed = Date.now() - snap.anchor;
            const serverNow = snap.serverNow + elapsed;
            let remain;
            let caption;
            if (snap.status === -1) {
                remain = snap.startTime - serverNow;
                caption = '距开始';
            } else if (snap.started) {
                remain = Math.max(0, snap.remainSeconds * 1000 - elapsed);
                caption = '个人';
            } else {
                remain = snap.endTime - serverNow;
                caption = '窗口剩';
            }
            if (remain <= 0 && snap.status === -1) {
                el.style.display = 'none';
                return;
            }
            const urgent = remain > 0 && remain < 5 * 60 * 1000;
            el.style.display = '';
            el.classList.toggle('urgent', urgent);
            const title = (this.countdown.title || '').slice(0, 10);
            el.textContent = `⏱ ${title ? title + ' ' : ''}${caption} ${fmtCountdown(remain)}`;
            el.title = `${this.countdown.title}\n${caption}：${fmtCountdown(remain)}\n点击在浏览器中打开`;
        }

        // ================= 右键菜单 =================

        onContextMenu(event) {
            if (!this.loggedIn) return;
            const node = event.target.closest('[data-node]');
            if (!node) return;
            event.preventDefault();
            event.stopPropagation();
            const items = [];
            if (node.dataset.node === 'contest') {
                items.push({ label: '设为倒计时目标', action: () => {
                    const cid = node.dataset.cid;
                    const record = this.state.contests.items.find((c) => String(c.id) === String(cid));
                    this.pinCountdown(cid, record ? record.title : '');
                } });
            }
            items.push({ label: '刷新', action: () => this.refresh() });
            this.showContextMenu(items, event.clientX, event.clientY);
        }

        showContextMenu(items, x, y) {
            this.clearContextMenu();
            const menu = document.createElement('div');
            menu.className = 'context-menu';
            menu.style.position = 'fixed';
            menu.style.zIndex = '10000';
            items.forEach((item) => {
                const entry = document.createElement('div');
                entry.className = 'context-menu-item';
                entry.textContent = item.label;
                entry.addEventListener('click', () => {
                    this.clearContextMenu();
                    item.action && item.action();
                });
                menu.appendChild(entry);
            });
            document.body.appendChild(menu);
            const rect = menu.getBoundingClientRect();
            let left = x;
            let top = y;
            if (left + rect.width > window.innerWidth) left = window.innerWidth - rect.width - 10;
            if (top + rect.height > window.innerHeight) top = window.innerHeight - rect.height - 10;
            menu.style.left = `${Math.max(10, left)}px`;
            menu.style.top = `${Math.max(10, top)}px`;
            this.contextMenu = menu;
            setTimeout(() => document.addEventListener('click', this.dismissContextMenu, { once: true }), 0);
        }

        dismissContextMenu = () => {
            this.clearContextMenu();
        };

        clearContextMenu() {
            if (this.contextMenu) {
                this.contextMenu.remove();
                this.contextMenu = null;
            }
        }

        // ================= 工具 =================

        async confirm(title, message) {
            if (window.dialogManager && window.dialogManager.showConfirmDialog) {
                return !!(await window.dialogManager.showConfirmDialog(title, message));
            }
            return true;
        }

        toast(message, type) {
            if (window.oicppApp && window.oicppApp.showMessage) {
                window.oicppApp.showMessage(message, type || 'info');
            }
        }

        activate() {
            if (!this.loggedIn) {
                this.applyLoginStatus();
                return;
            }
            this.ensurePageData(this.page);
            this.startCountdown();
        }
    }

    window.HtojPanel = HtojPanel;
})();
