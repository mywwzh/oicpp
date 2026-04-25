const os = require('os');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

let pty = null;
let ptyLoadError = null;
let ptyLoadTargets = [];

function tryLoadPty(moduleId) {
    try {
        return require(moduleId);
    } catch (error) {
        ptyLoadError = error;
        return null;
    }
}

function resolvePackagedNodePtyCandidates() {
    const candidates = [];

    // In packaged apps, node-pty native binaries should live under app.asar.unpacked.
    if (process.resourcesPath) {
        candidates.push(path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'node-pty', 'lib', 'index.js'));
    }

    const bundledRoot = path.resolve(__dirname, '..', 'node_modules', 'node-pty');
    candidates.push(path.join(bundledRoot, 'lib', 'index.js'));

    const asarSegment = `${path.sep}app.asar${path.sep}`;
    if (bundledRoot.includes(asarSegment)) {
        candidates.push(
            path.join(
                bundledRoot.replace(asarSegment, `${path.sep}app.asar.unpacked${path.sep}`),
                'lib',
                'index.js'
            )
        );
    }

    return Array.from(new Set(candidates));
}

pty = tryLoadPty('node-pty');
ptyLoadTargets.push('node-pty');

if (!pty) {
    const candidates = resolvePackagedNodePtyCandidates();
    for (const candidate of candidates) {
        ptyLoadTargets.push(candidate);
        if (!fs.existsSync(candidate)) {
            continue;
        }
        pty = tryLoadPty(candidate);
        if (pty) {
            break;
        }
    }
}

class IntegratedTerminalManager {
    constructor(options = {}) {
        this.sessions = new Map();
        this.sendToRenderer = typeof options.sendToRenderer === 'function'
            ? options.sendToRenderer
            : () => {};
    }

    isAvailable() {
        return !!pty || this._isInteractiveFallbackAvailable();
    }

    getStatus() {
        if (pty) {
            return {
                available: true,
                reason: '',
                detail: ''
            };
        }

        if (this._isInteractiveFallbackAvailable()) {
            const message = ptyLoadError
                ? (ptyLoadError.message || String(ptyLoadError))
                : 'node-pty not installed';
            const targetInfo = ptyLoadTargets.length > 0
                ? `\n尝试位置: ${ptyLoadTargets.join(' | ')}`
                : '';

            return {
                available: true,
                reason: 'node-pty 不可用，已启用兼容终端',
                detail: `${message}${targetInfo}`
            };
        }

        if (this._isProcessFallbackAvailable() && process.platform === 'win32') {
            const message = ptyLoadError
                ? (ptyLoadError.message || String(ptyLoadError))
                : 'node-pty not installed';
            const targetInfo = ptyLoadTargets.length > 0
                ? `\n尝试位置: ${ptyLoadTargets.join(' | ')}`
                : '';
            return {
                available: false,
                reason: 'node-pty 不可用（Windows 终端需 PTY 支持）',
                detail: `${message}${targetInfo}\n请重新安装依赖并确保 node-pty 原生模块可加载。`
            };
        }

        const message = ptyLoadError
            ? (ptyLoadError.message || String(ptyLoadError))
            : 'node-pty not installed';
        const targetInfo = ptyLoadTargets.length > 0
            ? `\n尝试位置: ${ptyLoadTargets.join(' | ')}`
            : '';

        return {
            available: false,
            reason: 'node-pty 不可用',
            detail: `${message}${targetInfo}`
        };
    }

    _isProcessFallbackAvailable() {
        return typeof spawn === 'function';
    }

    _isInteractiveFallbackAvailable() {
        if (!this._isProcessFallbackAvailable()) {
            return false;
        }
        // Windows pipe fallback is non-interactive (no readline/history/completion),
        // so it cannot be treated as a usable integrated terminal backend.
        return process.platform !== 'win32';
    }

    _resolveDefaultShell() {
        if (process.platform === 'win32') {
            return process.env.POWERSHELL_EXE || 'powershell.exe';
        }
        if (process.platform === 'darwin') {
            return process.env.SHELL || '/bin/zsh';
        }
        return process.env.SHELL || '/bin/bash';
    }

