const { spawn, spawnSync } = require('child_process');
const path = require('path');
const os = require('os');
const EventEmitter = require('events');
const fs = require('fs');
const {
    tokenizeGDBLocals,
    parseGDBWatchValue,
    tokenizeBacktrace
} = require('./gdb-utils');
const GDB_PROMPT = 'oicpp_gdb:';
const FULL_GDB_PROMPT = '>>>>>>' + GDB_PROMPT;
const reThreadSwitch = /^\[Switching to thread .*\]#0[ \t]+(0x[A-Fa-f0-9]+) in (.*) from (.*)/;
const reThreadSwitch2 = /^\[Switching to thread .*\]#0[ \t]+(0x[A-Fa-f0-9]+) in (.*) from (.*):(\d+)/;
const reBreak = /\x1a*([A-Za-z]*[:]*)([^:]+):(\d+):\d+:[begmidl]+:(0x[0-9A-Fa-f]+)/;
const reBreak2 = /^(0x[A-Fa-f0-9]+) in (.*) from (.*)/;
const reBreak3 = /^(0x[A-Fa-f0-9]+) in (.*)/;
const reCatchThrow = /^Catchpoint (\d+) \(exception thrown\), (0x[0-9a-f]+) in (.+) from (.+)$/;
const reCatchThrowNoFile = /^Catchpoint (\d+) \(exception thrown\), (0x[0-9a-f]+) in (.+)$/;
const rePendingFoundWin = /^Pending[ \t]+breakpoint[ \t]+["]+([A-Za-z]:)([^:]+):(\d+)".*/;
const rePendingFoundUnix = /^Pending[ \t]+breakpoint[ \t]+["]+([^:]+):(\d+)".*/;
const rePendingFound1 = /^Breakpoint[ \t]+(\d+),.*/;
const reTempBreakFound = /^[Tt]emporary[ \t]breakpoint[ \t](\d+),.*/;
const reChildPid1 = /Thread[ \t]+[xA-Fa-f0-9-]+[ \t]+\(LWP (\d+)\)\]/;
const reChildPid2 = /\[New [tT]hread[ \t]+\d+\.[xA-Fa-f0-9-]+\]/;
const reInferiorExited = /^\[Inferior[ \t].+[ \t]exited normally\]$/;
const reInferiorExitedWithCode = /^\[[Ii]nferior[ \t].+[ \t]exited[ \t]with[ \t]code[ \t](\d+)\]$/;
class GDBDebugger extends EventEmitter {
    constructor() {
        super();
        this.isRunning = false;
        this.programExited = false;
        this.gdbProcess = null;
        this._variables = { local: {}, global: {}, watches: {} };
        this._callStack = [];
        this._breakpoints = [];
        this._watchExpressions = new Set();
        this._inferiorRunning = false;
        this._cmdQueue = [];
        this._queueBusy = false;
        this._currentCmd = null;
        this._buffer = '';
        this._programStopped = true;
        this._isStarted = false;
        this._manualBreakOnEntry = false;
        this._cursor = { file: '', function: '', address: '', line: -1, changed: false };
        this._ttyProcess = null;
        this._ttyProcessPid = 0;
        this._ttyPath = null;
        this._linuxTTYOptions = {};
        this._ttyShellPid = null;
        this._shortPathCache = new Map();
    }
    _queueCommand(cmd, opts = {}) {
        return new Promise((resolve, reject) => {
            const entry = { cmd, resolve, reject, parser: opts.parser || null, isContinue: !!opts.isContinue };
            if (opts.highPriority) this._cmdQueue.unshift(entry);
            else this._cmdQueue.push(entry);
            this._runQueue();
        });
    }
    _runQueue() {
        if (this._queueBusy || this._cmdQueue.length === 0 || !this._programStopped) return;
        const entry = this._cmdQueue[0];
        if (!entry.cmd) {
            this._cmdQueue.shift();
            if (entry.resolve) entry.resolve();
            this._runQueue();
            return;
        }
        this._queueBusy = true;
        this._currentCmd = entry;
        if (entry.isContinue) {
            this._programStopped = false;
            this._inferiorRunning = true;
            this.emit('running');
        }
        const line = entry.cmd + '\n';
        try { global.logInfo?.('[GDB<<]', line.trim()); } catch (_) { }
        this.gdbProcess.stdin.write(line);
    }
    _send(cmd, opts = {}) { return this._queueCommand(cmd, opts); }
    _sendContinue(cmd, opts = {}) { return this._queueCommand(cmd, { ...opts, isContinue: true }); }
    async start(executablePath, sourcePath, options = {}) {
        if (this.gdbProcess) await this.stop();
        this.programExited = false;
        this._inferiorRunning = false;
        this._programStopped = true;
        this._isStarted = false;
        this._cursor = { file: '', function: '', address: '', line: -1, changed: false };
        this._cmdQueue = [];
        this._queueBusy = false;
        const relaxedInit = !!options.relaxedInit;
        const env = options.env ? { ...process.env, ...options.env } : { ...process.env };
        const gdbExe = options.gdbPath || 'gdb';
        const args = ['-fullname', '-quiet'];
        if (options.disableInit) args.unshift('-nx');
        this.gdbProcess = spawn(gdbExe, args, { stdio: ['pipe', 'pipe', 'pipe'], env, windowsHide: false });
        this.gdbProcess.stdout.on('data', (d) => this._onData(d.toString()));
        this.gdbProcess.stderr.on('data', (d) => {
            const text = d.toString();
            if (text.includes('Failed to set controlling terminal')) return;
            try { global.logWarn?.('[GDB-STDERR]', text); } catch (_) { }
        });
        this.gdbProcess.on('exit', (code, signal) => {
            if (this._buffer) { this._parseOutput(this._buffer); this._buffer = ''; }
            this.isRunning = false; this.programExited = true;
            this._programStopped = true; this._inferiorRunning = false;
            this.emit('exited', { code, signal });
        });
        const runInit = async (cmd) => {
            try { await this._send(cmd); } catch (e) { if (!relaxedInit) throw e; }
        };
        await runInit(`set prompt ${FULL_GDB_PROMPT}`);
        await runInit('show version');
        await runInit('set confirm off');
        await runInit('set width 0');
        await runInit('set height 0');
        await runInit('set breakpoint pending on');
        await runInit('set print asm-demangle on');
        await runInit('set unwindonsignal on');
        await runInit(`set print elements ${options.printElements || 200}`);
        await runInit('set filename-display absolute');
        await runInit('set style enabled off');
        await runInit('set print pretty on');
        await runInit('set print array-indexes on');
        if (process.platform === 'win32') {
            await runInit(`set new-console ${options.noNewConsole ? 'off' : 'on'}`);
        } else if (process.platform === 'linux') {
            this._linuxTTYOptions = {
                inferiorTTY: typeof options.inferiorTTY === 'string' ? options.inferiorTTY : undefined,
                noNewConsole: !!options.noNewConsole,
                consoleTerminalTemplate: typeof options.consoleTerminalTemplate === 'string' ? options.consoleTerminalTemplate : ''
            };
            await this._cleanupLinuxTTY();
            if (this._linuxTTYOptions.inferiorTTY) this._ttyPath = this._linuxTTYOptions.inferiorTTY;
        }
        await this._send(`file "${this._escapePath(executablePath)}"`);
        this.isRunning = true;
        this.emit('started', { executable: executablePath, sourceFile: sourcePath });
    }
    async stop() {
        if (!this.gdbProcess) return;
        try {
            if (this._inferiorRunning) {
                try { process.kill(this.gdbProcess.pid, 'SIGINT'); } catch (_) { }
                await new Promise(r => setTimeout(r, 200));
            }
            await this._send('quit');
        } catch (_) { }
        try { this.gdbProcess.kill(); } catch (_) { }
        this.gdbProcess = null;
        this.isRunning = false;
        this._programStopped = true;
        this._inferiorRunning = false;
        this._queueBusy = false;
        this._cmdQueue = [];
        await this._cleanupLinuxTTY();
    }
    async run() {
        if (this.programExited) throw new Error('Program has exited');
        if (this._inferiorRunning) throw new Error('The program is already running');
        if (this._isStarted && !this.programExited) return this.continue();
        if (process.platform === 'linux') {
            try {
                const tty = await this._ensureLinuxTTY();
                if (tty && tty.ttyPath) await this._send(`set inferior-tty ${tty.ttyPath}`);
            } catch (e) { global.logWarn?.('[GDB] TTY 失败', e); }
        }
        this._isStarted = true;
        this._sendContinue('run').catch(e => global.logWarn?.('[GDB] run 失败:', e?.message || e));
        if ((process.platform === 'linux' || process.platform === 'darwin') && this._ttyPath) {
            this.emit('inferior-started', { pid: 0, ttyPath: this._ttyPath });
        }
    }
    async continue() {
        if (this.programExited) throw new Error('Program has exited');
        if (this._inferiorRunning) throw new Error('The program is already running');
        if (!this._isStarted) return this.run();
        this._manualBreakOnEntry = false;
        this._sendContinue('cont').catch(e => global.logWarn?.('[GDB] cont 失败:', e?.message || e));
    }
    async stepOver() {
        if (this.programExited) throw new Error('Program has exited');
        if (this._inferiorRunning) throw new Error('The program is already running');
        this._manualBreakOnEntry = false;
        this._sendContinue('next').catch(e => global.logWarn?.('[GDB] next 失败:', e?.message || e));
    }
    async stepInto() {
        if (this.programExited) throw new Error('Program has exited');
        if (this._inferiorRunning) throw new Error('The program is already running');
        this._manualBreakOnEntry = false;
        this._sendContinue('step').catch(e => global.logWarn?.('[GDB] step 失败:', e?.message || e));
    }
    async stepOut() {
        if (this.programExited) throw new Error('Program has exited');
        if (this._inferiorRunning) throw new Error('The program is already running');
        this._manualBreakOnEntry = false;
        this._sendContinue('finish').catch(e => global.logWarn?.('[GDB] finish 失败:', e?.message || e));
    }
    async setBreakpoint(file, line) {
        const loc = `${this._escapePath(file)}:${line}`;
        const output = await this._send(`break "${loc}"`);
        const m = /Breakpoint (\d+) at (0x[0-9A-Fa-f]+)/.exec(output || '');
        if (m) {
            const bp = { number: parseInt(m[1], 10), file: this._normalizePath(file), line, address: m[2] };
            this._breakpoints.push(bp);
            this.emit('breakpoint-set', bp);
            return bp;
        }
        const mp = /Breakpoint (\d+)[ \t]\("(.+):(\d+)"\)[ \t]pending\./.exec(output || '');
        if (mp) {
            const bp = { number: parseInt(mp[1], 10), file: this._normalizePath(mp[2]), line: parseInt(mp[3], 10), pending: true };
            this._breakpoints.push(bp);
            this.emit('breakpoint-set', bp);
            return bp;
        }
        throw new Error(output || 'Failed to set breakpoint');
    }
    async removeBreakpoint(number) {
        await this._send(`delete breakpoints ${number}`);
        this._breakpoints = this._breakpoints.filter(b => b.number !== number);
        this.emit('breakpoint-removed', { number });
    }
    async addWatchVariable(expr) { this._watchExpressions.add(expr); await this.updateVariables(); }
    async removeWatchVariable(expr) { this._watchExpressions.delete(expr); delete this._variables.watches[expr]; this.emit('variables-updated', this._variables); }
    async updateVariables() {
        if (!this.isRunning || this._inferiorRunning || this.programExited) return;
        let needsRetry = false;
        try {
            const out = await this._send('info locals');
            if (out && out !== 'No locals.') {
                const parsed = tokenizeGDBLocals(out);
                this._variables.local = {};
                for (const item of parsed) {
                    const e = { name: item.name, value: item.value, type: '', children: [] };
                    parseGDBWatchValue(e, item.value);
                    this._variables.local[item.name] = e;
                }
            }
        } catch (e) { global.logWarn?.('[GDB] 局部变量失败', e); needsRetry = true; }
        if (!this.isRunning || this._inferiorRunning || this.programExited) return;
        try {
            const out = await this._send('info args');
            if (out && out !== 'No arguments.') {
                for (const item of tokenizeGDBLocals(out)) {
                    const e = { name: item.name, value: item.value, type: '', children: [] };
                    parseGDBWatchValue(e, item.value);
                    this._variables.local[item.name] = e;
                }
            }
        } catch (e) { global.logWarn?.('[GDB] 参数失败', e); needsRetry = true; }
        if (!this.isRunning || this._inferiorRunning || this.programExited) return;
        this._variables.watches = {};
        for (const expr of this._watchExpressions) {
            try {
                let typeStr = '';
                try { const t = await this._send(`whatis ${expr}`); if (t && t.startsWith('type = ')) typeStr = t.substring(7).trim(); } catch (_) { }
                const out = await this._send(`output ${expr}`);
                const e = { name: expr, value: out || '', type: typeStr, children: [] };
                parseGDBWatchValue(e, out || '');
                this._variables.watches[expr] = e;
            } catch (_) { this._variables.watches[expr] = { name: expr, value: '<error>', children: [] }; }
        }
        this.emit('variables-updated', this._variables);
        if (needsRetry) setTimeout(() => { if (this.isRunning && !this._inferiorRunning && !this.programExited) this.updateVariables().catch(() => { }); }, 500);
    }
    async updateCallStack() {
        if (!this.isRunning || this._inferiorRunning || this.programExited) return;
        try {
            const out = await this._send('bt 30');
            this._callStack = tokenizeBacktrace(out || '').map(f => ({
                function: f.function || '??', file: this._normalizePath(f.file),
                line: f.line, level: f.level, address: f.address
            }));
            this.emit('callstack-updated', this._callStack);
        } catch (e) { global.logWarn?.('[GDB] 堆栈失败', e); }
    }
    getVariables() { return this._variables; }
    getCallStack() { return this._callStack; }
    async expandVariable(name, options = {}) {
        let root = null;
        const scope = options.scope || 'local';
        if (scope === 'watch' && this._variables.watches[name]) root = this._variables.watches[name];
        else if (scope === 'local' && this._variables.local[name]) root = this._variables.local[name];
        else if (scope === 'global' && this._variables.global[name]) root = this._variables.global[name];
        if (!root) {
            if (this._variables.watches[name]) root = this._variables.watches[name];
            else if (this._variables.local[name]) root = this._variables.local[name];
            else if (this._variables.global[name]) root = this._variables.global[name];
        }
        if (!root) throw new Error(`Variable ${name} not found`);
        if ((!options.path || options.path.length === 0) && (!root.children || root.children.length === 0)) {
            try { const out = await this._send(`output ${name}`); parseGDBWatchValue(root, out || ''); } catch (e) { global.logWarn?.(`[GDB] 无法获取 ${name} 子项`, e); }
        }
        let current = root;
        if (options.path) for (const p of options.path) { const idx = Number(p); if (current.children && current.children[idx]) current = current.children[idx]; else break; }
        return { name, scope, path: options.path, data: current };
    }
    async collapseVariable() { return {}; }
    async sendInput(input) {
        if (!this.gdbProcess || !this.gdbProcess.stdin || !this._inferiorRunning) return false;
        try { const t = String(input ?? '').replace(/\r/g, '\n'); if (t) { this.gdbProcess.stdin.write(t); return true; } } catch (_) { }
        return false;
    }
    _onData(chunk) { this._buffer += chunk; this._parseBuffer(); }
    _parseBuffer() {
        const idx = this._buffer.indexOf(GDB_PROMPT);
        if (idx === -1) {
            if (this._inferiorRunning && this._buffer.length > 0) {
                const nl = this._buffer.lastIndexOf('\n');
                if (nl > 0) { this._emitTargetOutput(this._buffer.substring(0, nl + 1)); this._buffer = this._buffer.substring(nl + 1); }
            }
            return;
        }
        let end = idx;
        while (end > 0 && this._buffer[end - 1] === '>') end--;
        const content = this._buffer.substring(0, end);
        this._buffer = this._buffer.substring(idx + GDB_PROMPT.length);
        const clean = content.replace(/^\n+/, '').replace(/\n+$/, '');
        this._parseOutput(clean);
        if (this._buffer.includes(GDB_PROMPT)) this._parseBuffer();
    }
    _parseOutput(output) {
        this._queueBusy = false;
        const cmd = this._currentCmd;
        const wasContinueCmd = !!(cmd && cmd.isContinue);
        if (cmd) {
            this._cmdQueue.shift(); this._currentCmd = null;
            const result = cmd.parser && output ? cmd.parser(output) : (output || '');
            if (cmd.resolve) cmd.resolve(result);
        }
        if (!output) return;
        try { global.logInfo?.('[GDB>>]', output.substring(0, 500)); } catch (_) { }
        this._detectChildPid(output);
        const lines = output.split('\n');
        const targetLines = [];
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line.startsWith('>>>>>>') || line === GDB_PROMPT) continue;
            if (line.startsWith('GNU gdb')) continue;
            if (line.startsWith('Error creating process') || line.startsWith('Program exited') ||
                line.startsWith('Program terminated with signal') || line.startsWith('During startup program exited') ||
                line.includes('program is not being run') || line.includes('Target detached') ||
                reInferiorExited.test(line) || reInferiorExitedWithCode.test(line)) {
                this._programStopped = true; this._isStarted = false;
                this._inferiorRunning = false; this._queueBusy = false;
                let ec; const mc = reInferiorExitedWithCode.exec(line); if (mc) ec = parseInt(mc[1], 10);
                this.emit('program-exited', { exitCode: ec });
                continue;
            }
            if (line.includes('(no debugging symbols found)')) continue;
            if (line.startsWith('Program received signal SIG')) {
                this._programStopped = true; this._queueBusy = false; this._inferiorRunning = false;
                if (!line.startsWith('Program received signal SIGINT') && !line.startsWith('Program received signal SIGTRAP') && !line.startsWith('Program received signal SIGSTOP'))
                    this.emit('signal-received', { signal: line });
                continue;
            }
            if (line.startsWith('Error ') || line.startsWith('No such') || line.startsWith('Cannot evaluate')) continue;
            if (line.startsWith('Cannot find bounds of current function') || line.startsWith('No stack')) { this._programStopped = true; this._inferiorRunning = false; continue; }
            if (line.startsWith('Pending breakpoint ')) { this._handlePendingBreakpoint(line, lines, i); continue; }
            if (line.startsWith('Breakpoint ') && rePendingFound1.test(line)) continue;
            if (line.startsWith('Temporary breakpoint') && reTempBreakFound.test(line)) continue;
            if (line.length > 0 && line.charCodeAt(0) === 0x1A) { this._handleMainBreakpoint(line); continue; }
            if (this._handleOtherBreakInfo(line)) continue;
            if (this._isGDBInternalNoise(line)) continue;
            if (line.trim()) targetLines.push(line);
        }

        if (targetLines.length > 0 && wasContinueCmd) this._emitTargetOutput(targetLines.join('\n'));
        if (this._cmdQueue.length === 0 && !this._programStopped && !this._cursor.changed) {
            this._programStopped = true; this._inferiorRunning = false;
        }
        if (this._cursor.changed) {
            this._programStopped = true; this._inferiorRunning = false; this._queueBusy = false;
            this.emit('stopped', {
                reason: this._cursor.line >= 0 ? 'breakpoint-hit' : 'signal-received',
                file: this._normalizePath(this._cursor.file),
                line: this._cursor.line, function: this._cursor.function, address: this._cursor.address
            });
            this._cursor.changed = false;
        } else if (this._programStopped) { this._inferiorRunning = false; }
        if (this._programStopped) this._runQueue();
    }
    _detectChildPid(output) {
        if (process.platform === 'win32') {
            const m = reChildPid2.exec(output);
            if (m) { const p = parseInt(m[0].substring(m[0].lastIndexOf(' ') + 1).split('.')[0], 10); if (p > 0) { this.emit('child-pid', p); } }
        } else {
            const m = reChildPid1.exec(output);
            if (m) {
                const p = parseInt(m[1], 10);
                if (p > 0) {
                    this.emit('child-pid', p);
                    const ttyPath = this._ttyPath || '';
                    if (ttyPath) {
                        this.emit('inferior-started', { pid: p, ttyPath: ttyPath });
                    }
                }
            }
        }
    }
    _handleMainBreakpoint(line) {
        const m = reBreak.exec(line.replace(/^\x1a+/, ''));
        if (m) {
            this._manualBreakOnEntry = false;
            this._cursor.file = process.platform === 'win32' ? (m[1] || '') + (m[2] || '') : (m[2] || '');
            this._cursor.line = parseInt(m[3], 10); this._cursor.address = m[4]; this._cursor.changed = true;
        } else { this._cursor.changed = true; }
    }
    _handleOtherBreakInfo(line) {
        let m;
        if ((m = reBreak2.exec(line)) || (m = reThreadSwitch.exec(line))) {
            this._cursor.address = m[1]; this._cursor.function = m[2]; this._cursor.file = m[3]; this._cursor.line = -1; this._cursor.changed = true; return true;
        }
        if ((m = reThreadSwitch2.exec(line))) {
            this._cursor.address = m[1]; this._cursor.function = m[2]; this._cursor.file = m[3]; this._cursor.line = -1; this._cursor.changed = true; return true;
        }
        if ((m = reBreak3.exec(line))) { this._cursor.address = m[1]; this._cursor.function = m[2]; this._cursor.file = ''; this._cursor.line = -1; this._cursor.changed = true; return true; }
        if ((m = reCatchThrow.exec(line))) { this._cursor.address = m[2]; this._cursor.function = m[3]; this._cursor.file = m[4]; this._cursor.line = -1; this._cursor.changed = true; return true; }
        if ((m = reCatchThrowNoFile.exec(line))) { this._cursor.address = m[2]; this._cursor.function = m[3]; this._cursor.file = ''; this._cursor.line = -1; this._cursor.changed = true; return true; }
        return false;
    }
    _handlePendingBreakpoint(line, lines, idx) {
        const rePF = process.platform === 'win32' ? rePendingFoundWin : rePendingFoundUnix;
        const m = rePF.exec(line); if (!m) return;
        let nbp = ''; for (let j = idx + 1; j < lines.length; j++) { if (!lines[j].startsWith('[')) { nbp = lines[j]; break; } }
        if (nbp && rePendingFound1.test(nbp)) {
            const nm = rePendingFound1.exec(nbp); const ni = parseInt(nm[1], 10);
            let f, ls;
            if (process.platform === 'win32') { f = m[1] + m[2]; ls = m[3]; } else { f = m[1]; ls = m[2]; }
            const nl = parseInt(ls, 10);
            const bp = this._breakpoints.find(b => this._normalizePath(b.file) === this._normalizePath(f) && b.line === nl);
            if (bp) { bp.number = ni; bp.pending = false; this.emit('breakpoint-resolved', bp); }
        }
    }
    _emitTargetOutput(text) { const c = String(text || '').replace(/^>+/, '').trim(); if (c) this.emit('target-output', c); }
    _escapePath(p) {
        const t = this._toDebuggerPath(p);
        return os.platform() === 'win32' ? t.replace(/\\/g, '/') : t;
    }
    _normalizePath(p) {
        if (!p) return p || '';
        if (os.platform() === 'win32') { try { const r = fs.realpathSync.native ? fs.realpathSync.native(p) : fs.realpathSync(p); if (r) return r; } catch (_) { } return path.normalize(p); }
        return p;
    }
    _toDebuggerPath(p) {
        if (!p || typeof p !== 'string') return p || '';
        if (os.platform() !== 'win32') return p;
        const n = path.normalize(p);
        if (!/[^\x00-\x7F]/.test(n)) return n;
        try { const s = this._getShortPath(n); if (s && s !== n) return s; } catch (_) { }
        return n;
    }
    _getShortPath(p) {
        if (this._shortPathCache.has(p)) return this._shortPathCache.get(p);
        let sp = p;
        try {
            const cmd = process.env.ComSpec || 'cmd.exe';
            const r = spawnSync(cmd, ['/c', `for %I in ("${p.replace(/"/g, '""')}") do @echo %~sI`], { encoding: 'utf8', windowsHide: true });
            const o = (r && r.stdout) ? String(r.stdout).trim() : '';
            if (o) sp = o;
        } catch (_) { }
        this._shortPathCache.set(p, sp);
        return sp;
    }
    async _cleanupLinuxTTY() {
        if (this._ttyProcessPid) { try { process.kill(this._ttyProcessPid, 'SIGTERM'); } catch (_) { } }
        if (this._ttyProcess) { try { this._ttyProcess.kill(); } catch (_) { } }
        if (this._ttyShellPid) { try { process.kill(this._ttyShellPid, 'SIGTERM'); } catch (_) { } }
        this._ttyProcess = null; this._ttyProcessPid = 0; this._ttyPath = null; this._ttyShellPid = null;
    }
    async _ensureLinuxTTY() {
        if (this._ttyPath) return { ttyPath: this._ttyPath };
        if (this._linuxTTYOptions.noNewConsole) return null;
        if (this._linuxTTYOptions.inferiorTTY) return { ttyPath: this._linuxTTYOptions.inferiorTTY };
        if (!(process.env.DISPLAY || process.env.WAYLAND_DISPLAY || process.env.MIR_SOCKET)) return null;
        const tmpl = String(this._linuxTTYOptions.consoleTerminalTemplate || 'xterm -T \'$TITLE\' -e').trim() || 'xterm -T \'$TITLE\' -e';
        const token = 80000000 + Math.floor(Math.random() * 100000);
        const sleepCmd = `sleep ${token}`;
        let cmd = tmpl.replace(/\$TITLE/g, "'Program Console'");
        cmd = cmd.includes('$SCRIPT') ? cmd.replace(/\$SCRIPT/g, sleepCmd) : `${cmd} ${sleepCmd}`;
        try {
            this._ttyProcess = spawn('/bin/sh', ['-c', cmd], { detached: true, stdio: 'ignore', env: { ...process.env } });
            this._ttyProcessPid = this._ttyProcess.pid || 0; this._ttyProcess.unref();
        } catch (e) { return null; }
        for (let i = 0; i < 100; i++) {
            await new Promise(r => setTimeout(r, 200));
            let po = '';
            try { const ps = spawnSync('ps', ['x', '-o', 'tty,pid,command'], { encoding: 'utf8' }); if (ps && ps.status === 0) po = String(ps.stdout || ''); } catch (_) { }
            if (!po) continue;
            for (const pl of po.split(/\r?\n/)) {
                if (!pl || !pl.includes(sleepCmd) || pl.includes('ps x -o tty,pid,command')) continue;
                const m = pl.trim().match(/^(\S+)\s+(\d+)\s+(.+)$/); if (!m) continue;
                const tr = m[1]; const pid = parseInt(m[2], 10);
                if (!Number.isInteger(pid) || pid <= 0) continue;
                if (this._ttyProcessPid > 0 && pid === this._ttyProcessPid) continue;
                if (!tr || tr === '?' || tr === '-') continue;
                this._ttyPath = tr.startsWith('/dev/') ? tr : `/dev/${tr}`;
                this._ttyShellPid = pid;
                return { ttyPath: this._ttyPath };
            }
        }
        try { if (this._ttyProcessPid > 0) process.kill(this._ttyProcessPid, 'SIGTERM'); } catch (_) { }
        this._ttyProcessPid = 0; this._ttyShellPid = null; this._ttyPath = null;
        return null;
    }

    _isGDBInternalNoise(line) {
        const s = line.trim();
        if (!s) return true;
        if (s.startsWith('Type "show configuration"')) return true;
        if (s.startsWith('For bug reporting')) return true;
        if (s.startsWith('Find the GDB manual')) return true;
        if (s.startsWith('For help, type')) return true;
        if (s.startsWith('Type "apropos word"')) return true;
        if (/^https?:\/\//.test(s) && s.length < 120 && !/\s/.test(s)) return true;
        if (s.startsWith('Reading symbols from')) return true;
        if (s.startsWith('Starting program:')) return true;
        if (/^Breakpoint\s+\d+\s+at\s+/.test(s) && !s.includes('pending')) return true;
        if (/^Thread\s+\d+\s+hit\s+(Breakpoint|Catchpoint)\s+\d+/.test(s)) return true;
        if (s === 'Continuing.') return true;
        if (s === 'No arguments.' || s === 'No locals.') return true;
        if (/^#\d+\s+/.test(s) && /\s+at\s+/.test(s)) return true;
        if (/^\$\d+\s*=/.test(s)) return true;
        if (/^\[New Thread\s/.test(s)) return true;
        if (/^\[Thread\s.*\sexited\]/.test(s)) return true;
        if (/^\[Thread\s.*\sexited\swith\scode/.test(s)) return true;
        if (/^\[Loading\s/.test(s)) return true;
        if (/^\[Switching to thread\s/.test(s)) return true;
        if (/^\d+\t/.test(line)) return true;
        return false;
    }
}
module.exports = GDBDebugger;
