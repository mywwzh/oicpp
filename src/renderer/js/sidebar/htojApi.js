/**
 * 核桃OJ 渲染进程 API 封装。
 *
 * 所有请求都经主进程 htoj-request 转发（主进程负责 token / zone / 公共头注入），
 * 因此这里只描述「路径 + 参数」，与云端 htoj-vscode 的 endpoints 保持一致。
 */
(function () {
    if (typeof window === 'undefined') return;

    class HtojApiError extends Error {
        constructor(code, message) {
            super(message || '请求失败');
            this.name = 'HtojApiError';
            this.code = code;
        }
        get isUnauthorized() {
            return this.code === 401;
        }
    }

    async function call(payload) {
        if (!window.electronAPI || typeof window.electronAPI.htojRequest !== 'function') {
            throw new HtojApiError(-1, '核桃OJ 接口不可用');
        }
        const response = await window.electronAPI.htojRequest(payload || {});
        if (!response || !response.ok) {
            if (response && response.unauthorized) {
                try {
                    window.dispatchEvent(new CustomEvent('htoj:unauthorized'));
                } catch (_) { }
            }
            throw new HtojApiError(response && response.code != null ? response.code : -1,
                (response && response.message) || '请求失败');
        }
        return response.data;
    }

    const problem = {
        list: (query) => call({ method: 'GET', path: '/api/code-community/api/get-problem-list', query }),
        detail: (problemId, ctx = {}) => call({
            method: 'GET',
            path: '/api/htoj-biz-gateway/api/get-problem-detail',
            query: { problemId, ...ctx }
        }),
        languages: () => call({ method: 'GET', path: '/api/code-community/api/get-language' }),
        submit: (body) => call({ method: 'POST', path: '/api/code-community/api/submit-problem-judge', body }),
        testSubmit: (body) => call({ method: 'POST', path: '/api/code-community/api/submit-problem-test-judge', body }),
        testResult: (testJudgeKey) => call({
            method: 'GET',
            path: '/api/code-community/api/get-test-judge-result',
            query: { testJudgeKey }
        }),
        submissionDetail: (submitId) => call({
            method: 'GET',
            path: '/api/htoj-biz-gateway/api/get-submission-detail',
            query: { submitId }
        }),
        submissionList: (query) => {
            const q = query || {};
            const limit = Math.min(typeof q.limit === 'number' ? q.limit : 20, 20);
            return call({
                method: 'GET',
                path: '/api/code-community/api/get-my-submission-list',
                query: { currentPage: 1, ...q, limit }
            });
        }
    };

    const training = {
        list: (query) => call({ method: 'GET', path: '/api/code-community/api/get-training-list', query: { currentPage: 1, limit: 50, ...query } }),
        detail: (query) => call({ method: 'GET', path: '/api/code-community/api/get-training-detail', query }),
        problems: (query) => call({ method: 'GET', path: '/api/code-community/api/get-training-problem-list', query: { currentPage: 1, limit: 200, ...query } }),
        register: (tid) => call({ method: 'POST', path: '/api/code-community/api/register-training', body: { tid } })
    };

    const contest = {
        list: (query) => call({
            method: 'GET',
            path: '/api/code-community/api/get-contest-list',
            query: { currentPage: 1, limit: 20, ...query }
        }),
        info: (query) => call({ method: 'GET', path: '/api/code-community/api/get-contest-info', query }),
        problems: (query) => call({
            method: 'GET',
            path: '/api/code-community/api/get-contest-problem',
            query: { currentPage: 1, limit: 100, ...query }
        }),
        register: (body) => call({ method: 'POST', path: '/api/code-community/api/register-contest', body }),
        start: (body) => call({ method: 'POST', path: '/api/code-community/api/start-contest', body }),
        scoreboard: (query) => call({
            method: 'GET',
            path: '/api/code-community/api/get-contest-scoreboard',
            query: { currentPage: 1, limit: 20, ...query }
        })
    };

    const user = {
        me: () => call({ method: 'GET', path: '/api/htoj-biz-gateway/api/get-user-info', query: { distinguish: 1 } })
    };

    window.htojApi = { call, HtojApiError, problem, training, contest, user };
})();