    _extractExecutablePath(shellValue) {
        const raw = String(shellValue || '').trim();
        if (!raw) {
            return '';
        }

        const quote = raw[0];
        if ((quote === '"' || quote === '\'') && raw.length > 1) {
            const end = raw.indexOf(quote, 1);
            if (end > 1) {
                return raw.slice(1, end).trim();
            }
        }

        const firstSpace = raw.search(/\s/);
        if (firstSpace === -1) {
            return raw;
        }
        return raw.slice(0, firstSpace).trim();
    }

    _buildShellCandidates(preferredShell) {
        const preferred = this._extractExecutablePath(preferredShell);
        const envShell = this._extractExecutablePath(process.env.SHELL);
        const candidates = [];

        const pushCandidate = (value) => {
            const next = this._extractExecutablePath(value);
            if (!next) {
                return;
            }
            if (process.platform === 'win32') {
                const lower = next.toLowerCase();
                if (candidates.some((item) => item.toLowerCase() === lower)) {
                    return;
                }
                candidates.push(next);
                return;
            }
            if (!candidates.includes(next)) {
                candidates.push(next);
            }
        };

        pushCandidate(preferred);

        if (process.platform === 'win32') {
            pushCandidate(envShell);
            pushCandidate(process.env.POWERSHELL_EXE);
            pushCandidate('powershell.exe');
            pushCandidate('pwsh.exe');
            pushCandidate('cmd.exe');
            return candidates;
        }

        pushCandidate(envShell);
        if (process.platform === 'darwin') {
            pushCandidate('/bin/zsh');
        }
        pushCandidate('/bin/bash');
        pushCandidate('/bin/sh');
        return candidates;
    }

    _isUsableShellCandidate(shellPath) {
        const candidate = this._extractExecutablePath(shellPath);
        if (!candidate) {
            return false;
        }

        if (process.platform === 'win32') {
            return true;
        }

        if (!path.isAbsolute(candidate)) {
            return true;
        }

        try {
            fs.accessSync(candidate, fs.constants.X_OK);
            return true;
        } catch (_) {
            return false;
        }
    }

    _resolveDefaultArgs(shellPath) {
        const lower = String(shellPath || '').toLowerCase();
        if (process.platform === 'win32') {
            if (lower.includes('powershell')) {
                return ['-NoLogo'];
            }
            return [];
        }

        return [];
    }

    _resolveFallbackCwd() {
        const candidates = [];
        try {
            candidates.push(process.cwd());
        } catch (_) {
        }

        try {
            candidates.push(os.homedir());
        } catch (_) {
        }

        candidates.push(process.platform === 'win32' ? 'C:\\' : '/');

        for (const candidate of candidates) {
            if (!candidate || typeof candidate !== 'string') {
                continue;
            }
            try {
                const stat = fs.statSync(candidate);
                if (stat.isDirectory()) {
                    return candidate;
                }
            } catch (_) {
            }
        }

        return process.platform === 'win32' ? 'C:\\' : '/';
    }

    _resolveCwd(candidate) {
        const fallback = this._resolveFallbackCwd();
        if (!candidate || typeof candidate !== 'string') {
            return fallback;
        }
        const trimmed = candidate.trim();
        if (!trimmed) {
            return fallback;
        }

        try {
            const stat = fs.statSync(trimmed);
            return stat.isDirectory() ? trimmed : fallback;
        } catch (_) {
            return fallback;
        }
    }

    _buildSpawnEnv() {
        const nextEnv = {};
        for (const [key, value] of Object.entries(process.env || {})) {
            if (typeof key !== 'string' || !key) {
                continue;
            }
            if (value === undefined || value === null) {
                continue;
            }
            nextEnv[key] = typeof value === 'string' ? value : String(value);
        }

        if (process.platform === 'darwin') {
            // Avoid inheriting parent Terminal.app/iTerm session identity into embedded shells.
            delete nextEnv.TERM_SESSION_ID;
            delete nextEnv.SECURITYSESSIONID;
            delete nextEnv.ITERM_SESSION_ID;
            nextEnv.TERM_PROGRAM = 'oicpp';
            nextEnv.TERM_PROGRAM_VERSION = 'embedded';
        }

        if (process.platform === 'win32') {
            if (!nextEnv.LANG) {
                nextEnv.LANG = 'zh_CN.UTF-8';
            }
            if (!nextEnv.LC_ALL) {
                nextEnv.LC_ALL = 'C.UTF-8';
            }
            if (!nextEnv.PYTHONIOENCODING) {
                nextEnv.PYTHONIOENCODING = 'utf-8';
            }
        }

        nextEnv.TERM = 'xterm-256color';
        return nextEnv;
    }

