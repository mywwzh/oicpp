const https = require('https');
const http = require('http');
const { URL } = require('url');
const fs = require('fs');
const path = require('path');
const os = require('os');

const LUOGU_BASE_URL = 'https://www.luogu.com.cn';
const LUOGU_API_URL = '/api';
const LUOGU_WS_URL = 'wss://ws.luogu.com.cn/ws';

const LUOGU_DATA_DIR = path.join(os.homedir(), '.oicpp', 'luogu');
const LUOGU_COOKIE_FILE = path.join(LUOGU_DATA_DIR, 'cookie.json');

const CSRF_TOKEN_REGEX = /<meta name="csrf-token" content="(.*)">/;

let csrfCache = null;
let cookieCache = null;

function ensureDataDir() {
    if (!fs.existsSync(LUOGU_DATA_DIR)) {
        fs.mkdirSync(LUOGU_DATA_DIR, { recursive: true });
    }
}

function saveCookie(cookie) {
    ensureDataDir();
    cookieCache = cookie;
    fs.writeFileSync(LUOGU_COOKIE_FILE, JSON.stringify(cookie, null, 2), 'utf-8');
}

function loadCookie() {
    if (cookieCache) return cookieCache;
    try {
        if (fs.existsSync(LUOGU_COOKIE_FILE)) {
            const data = fs.readFileSync(LUOGU_COOKIE_FILE, 'utf-8');
            cookieCache = JSON.parse(data);
            return cookieCache;
        }
    } catch (e) {
        console.error('加载洛谷 Cookie 失败:', e);
    }
    return null;
}

function clearCookie() {
    cookieCache = null;
    csrfCache = null;
    try {
        if (fs.existsSync(LUOGU_COOKIE_FILE)) {
            fs.unlinkSync(LUOGU_COOKIE_FILE);
        }
    } catch (e) { }
}

function cookieToString(cookie) {
    if (!cookie) return '';
    return `_uid=${cookie.uid || 0};__client_id=${cookie.clientID || ''}`;
}

function parseCookie(setCookieHeaders) {
    const result = {};
    if (!setCookieHeaders || !Array.isArray(setCookieHeaders)) return result;
    for (const cookieInfo of setCookieHeaders) {
        if (cookieInfo.includes('_uid=')) {
            const match = cookieInfo.match(/_uid=([^;]+)/);
            if (match) result.uid = parseInt(match[1]);
        }
        if (cookieInfo.includes('__client_id=')) {
            const match = cookieInfo.match(/__client_id=([^;]+)/);
            if (match) result.clientID = match[1];
        }
    }
    return result;
}

function httpRequest(options, body = null) {
    return new Promise((resolve, reject) => {
        const url = new URL(options.url || `${options.protocol || 'https:'}//${options.hostname}${options.path}`);
        const isHttps = url.protocol === 'https:';
        const lib = isHttps ? https : http;

        const reqOptions = {
            hostname: url.hostname,
            port: url.port || (isHttps ? 443 : 80),
            path: url.pathname + url.search,
            method: options.method || 'GET',
            headers: options.headers || {},
            timeout: options.timeout || 15000
        };

        const req = lib.request(reqOptions, (res) => {
            let data = '';
            const chunks = [];
            
            res.on('data', (chunk) => {
                if (Buffer.isBuffer(chunk)) {
                    chunks.push(chunk);
                } else {
                    data += chunk;
                }
            });
            
            res.on('end', () => {
                let responseData;
                if (chunks.length > 0) {
                    responseData = Buffer.concat(chunks);
                } else {
                    responseData = data;
                }
                resolve({
                    status: res.statusCode,
                    headers: res.headers,
                    data: responseData
                });
            });
        });

        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy(new Error('请求超时'));
        });

        if (body) {
            req.write(body);
        }
        req.end();
    });
}

