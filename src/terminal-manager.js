const os = require('os');
const crypto = require('crypto');

let pty = null;
let ptyLoadError = null;

try {
    pty = require('node-pty');
} catch (error) {
    ptyLoadError = error;
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

        return {
            available: false,
            reason: 'node-pty 不可用',
            detail: message
        };
    }

    _resolveDefaultShell() {
        if (process.platform === 'win32') {
            return process.env.POWERSHELL_EXE || 'powershell.exe';
        }
        return process.env.SHELL || '/bin/bash';
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

        const shell = typeof options.shell === 'string' && options.shell.trim()
            ? options.shell.trim()
            : this._resolveDefaultShell();
        const args = Array.isArray(options.args) && options.args.length > 0
            ? options.args
            : this._resolveDefaultArgs(shell);
        const cols = Number.isFinite(Number(options.cols)) ? Math.max(40, Math.floor(Number(options.cols))) : 120;
        const rows = Number.isFinite(Number(options.rows)) ? Math.max(8, Math.floor(Number(options.rows))) : 30;
        const cwd = this._resolveCwd(options.cwd);
        const sessionId = crypto.randomUUID();

        const ptyProcess = pty.spawn(shell, args, {
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

        const session = {
            id: sessionId,
            shell,
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
            shell,
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