    _resolveProcessFallbackArgs(shellPath, requestedArgs) {
        if (Array.isArray(requestedArgs) && requestedArgs.length > 0) {
            return requestedArgs;
        }

        const lower = String(shellPath || '').toLowerCase();
        if (process.platform === 'win32') {
            if (lower.includes('powershell') || lower.includes('pwsh')) {
                return ['-NoLogo', '-NoExit'];
            }
            if (lower.includes('cmd.exe')) {
                return ['/K'];
            }
            return [];
        }

        // No PTY mode must avoid forcing interactive flags, otherwise zsh/bash may fail with TTY read errors.
        return [];
    }

    _resolveProcessFallbackSpawnSpec(shellPath, args) {
        const normalizedArgs = Array.isArray(args) ? args : [];

        const quotePosixArg = (value) => {
            const text = String(value ?? '');
            if (!text) {
                return "''";
            }
            return `'${text.replace(/'/g, `'"'"'`)}'`;
        };

        const buildPosixCommand = () => {
            const chunks = [quotePosixArg(shellPath), ...normalizedArgs.map((item) => quotePosixArg(item))];
            return chunks.join(' ');
        };

        if (process.platform === 'linux') {
            const scriptCandidates = ['/usr/bin/script', '/bin/script'];
            for (const scriptBin of scriptCandidates) {
                try {
                    fs.accessSync(scriptBin, fs.constants.X_OK);
                    return {
                        command: scriptBin,
                        args: ['-q', '-f', '-c', buildPosixCommand(), '/dev/null'],
                        wrappedWithScript: true
                    };
                } catch (_) {
                }
            }
        }

        if (process.platform === 'darwin') {
            const scriptBin = '/usr/bin/script';
            try {
                const stat = fs.statSync(scriptBin);
                if (stat.isFile()) {
                    return {
                        command: scriptBin,
                        args: ['-q', '/dev/null', shellPath, ...normalizedArgs],
                        wrappedWithScript: true
                    };
                }
            } catch (_) {
            }
        }

        return {
            command: shellPath,
            args: normalizedArgs,
            wrappedWithScript: false
        };
    }

    _runShellPreflight(shellPath, args, cwd, env) {
        if (process.platform !== 'darwin') {
            return { ok: true, detail: '' };
        }

        try {
            const testArgs = Array.isArray(args) ? args.slice() : [];
            const quotedMarker = '__oicpp_preflight__';
            if (shellPath.toLowerCase().includes('powershell')) {
                testArgs.push('-Command', `Write-Output ${quotedMarker}`);
            } else {
                testArgs.push('-c', `echo ${quotedMarker}`);
            }
            const result = spawnSync(shellPath, testArgs, {
                cwd,
                env,
                encoding: 'utf8',
                timeout: 2500,
                windowsHide: true
            });

            if (result.error) {
                return {
                    ok: false,
                    detail: result.error.message || String(result.error)
                };
            }

            if (typeof result.status === 'number' && result.status !== 0) {
                const stderr = String(result.stderr || '').trim();
                return {
                    ok: false,
                    detail: stderr || `exit=${result.status}`
                };
            }

            return { ok: true, detail: '' };
        } catch (error) {
            return {
                ok: false,
                detail: error?.message || String(error)
            };
        }
    }

