'use strict';

/**
 * 核桃OJ（htoj.com.cn）接入模块。
 *
 * 负责：站点/登录 HTTP 请求、登录态与 token 持久化、IPC 注册。
 * token 复用主进程 settings 体系（settings.htoj），与 settings.account 同源存储。
 */

const logger = require('./utils/logger');

const DEFAULT_API_BASE = 'https://api.htoj.com.cn';
const HETAO_API_BASE = 'https://api.hetao101.com';
const HTOJ_HOME = 'https://htoj.com.cn';

// 站点接口公共请求头，缺 Hetao-Oj-Zone 网关会直接报错。
const COMMON_HEADERS = {
    HT_PLATFORM: 'htojWeb',
    HT_SYSTEM: 'web',
    HT_VERSION: '1.0.0',
    app_id: 'com.hetao101.oj'
};

const AUTH_HEADERS = {
    app_id: 'com.hetao101.oj',
    HT_PLATFORM: 'htojWeb',
    HT_SYSTEM: 'web',
    HT_VERSION: '1.0.0'
};

/** 凭据 XOR 混淆（逐字符异或 0x65），与站点前端一致。 */
function encodeCredential(input) {
    let out = '';
    for (const ch of String(input == null ? '' : input)) {
        out += String.fromCharCode(ch.charCodeAt(0) ^ 0x65);
    }
    return out;
}

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