async function luoguRequest(path, options = {}) {
    const cookie = loadCookie();
    const headers = {
        'User-Agent': 'OICPP-IDE/1.0',
        'X-Requested-With': 'XMLHttpRequest',
        'Referer': LUOGU_BASE_URL + '/',
        ...options.headers
    };

    if (cookie) {
        headers['Cookie'] = cookieToString(cookie);
    }

    if (options.method !== 'GET' && csrfCache) {
        headers['X-CSRF-Token'] = csrfCache;
    }

    if (path.includes('_contentOnly')) {
        headers['x-lentille-request'] = 'content-only';
    }

    const response = await httpRequest({
        url: LUOGU_BASE_URL + path,
        method: options.method || 'GET',
        headers,
        timeout: options.timeout || 15000
    }, options.body ? JSON.stringify(options.body) : null);

    if (response.headers['set-cookie']) {
        const newCookie = parseCookie(response.headers['set-cookie']);
        if (newCookie.uid || newCookie.clientID) {
            const oldCookie = loadCookie() || {};
            saveCookie({
                uid: newCookie.uid || oldCookie.uid,
                clientID: newCookie.clientID || oldCookie.clientID
            });
        }
    }

    let data = response.data;
    if (Buffer.isBuffer(data)) {
        data = data.toString('utf-8');
    }
    
    try {
        response.data = JSON.parse(data);
    } catch (e) {
        response.data = data;
    }

    return response;
}

async function genClientID() {
    const response = await httpRequest({
        url: LUOGU_BASE_URL + '/auth/login',
        method: 'GET',
        headers: {
            'User-Agent': 'OICPP-IDE/1.0'
        },
        timeout: 10000
    });
    
    const cookie = parseCookie(response.headers['set-cookie']);
    return cookie.clientID;
}

async function fetchCsrfToken() {
    try {
        const response = await luoguRequest('/ranking');
        const html = response.data;
        const match = CSRF_TOKEN_REGEX.exec(html);
        if (match) {
            csrfCache = match[1].trim();
            return csrfCache;
        }
    } catch (e) {
        console.error('获取 CSRF Token 失败:', e);
    }
    return null;
}

async function getLoginCaptcha() {
    const cookie = loadCookie();
    const response = await httpRequest({
        url: LUOGU_BASE_URL + '/lg4/captcha',
        method: 'GET',
        headers: {
            'User-Agent': 'OICPP-IDE/1.0',
            'Cookie': cookie ? cookieToString(cookie) : '',
            'Referer': LUOGU_BASE_URL + '/'
        },
        timeout: 10000
    });
    
    return response.data;
}

async function login(username, password, captcha) {
    let cookie = loadCookie();
    if (!cookie || !cookie.clientID) {
        const clientID = await genClientID();
        cookie = { uid: 0, clientID };
    }

    if (username.match(/^1[0-9]{10}$/)) {
        username = '+86' + username;
    }

    const response = await httpRequest({
        url: LUOGU_BASE_URL + '/do-auth/password',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'OICPP-IDE/1.0',
            'Cookie': cookieToString(cookie),
            'Referer': LUOGU_BASE_URL + '/',
            'X-Requested-With': 'XMLHttpRequest'
        },
        timeout: 15000
    }, JSON.stringify({ username, password, captcha }));

    const setCookie = response.headers['set-cookie'];
    const newCookie = parseCookie(setCookie);
    
    let responseData;
    try {
        responseData = JSON.parse(response.data.toString());
    } catch (e) {
        responseData = { errorMessage: '解析响应失败' };
    }

    if (response.status === 200 && newCookie.uid) {
        saveCookie({
            uid: newCookie.uid,
            clientID: newCookie.clientID || cookie.clientID
        });
        await fetchCsrfToken();
        
        return {
            success: true,
            uid: newCookie.uid,
            locked: responseData.locked || false
        };
    }

    return {
        success: false,
        errorMessage: responseData.errorMessage || '登录失败',
        locked: responseData.locked || false
    };
}