    _spawnProcessFallbackSession({ shellPath, requestedArgs, cwd, env, cols, rows, name }) {
        const args = this._resolveProcessFallbackArgs(shellPath, requestedArgs);
        const preflight = this._runShellPreflight(shellPath, [], cwd, env);
        if (!preflight.ok) {
            const err = new Error(`兼容终端预检查失败: ${preflight.detail}`);
            err.code = 'SHELL_PREFLIGHT_FAILED';
            throw err;
        }

        const spawnSpec = this._resolveProcessFallbackSpawnSpec(shellPath, args);

        const child = spawn(spawnSpec.command, spawnSpec.args, {
            cwd,
            env,
            windowsHide: true,
            stdio: ['pipe', 'pipe', 'pipe']
        });

        const sessionId = crypto.randomUUID();
        const session = {
            id: sessionId,
            shell: shellPath,
            cwd,
            cols,
            rows,
            createdAt: Date.now(),
            backend: 'process',
            process: child,
            wrappedWithScript: !!spawnSpec.wrappedWithScript,
            name: typeof name === 'string' && name.trim()
                ? name.trim()
                : `${os.userInfo().username}@${os.hostname()}`
        };

        this.sessions.set(sessionId, session);

        const onData = (data) => {
            this.sendToRenderer('terminal-data', {
                terminalId: sessionId,
                data: typeof data === 'string' ? data : Buffer.from(data || '').toString('utf8')
            });
        };

        child.stdout?.on('data', onData);
        child.stderr?.on('data', onData);

        child.on('error', (error) => {
            this.sendToRenderer('terminal-data', {
                terminalId: sessionId,
                data: `\r\n[Error] 兼容终端进程异常: ${error?.message || String(error)}\r\n`
            });
        });

        child.on('close', (code, signal) => {
            this.sessions.delete(sessionId);
            this.sendToRenderer('terminal-exit', {
                terminalId: sessionId,
                exitCode: typeof code === 'number' ? code : null,
                signal: signal || null
            });
        });

        return {
            terminalId: sessionId,
            shell: shellPath,
            cwd,
            name: session.name,
            cols,
            rows,
            pid: child.pid,
            backend: 'process'
        };
    }