function buildUrl(base, requestPath, query) {
    const url = new URL(/^https?:/i.test(requestPath) ? requestPath : base + requestPath);
    if (query && typeof query === 'object') {
        for (const [key, value] of Object.entries(query)) {
            if (value === undefined || value === null || value === '') continue;
            url.searchParams.set(key, String(value));
        }
    }
    return url.toString();
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 服务端有频控（「访问太频繁，请稍后再试！」），只读请求自动重试。 */
function isRetryable(error) {
    if (!(error instanceof HtojApiError)) return false;
    if (error.code === 429) return true;
    return /频繁|稍后再试|too many/i.test(error.message || '');
}

class HtojService {
    constructor(deps = {}) {
        this.getSettings = deps.getSettings || (() => ({}));
        this.saveSettings = deps.saveSettings || (() => { });
        this.getMainWindow = deps.getMainWindow || (() => null);
    }

    get settingsRoot() {
        return this.getSettings() || {};
    }

    get cfg() {
        const h = this.settingsRoot.htoj;
        return h && typeof h === 'object' ? h : {};
    }

    ensureCfg() {
        const root = this.getSettings();
        if (!root.htoj || typeof root.htoj !== 'object') {
            root.htoj = {};
        }
        return root.htoj;
    }

    get token() {
        return this.cfg.token || '';
    }

    get zone() {
        return this.cfg.zone === 'python' ? 'python' : 'cpp';
    }

    get apiBase() {
        return this.cfg.apiBase || DEFAULT_API_BASE;
    }

    broadcast(payload) {
        try {
            const win = this.getMainWindow();
            if (win && !win.isDestroyed()) {
                win.webContents.send('htoj-updated', payload || {});
            }
        } catch (_) { }
    }

    async send(requestPath, options = {}) {
        const {
            method = 'GET',
            query,
            body,
            base,
            headers: extraHeaders,
            siteScoped = /^\/api\//.test(requestPath),
            timeoutMs = 20000
        } = options;

        const url = buildUrl(base || this.apiBase, requestPath, query);
        const headers = {
            Accept: 'application/json, text/plain, */*',
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
            ...(extraHeaders || {})
        };
        if (siteScoped) {
            Object.assign(headers, COMMON_HEADERS, { 'Hetao-Oj-Zone': this.zone });
            if (this.token) headers.Authorization = this.token;
        }

        const controller = new AbortController();
        const timer = setTimeout(() => { try { controller.abort(); } catch (_) { } }, timeoutMs);
        const startedAt = Date.now();
        let response;
        try {
            logger.logInfo('[htoj] -->', method, url, siteScoped ? `[zone=${this.zone} token=${this.token ? '有' : '无'}]` : '[登录接口]');
            response = await fetch(url, {
                method,
                headers,
                body: body === undefined ? undefined : JSON.stringify(body),
                signal: controller.signal
            });
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            logger.logWarn('[htoj] 请求失败:', method, url, reason);
            throw new HtojApiError(-1, `网络请求失败：${reason}`);
        } finally {
            clearTimeout(timer);
        }

        const text = await response.text();
        const elapsed = Date.now() - startedAt;
        let payload;
        try {
            payload = text ? JSON.parse(text) : {};
        } catch (_) {
            logger.logWarn('[htoj] 非 JSON 响应:', response.status, url, String(text).slice(0, 200));
            throw new HtojApiError(response.status, `接口返回了非 JSON 内容（HTTP ${response.status}）`);
        }

        const hasErrCode = payload && typeof payload === 'object' && ('errCode' in payload || 'errcode' in payload);
        if (!hasErrCode) {
            const code = (payload && payload.code != null) ? payload.code : response.status;
            const message = (payload && payload.message) || `请求失败（HTTP ${response.status}）`;
            logger.logWarn('[htoj] 网关错误:', method, url, code, message);
            throw new HtojApiError(code, message);
        }

        const code = payload.errCode !== undefined ? payload.errCode : (payload.errcode != null ? payload.errcode : 0);
        const message = payload.errCode !== undefined
            ? (payload.errMsg != null ? payload.errMsg : '请求失败')
            : (payload.errmsg != null ? payload.errmsg : '请求失败');
        if (code !== 0) {
            logger.logWarn('[htoj] 业务错误:', method, url, code, message, elapsed + 'ms');
            throw new HtojApiError(code, message);
        }

        logger.logInfo('[htoj] <--', method, url, 'ok', elapsed + 'ms');
        return payload.data;
    }

    async request(requestPath, options = {}) {
        const isWrite = options.method !== undefined && options.method !== 'GET';
        const maxAttempts = isWrite ? 1 : 3;
        let lastError;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                return await this.send(requestPath, options);
            } catch (error) {
                lastError = error;
                if (attempt === maxAttempts || !isRetryable(error)) break;
                await delay(700 * attempt);
            }
        }
        throw lastError;
    }

    /** 供渲染进程调用的通用请求：返回统一信封，不抛异常。 */
    async requestEnvelope(payload = {}) {
        try {
            const data = await this.request(payload.path, payload);
            return { ok: true, data };
        } catch (error) {
            if (error instanceof HtojApiError) {
                return {
                    ok: false,
                    code: error.code,
                    message: error.message,
                    unauthorized: error.code === 401
                };
            }
            return { ok: false, code: -1, message: (error && error.message) || '请求失败' };
        }
    }

    async userMe() {
        return this.request('/api/htoj-biz-gateway/api/get-user-info', { query: { distinguish: 1 } });
    }

    /** 用 token 登录：先校验再落盘，失败回滚旧 token。 */
    async loginWithToken(rawToken) {
        const token = String(rawToken == null ? '' : rawToken).trim();
        if (!token) throw new HtojApiError(-1, 'Token 不能为空');
        const cfg = this.ensureCfg();
        const previous = cfg.token;
        cfg.token = token;
        try {
            const user = await this.userMe();
            cfg.user = user || null;
            cfg.savedAt = Date.now();
            this.saveSettings();
            this.broadcast({ type: 'login', loggedIn: true, user: user || null, zone: this.zone });
            return user;
        } catch (error) {
            if (previous) {
                cfg.token = previous;
            } else {
                delete cfg.token;
            }
            throw error;
        }
    }

    async loginByPassword(phoneNumber, password) {
        const data = await this.request('/login/v2/account/oauth/password', {
            method: 'POST',
            base: HETAO_API_BASE,
            siteScoped: false,
            headers: AUTH_HEADERS,
            body: {
                phoneNumber: encodeCredential(phoneNumber),
                password: encodeCredential(password),
                countryCode: '86',
                short: 'CN'
            }
        });
        const token = data && (data.token || data.accessToken);
        if (!token) throw new HtojApiError(-1, '登录失败：服务端未返回 token');
        return this.loginWithToken(token);
    }

    async qrCreate() {
        return this.request('/login/v1/wechat/miniprogram/qrcode', {
            base: HETAO_API_BASE,
            siteScoped: false,
            query: { mode: 'htbcxas' },
            headers: AUTH_HEADERS
        });
    }

    async qrCheck(sessionId) {
        return this.request('/login/v1/wechat/miniprogram/loginCheck', {
            base: HETAO_API_BASE,
            siteScoped: false,
            query: { sid: sessionId },
            headers: AUTH_HEADERS
        });
    }

    async refreshUser() {
        const user = await this.userMe();
        const cfg = this.ensureCfg();
        cfg.user = user || null;
        this.saveSettings();
        this.broadcast({ type: 'user', loggedIn: true, user: cfg.user, zone: this.zone });
        return cfg.user;
    }

    logout() {
        const root = this.getSettings();
        if (root.htoj && typeof root.htoj === 'object') {
            delete root.htoj.token;
            delete root.htoj.user;
        }
        this.saveSettings();
        this.broadcast({ type: 'logout', loggedIn: false });
    }

    setZone(zone) {
        const cfg = this.ensureCfg();
        cfg.zone = zone === 'python' ? 'python' : 'cpp';
        this.saveSettings();
        this.broadcast({ type: 'zone', zone: cfg.zone });
        return cfg.zone;
    }

    loginStatus() {
        return {
            loggedIn: !!this.token,
            user: this.cfg.user || null,
            zone: this.zone,
            home: HTOJ_HOME
        };
    }
}