async function unlock2FA(code) {
    const cookie = loadCookie();
    if (!cookie) {
        return { success: false, errorMessage: '请先登录' };
    }

    await fetchCsrfToken();
    
    const response = await httpRequest({
        url: LUOGU_BASE_URL + '/do-auth/totp',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'OICPP-IDE/1.0',
            'Cookie': cookieToString(cookie),
            'Referer': LUOGU_BASE_URL + '/',
            'X-Requested-With': 'XMLHttpRequest',
            'X-CSRF-Token': csrfCache
        },
        timeout: 15000
    }, JSON.stringify({ code }));

    let responseData;
    try {
        responseData = JSON.parse(response.data.toString());
    } catch (e) {
        responseData = { errorMessage: '解析响应失败' };
    }

    if (response.status === 200 || response.status === 204) {
        return { success: true };
    }

    return {
        success: false,
        errorMessage: responseData.errorMessage || '验证失败'
    };
}

async function checkLoginStatus() {
    const cookie = loadCookie();
    if (!cookie || !cookie.uid || cookie.uid === 0) {
        return { loggedIn: false };
    }

    try {
        const response = await luoguRequest('/auth/login');
        const newCookie = parseCookie(response.headers['set-cookie']);
        
        if (newCookie.uid === cookie.uid) {
            const userInfo = await getUserInfo(cookie.uid);
            return {
                loggedIn: true,
                uid: cookie.uid,
                user: userInfo
            };
        }
    } catch (e) {
        console.error('检查登录状态失败:', e);
    }

    clearCookie();
    return { loggedIn: false };
}

async function getUserInfo(uid) {
    try {
        const response = await luoguRequest(`/user/${uid}?_contentOnly=1`);
        if (response.data && response.data.currentData && response.data.currentData.user) {
            const user = response.data.currentData.user;
            return {
                uid: user.uid,
                name: user.name,
                slogan: user.slogan || '',
                ccfLevel: user.ccfLevel || 0,
                color: user.color || 'Gray',
                rating: user.rating || null,
                ranking: user.ranking || null
            };
        }
    } catch (e) {
        console.error('获取用户信息失败:', e);
    }
    return null;
}

async function logout() {
    try {
        await luoguRequest('/auth/logout', { method: 'POST' });
    } catch (e) { }
    clearCookie();
    return { success: true };
}

const LANGUAGE_MAP = {
    1: 'Pascal',
    2: 'C',
    3: 'C++98',
    4: 'C++11',
    7: 'Python 3',
    8: 'Java 8',
    11: 'C++14',
    12: 'C++17',
    15: 'Rust',
    25: 'PyPy 3',
    27: 'C++20',
    28: 'C++14 (GCC 9)',
    33: 'Java 21',
    34: 'C++23'
};

const RECORD_STATUS = {
    0: { name: 'Waiting', short: 'WJ', color: '#14558f' },
    1: { name: 'Judging', short: 'Judging', color: '#3498db' },
    2: { name: 'Compile Error', short: 'CE', color: '#fad b14' },
    3: { name: 'Output Limit Exceeded', short: 'OLE', color: '#001277' },
    4: { name: 'Memory Limit Exceeded', short: 'MLE', color: '#001277' },
    5: { name: 'Time Limit Exceeded', short: 'TLE', color: '#001277' },
    6: { name: 'Wrong Answer', short: 'WA', color: '#fb6340' },
    7: { name: 'Runtime Error', short: 'RE', color: '#8e44ad' },
    11: { name: 'Unknown Error', short: 'UKE', color: '#0e1d69' },
    12: { name: 'Accepted', short: 'AC', color: '#52c41a' },
    14: { name: 'Unaccepted', short: 'Unaccepted', color: '#e74c3c' }
};

async function submitCode(pid, code, languageId, enableO2 = false, contestId = null) {
    const cookie = loadCookie();
    if (!cookie || !cookie.uid) {
        return { success: false, errorMessage: '请先登录' };
    }

    await fetchCsrfToken();

    let url = `/fe/api/problem/submit/${pid}`;
    if (contestId) {
        url += `?contestId=${contestId}`;
    }

    try {
        const response = await luoguRequest(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': csrfCache
            },
            body: {
                code: code,
                lang: languageId,
                enableO2: enableO2 ? 1 : 0
            }
        });

        if (response.data && response.data.rid) {
            return {
                success: true,
                rid: response.data.rid
            };
        }

        if (response.data && response.data.errorMessage === '验证码错误') {
            return {
                success: false,
                needCaptcha: true,
                errorMessage: '需要验证码'
            };
        }

        return {
            success: false,
            errorMessage: response.data?.errorMessage || '提交失败'
        };
    } catch (e) {
        return {
            success: false,
            errorMessage: e.message || '网络错误'
        };
    }
}