    createSession(options = {}) {
        if (!this.isAvailable()) {
            const status = this.getStatus();
            const err = new Error(`${status.reason}: ${status.detail}`);
            err.code = 'TERMINAL_UNAVAILABLE';
            throw err;
        }

        const requestedShell = typeof options.shell === 'string' && options.shell.trim()
            ? options.shell.trim()
            : this._resolveDefaultShell();
        const requestedArgs = Array.isArray(options.args) && options.args.length > 0
            ? options.args
            : null;
        const shellCandidates = this._buildShellCandidates(requestedShell)
            .filter((candidate) => this._isUsableShellCandidate(candidate));
        const cols = Number.isFinite(Number(options.cols)) ? Math.max(40, Math.floor(Number(options.cols))) : 120;
        const rows = Number.isFinite(Number(options.rows)) ? Math.max(8, Math.floor(Number(options.rows))) : 30;
        const cwd = this._resolveCwd(options.cwd);
        const spawnEnv = this._buildSpawnEnv();

        if (shellCandidates.length === 0) {
            const err = new Error('未找到可用的 shell 候选项');
            err.code = 'SHELL_UNAVAILABLE';
            throw err;
        }

        if (!pty) {
            if (!this._isInteractiveFallbackAvailable()) {
                const status = this.getStatus();
                const err = new Error(`${status.reason}: ${status.detail}`);
                err.code = 'TERMINAL_REQUIRES_PTY';
                throw err;
            }
            const fallbackErrors = [];
            for (const fallbackShell of shellCandidates) {
                try {
                    return this._spawnProcessFallbackSession({
                        shellPath: fallbackShell,
                        requestedArgs,
                        cwd,
                        env: spawnEnv,
                        cols,
                        rows,
                        name: options.name
                    });
                } catch (fallbackError) {
                    fallbackErrors.push(`${fallbackShell} -> ${fallbackError?.message || String(fallbackError)}`);
                }
            }

            const err = new Error(`兼容终端启动失败: ${fallbackErrors.join(' || ') || '未知错误'}`);
            err.code = 'PROCESS_FALLBACK_FAILED';
            throw err;
        }

        let ptyProcess = null;
        let activeShell = shellCandidates[0];
        let activeArgs = requestedArgs || this._resolveDefaultArgs(activeShell);
        let lastSpawnError = null;
        const spawnErrors = [];

        for (let index = 0; index < shellCandidates.length; index += 1) {
            const candidateShell = shellCandidates[index];
            const candidateArgs = (requestedArgs && index === 0)
                ? requestedArgs
                : this._resolveDefaultArgs(candidateShell);
            const attempts = [candidateArgs];

            if (process.platform !== 'win32' && Array.isArray(candidateArgs) && candidateArgs.length > 0) {
                attempts.push([]);
            }

            for (const argsAttempt of attempts) {
                try {
                    ptyProcess = pty.spawn(candidateShell, argsAttempt, {
                        name: 'xterm-256color',
                        cols,
                        rows,
                        cwd,
                        env: spawnEnv,
                        useConpty: process.platform === 'win32'
                    });
                    activeShell = candidateShell;
                    activeArgs = argsAttempt;
                    break;
                } catch (error) {
                    lastSpawnError = error;
                    const errMsg = error?.message || String(error);
                    spawnErrors.push(`${candidateShell} ${JSON.stringify(argsAttempt)} -> ${errMsg}`);
                }
            }

            if (ptyProcess) {
                break;
            }
        }

        if (!ptyProcess) {
            const fallbackErrors = [];
            for (const candidateShell of shellCandidates) {
                try {
                    return this._spawnProcessFallbackSession({
                        shellPath: candidateShell,
                        requestedArgs,
                        cwd,
                        env: spawnEnv,
                        cols,
                        rows,
                        name: options.name
                    });
                } catch (fallbackError) {
                    fallbackErrors.push(`${candidateShell} -> ${fallbackError?.message || String(fallbackError)}`);
                }
            }

            const detail = lastSpawnError
                ? (lastSpawnError.message || String(lastSpawnError))
                : '未知错误';
            const attempted = shellCandidates.join(' | ');
            const trace = spawnErrors.length > 0 ? `; node-pty: ${spawnErrors.join(' || ')}` : '';
            const fallbackTrace = fallbackErrors.length > 0 ? `; 兼容终端: ${fallbackErrors.join(' || ')}` : '';
            const err = new Error(`启动 shell 失败: ${detail}. 尝试候选: ${attempted}${trace}${fallbackTrace}`);
            err.code = 'SHELL_SPAWN_FAILED';
            throw err;
        }

        const sessionId = crypto.randomUUID();

        const session = {
            id: sessionId,
            shell: activeShell,
            cwd,
            cols,
            rows,
            createdAt: Date.now(),
            backend: 'pty',
            pty: ptyProcess,
            name: typeof options.name === 'string' && options.name.trim()
                ? options.name.trim()
                : `${os.userInfo().username}@${os.hostname()}`
        };

        this.sessions.set(sessionId, session);

        ptyProcess.onData((data) => {
            this.sendToRenderer('terminal-data', {
                terminalId: sessionId,
                data
            });
        });

        ptyProcess.onExit((event = {}) => {
            this.sessions.delete(sessionId);
            this.sendToRenderer('terminal-exit', {
                terminalId: sessionId,
                exitCode: event.exitCode,
                signal: event.signal
            });
        });

        return {
            terminalId: sessionId,
            shell: activeShell,
            cwd,
            name: session.name,
            cols,
            rows,
            pid: ptyProcess.pid,
            backend: 'pty'
        };
    }

    write(terminalId, data) {
        const session = this.sessions.get(terminalId);
        if (!session) {
            return false;
        }

        if (session.backend === 'process') {
            if (!session.process || !session.process.stdin || session.process.killed) {
                return false;
            }
            try {
                session.process.stdin.write(String(data ?? ''));
                return true;
            } catch (_) {
                return false;
            }
        }

        if (!session.pty) {
            return false;
        }

        session.pty.write(String(data ?? ''));
        return true;
    }