const IMAGE_CACHE = new Map();

/** 头像等 CDN 图片有防盗链（无 Referer 返回 403），在主进程带 Referer 拉取后转 data URL。 */
async function fetchRemoteImage(url) {
    const key = String(url || '').trim();
    if (!/^https?:\/\//i.test(key)) return null;
    if (IMAGE_CACHE.has(key)) return IMAGE_CACHE.get(key);
    const controller = new AbortController();
    const timer = setTimeout(() => { try { controller.abort(); } catch (_) { } }, 15000);
    try {
        const response = await fetch(key, {
            headers: { Referer: 'https://htoj.com.cn/', 'User-Agent': 'Mozilla/5.0' },
            signal: controller.signal
        });
        if (!response.ok) {
            logger.logWarn('[htoj] 图片拉取失败:', response.status, key);
            return null;
        }
        const type = (response.headers.get('content-type') || 'image/jpeg').split(';')[0];
        const buffer = Buffer.from(await response.arrayBuffer());
        const dataUrl = `data:${type};base64,${buffer.toString('base64')}`;
        IMAGE_CACHE.set(key, dataUrl);
        return dataUrl;
    } catch (error) {
        logger.logWarn('[htoj] 图片拉取异常:', key, (error && error.message) || error);
        return null;
    } finally {
        clearTimeout(timer);
    }
}

function registerHtojIpc({ ipcMain, getSettings, saveSettings, getMainWindow }) {
    const service = new HtojService({ getSettings, saveSettings, getMainWindow });

    const wrap = (handler) => async (_event, ...args) => {
        try {
            return await handler(...args);
        } catch (error) {
            if (error instanceof HtojApiError) {
                return { ok: false, code: error.code, message: error.message, unauthorized: error.code === 401 };
            }
            return { ok: false, code: -1, message: (error && error.message) || '请求失败' };
        }
    };

    ipcMain.handle('htoj-request', (_event, payload) => service.requestEnvelope(payload || {}));
    ipcMain.handle('htoj-login-status', () => service.loginStatus());
    ipcMain.handle('htoj-get-config', () => ({ zone: service.zone, apiBase: service.apiBase, home: HTOJ_HOME }));
    ipcMain.handle('htoj-set-zone', (_event, zone) => {
        const resolved = service.setZone(zone);
        return { ok: true, zone: resolved };
    });
    ipcMain.handle('htoj-logout', () => {
        service.logout();
        return { ok: true };
    });
    ipcMain.handle('htoj-login-token', wrap(async (token) => {
        const user = await service.loginWithToken(token);
        return { ok: true, user: user || null };
    }));
    ipcMain.handle('htoj-login-password', wrap(async (phoneNumber, password) => {
        const user = await service.loginByPassword(phoneNumber, password);
        return { ok: true, user: user || null };
    }));
    ipcMain.handle('htoj-refresh-user', wrap(async () => {
        const user = await service.refreshUser();
        return { ok: true, user: user || null };
    }));
    ipcMain.handle('htoj-qr-create', wrap(async () => {
        const data = await service.qrCreate();
        return { ok: true, ticketBase64: data && data.ticketBase64, sessionId: data && data.sessionId };
    }));
    ipcMain.handle('htoj-qr-check', wrap(async (sessionId) => {
        const data = await service.qrCheck(sessionId);
        return {
            ok: true,
            qrCodeStatus: data && data.qrCodeStatus,
            token: data && data.token,
            userInfo: data && data.userInfo
        };
    }));
    ipcMain.handle('htoj-fetch-image', async (_event, url) => {
        const dataUrl = await fetchRemoteImage(url);
        return dataUrl ? { ok: true, dataUrl } : { ok: false };
    });

    logger.logInfo('[htoj] IPC 已注册');
    return service;
}

module.exports = {
    registerHtojIpc,
    HtojService,
    HtojApiError,
    encodeCredential,
    DEFAULT_API_BASE,
    HETAO_API_BASE,
    HTOJ_HOME
};