async function getRecordStatus(rid) {
    const cookie = loadCookie();
    if (!cookie || !cookie.uid) {
        return { success: false, errorMessage: '请先登录' };
    }

    try {
        const response = await luoguRequest(`/record/${rid}?_contentOnly=1`);
        
        if (response.data && response.data.currentData) {
            const record = response.data.currentData.record;
            return {
                success: true,
                record: {
                    id: record.id,
                    status: record.status,
                    statusText: RECORD_STATUS[record.status]?.name || 'Unknown',
                    statusShort: RECORD_STATUS[record.status]?.short || '??',
                    statusColor: RECORD_STATUS[record.status]?.color || '#666',
                    memory: record.memory,
                    time: record.time,
                    score: record.score,
                    language: LANGUAGE_MAP[record.language] || `Lang ${record.language}`,
                    enableO2: record.enableO2,
                    problem: {
                        pid: record.problem?.pid,
                        title: record.problem?.title
                    },
                    submitTime: record.submitTime,
                    detail: record.detail || []
                }
            };
        }

        return {
            success: false,
            errorMessage: '获取记录失败'
        };
    } catch (e) {
        return {
            success: false,
            errorMessage: e.message || '网络错误'
        };
    }
}

async function getRecentRecords() {
    const cookie = loadCookie();
    if (!cookie || !cookie.uid) {
        return { success: false, errorMessage: '请先登录' };
    }

    try {
        const response = await luoguRequest(`/record/list?_contentOnly=1&user=${cookie.uid}`);
        
        if (response.data && response.data.currentData && response.data.currentData.records) {
            const records = response.data.currentData.records;
            const result = Object.values(records.result || {}).map(r => ({
                id: r.id,
                status: r.status,
                statusText: RECORD_STATUS[r.status]?.name || 'Unknown',
                statusShort: RECORD_STATUS[r.status]?.short || '??',
                statusColor: RECORD_STATUS[r.status]?.color || '#666',
                problem: {
                    pid: r.problem?.pid,
                    title: r.problem?.title
                },
                submitTime: r.submitTime
            }));

            return {
                success: true,
                records: result,
                count: records.count
            };
        }

        return {
            success: false,
            errorMessage: '获取记录失败'
        };
    } catch (e) {
        return {
            success: false,
            errorMessage: e.message || '网络错误'
        };
    }
}

async function getProblemData(pid, contestId = null) {
    try {
        let url = `/problem/${pid}?_contentOnly=1`;
        if (contestId) {
            url = `/problem/${pid}?contestId=${contestId}&_contentOnly=1`;
        }

        const response = await luoguRequest(url);

        if (response.data && response.data.data) {
            const data = response.data.data;
            return {
                success: true,
                problem: {
                    pid: data.problem?.pid,
                    title: data.problem?.title,
                    background: data.problem?.background,
                    description: data.problem?.description,
                    inputFormat: data.problem?.inputFormat,
                    outputFormat: data.problem?.outputFormat,
                    samples: data.problem?.samples || [],
                    hint: data.problem?.hint,
                    difficulty: data.problem?.difficulty,
                    tags: data.problem?.tags?.map(t => t.name) || [],
                    timeLimit: data.problem?.timeLimit,
                    memoryLimit: data.problem?.memoryLimit
                }
            };
        }

        return {
            success: false,
            errorMessage: response.data?.errorMessage || '题目不存在'
        };
    } catch (e) {
        return {
            success: false,
            errorMessage: e.message || '网络错误'
        };
    }
}

module.exports = {
    genClientID,
    getLoginCaptcha,
    login,
    unlock2FA,
    checkLoginStatus,
    getUserInfo,
    logout,
    submitCode,
    getRecordStatus,
    getRecentRecords,
    getProblemData,
    LANGUAGE_MAP,
    RECORD_STATUS,
    LUOGU_WS_URL,
    cookieToString,
    loadCookie
};