    resize(terminalId, cols, rows) {
        const session = this.sessions.get(terminalId);
        if (!session) {
            return false;
        }
        const nextCols = Number.isFinite(Number(cols)) ? Math.max(20, Math.floor(Number(cols))) : session.cols;
        const nextRows = Number.isFinite(Number(rows)) ? Math.max(6, Math.floor(Number(rows))) : session.rows;
        session.cols = nextCols;
        session.rows = nextRows;

        if (session.backend === 'process') {
            return true;
        }

        if (!session.pty) {
            return false;
        }

        session.pty.resize(nextCols, nextRows);
        return true;
    }

    kill(terminalId) {
        const session = this.sessions.get(terminalId);
        if (!session) {
            return false;
        }

        if (session.backend === 'process') {
            try {
                if (session.process && !session.process.killed) {
                    session.process.kill();
                }
            } catch (_) {}
            this.sessions.delete(terminalId);
            return true;
        }

        if (!session.pty) {
            return false;
        }

        try {
            session.pty.kill();
        } catch (_) {}
        this.sessions.delete(terminalId);
        return true;
    }

    listSessions() {
        return Array.from(this.sessions.values()).map((session) => ({
            terminalId: session.id,
            shell: session.shell,
            cwd: session.cwd,
            cols: session.cols,
            rows: session.rows,
            pid: session.backend === 'process' ? session.process?.pid : session.pty?.pid,
            backend: session.backend || 'pty',
            name: session.name,
            createdAt: session.createdAt
        }));
    }

    _resolveSessionPid(session) {
        if (!session) {
            return null;
        }

        const pid = session.backend === 'process'
            ? session.process?.pid
            : session.pty?.pid;
        return Number.isInteger(pid) && pid > 0 ? pid : null;
    }

    _resolvePosixTTYFromPid(pid) {
        if (process.platform === 'darwin') {
            try {
                const ps = spawnSync('ps', ['-p', String(pid), '-o', 'tty='], { encoding: 'utf8' });
                if (ps && ps.status === 0) {
                    const tty = String(ps.stdout || '')
                        .split(/\r?\n/)
                        .map((line) => line.trim())
                        .find((line) => !!line && line !== '?' && line !== '-');
                    if (tty) {
                        return tty.startsWith('/dev/') ? tty : `/dev/${tty}`;
                    }
                }
            } catch (_) {
            }
            return null;
        }

        if (process.platform !== 'linux') {
            return null;
        }

        let candidateFds = [0, 1, 2];
        try {
            const fdDir = `/proc/${pid}/fd`;
            const dynamicFds = fs.readdirSync(fdDir)
                .map((name) => Number.parseInt(name, 10))
                .filter((n) => Number.isInteger(n) && n >= 0);
            candidateFds = Array.from(new Set([...candidateFds, ...dynamicFds])).sort((a, b) => a - b);
        } catch (_) {
        }

        for (const fd of candidateFds) {
            try {
                const fdPath = `/proc/${pid}/fd/${fd}`;
                let linkPath = fs.readlinkSync(fdPath);
                if (!linkPath) {
                    continue;
                }

                if (linkPath.startsWith('/dev/')) {
                    if (/^\/dev\/(pts\/\d+|tty\d+|tty)$/.test(linkPath)) {
                        return linkPath;
                    }
                    if (linkPath === '/dev/ptmx') {
                        continue;
                    }
                }

                try {
                    const realPath = fs.realpathSync(linkPath);
                    if (/^\/dev\/(pts\/\d+|tty\d+|tty)$/.test(realPath)) {
                        return realPath;
                    }
                } catch (_) {
                }
            } catch (_) {
            }
        }

        return null;
    }

    getSessionTTY(terminalId) {
        if (process.platform !== 'linux' && process.platform !== 'darwin') {
            return null;
        }

        const session = this.sessions.get(terminalId);
        if (!session) {
            return null;
        }

        const pid = this._resolveSessionPid(session);
        if (!pid) {
            return null;
        }

        return this._resolvePosixTTYFromPid(pid);
    }

    disposeAll() {
        for (const [id] of this.sessions.entries()) {
            this.kill(id);
        }
        this.sessions.clear();
    }
}

module.exports = IntegratedTerminalManager;
