const os = require('os');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

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
        return !!pty;
    }

    getStatus() {
        if (this.isAvailable()) {
            return {
                available: true,
                reason: '',
                detail: ''
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

    _resolveDefaultShell() {
        if (process.platform === 'win32') {
            return process.env.POWERSHELL_EXE || 'powershell.exe';
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

    _resolveDefaultArgs(shellPath) {
        const lower = String(shellPath || '').toLowerCase();
        if (process.platform === 'win32') {
            if (lower.includes('powershell')) {
                return ['-NoLogo'];
            }
            return [];
        }

        if (lower.includes('zsh')) {
            return ['-i'];
        }
        return ['-l'];
    }

    _resolveCwd(candidate) {
        const fallback = process.cwd();
        if (!candidate || typeof candidate !== 'string') {
            return fallback;
        }
        const trimmed = candidate.trim();
        if (!trimmed) {
            return fallback;
        }

        try {
            return require('fs').existsSync(trimmed) ? trimmed : fallback;
        } catch (_) {
            return fallback;
        }
    }

    createSession(options = {}) {
        if (!this.isAvailable()) {
            const status = this.getStatus();
            const err = new Error(`${status.reason}: ${status.detail}`);
            err.code = 'PTY_UNAVAILABLE';
            throw err;
        }

        const requestedShell = typeof options.shell === 'string' && options.shell.trim()
            ? options.shell.trim()
            : this._resolveDefaultShell();
        const requestedArgs = Array.isArray(options.args) && options.args.length > 0
            ? options.args
            : null;
        const shellCandidates = this._buildShellCandidates(requestedShell);
        const cols = Number.isFinite(Number(options.cols)) ? Math.max(40, Math.floor(Number(options.cols))) : 120;
        const rows = Number.isFinite(Number(options.rows)) ? Math.max(8, Math.floor(Number(options.rows))) : 30;
        const cwd = this._resolveCwd(options.cwd);
        const sessionId = crypto.randomUUID();

        if (shellCandidates.length === 0) {
            const err = new Error('未找到可用的 shell 候选项');
            err.code = 'SHELL_UNAVAILABLE';
            throw err;
        }

        let ptyProcess = null;
        let activeShell = shellCandidates[0];
        let activeArgs = requestedArgs || this._resolveDefaultArgs(activeShell);
        let lastSpawnError = null;

        for (let index = 0; index < shellCandidates.length; index += 1) {
            const candidateShell = shellCandidates[index];
            const candidateArgs = (requestedArgs && index === 0)
                ? requestedArgs
                : this._resolveDefaultArgs(candidateShell);

            try {
                ptyProcess = pty.spawn(candidateShell, candidateArgs, {
                    name: 'xterm-256color',
                    cols,
                    rows,
                    cwd,
                    env: {
                        ...process.env,
                        TERM: 'xterm-256color'
                    },
                    useConpty: process.platform === 'win32'
                });
                activeShell = candidateShell;
                activeArgs = candidateArgs;
                break;
            } catch (error) {
                lastSpawnError = error;
            }
        }

        if (!ptyProcess) {
            const detail = lastSpawnError
                ? (lastSpawnError.message || String(lastSpawnError))
                : '未知错误';
            const attempted = shellCandidates.join(' | ');
            const err = new Error(`启动 shell 失败: ${detail}. 尝试候选: ${attempted}`);
            err.code = 'SHELL_SPAWN_FAILED';
            throw err;
        }

        const session = {
            id: sessionId,
            shell: activeShell,
            cwd,
            cols,
            rows,
            createdAt: Date.now(),
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
            pid: ptyProcess.pid
        };
    }

    write(terminalId, data) {
        const session = this.sessions.get(terminalId);
        if (!session || !session.pty) {
            return false;
        }
        session.pty.write(String(data ?? ''));
        return true;
    }

    resize(terminalId, cols, rows) {
        const session = this.sessions.get(terminalId);
        if (!session || !session.pty) {
            return false;
        }
        const nextCols = Number.isFinite(Number(cols)) ? Math.max(20, Math.floor(Number(cols))) : session.cols;
        const nextRows = Number.isFinite(Number(rows)) ? Math.max(6, Math.floor(Number(rows))) : session.rows;
        session.cols = nextCols;
        session.rows = nextRows;
        session.pty.resize(nextCols, nextRows);
        return true;
    }

    kill(terminalId) {
        const session = this.sessions.get(terminalId);
        if (!session || !session.pty) {
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
            pid: session.pty?.pid,
            name: session.name,
            createdAt: session.createdAt
        }));
    }

    disposeAll() {
        for (const [id] of this.sessions.entries()) {
            this.kill(id);
        }
        this.sessions.clear();
    }
}

module.exports = IntegratedTerminalManager;
