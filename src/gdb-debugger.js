const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const EventEmitter = require('events');
const { tokenizeGDBLocals, parseGDBWatchValue } = require('./gdb-utils');

class GDBDebugger extends EventEmitter {
    constructor() {
        super();
        this.isRunning = false;
        this.programExited = false;
        this.gdbProcess = null;
        this.buffer = '';
        this.seq = 1;
        this.pending = new Map(); // token -> {resolve, reject, cmd, captureOutput}
        this._variables = { local: {}, global: {}, watches: {} };
        this._callStack = [];
        this._breakpoints = []; // {number, file, line}
        this._watchExpressions = new Set(); // Set<string>
        this._inferiorRunning = false;
        this._inferiorLaunched = false;
        this.inferiorPid = null;
        
        // Linux TTY
        this._ttyProcess = null;
        this._ttyPath = null;
        this._ttyPromise = null;
        this._linuxTTYOptions = {};
        this._ttyShellPid = null;
        this._expectingRunning = false;
    }

    _send(cmd) {
        return new Promise((resolve, reject) => {
            if (!this.gdbProcess) return reject(new Error('GDB process not started'));
            const token = this.seq++;
            this.pending.set(token, { resolve, reject, cmd });
            const line = `${token}-${cmd}\n`;
            try { global.logInfo?.('[GDB<<]', line.trim()); } catch (_) { }
            this.gdbProcess.stdin.write(line);
        });
    }

    async _sendCLI(cmd) {
        return new Promise((resolve, reject) => {
            if (!this.gdbProcess) return reject(new Error('GDB not started'));
            const token = this.seq++;
            
            let output = '';
            const capture = (line) => {
                if (line.startsWith('~')) {
                    try {
                        output += this._unescapeMIString(line.substring(1));
                    } catch (e) {
                        output += line.substring(2, line.length - 1);
                    }
                }
            };
            
            this.pending.set(token, { 
                resolve: (res) => resolve(output), 
                reject, 
                cmd,
                captureOutput: capture 
            });
            
            const line = `${token}-interpreter-exec console "${cmd.replace(/"/g, '\\"')}"\n`;
            try { global.logInfo?.('[GDB<<]', line.trim()); } catch (_) { }
            this.gdbProcess.stdin.write(line);
        });
    }

    _unescapeMIString(str) {
        if (str.startsWith('"') && str.endsWith('"')) {
            str = str.slice(1, -1);
        }
        return str.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }

    async start(executablePath, sourcePath, options = {}) {
        if (this.gdbProcess) await this.stop();
        this.programExited = false;
        this._inferiorLaunched = false;
        this._inferiorRunning = false;
        
        const env = options.env ? { ...process.env, ...options.env } : { ...process.env };
        const gdbExecutable = options.gdbPath || 'gdb';
        
        const args = ['-q', '--interpreter=mi2'];
        this.gdbProcess = spawn(gdbExecutable, args, {
            stdio: ['pipe', 'pipe', 'pipe'],
            env,
            windowsHide: false,
        });

        this.gdbProcess.stdout.on('data', (d) => this._onData(d.toString()));
        this.gdbProcess.stderr.on('data', (d) => {
            try { global.logWarn?.('[GDB-STDERR]', d.toString()); } catch (_) { }
        });
        this.gdbProcess.on('exit', (code, signal) => {
            this.isRunning = false;
            this.programExited = true;
            this._inferiorRunning = false;
            this.emit('exited', { code, signal });
        });

        await this._waitReady();
        
        await this._send('gdb-set confirm off');
        await this._send('gdb-set pagination off');
        await this._send('gdb-set print pretty on');
        await this._send('gdb-set print array-indexes on');
        await this._send('gdb-set print elements 200');
        
        if (process.platform === 'win32') {
            await this._send('gdb-set new-console on');
        } else if (process.platform === 'linux') {
             const opts = options || {};
             this._linuxTTYOptions = {
                 inferiorTTY: typeof opts.inferiorTTY === 'string' ? opts.inferiorTTY : undefined,
                 noNewConsole: !!opts.noNewConsole
             };
             await this._cleanupLinuxTTY();
             if (this._linuxTTYOptions.inferiorTTY) {
                 this._ttyPath = this._linuxTTYOptions.inferiorTTY;
             }
        }

        await this._send(`file-exec-and-symbols "${this._escapePath(executablePath)}"`);
        
        this.isRunning = true;
        this.emit('started', { executable: executablePath, sourceFile: sourcePath });
    }

    async stop() {
        if (!this.gdbProcess) return;
        try {
            if (this._inferiorRunning) {
                try { process.kill(this.gdbProcess.pid, 'SIGINT'); } catch (_) {}
                await new Promise(r => setTimeout(r, 100));
            }
            await this._send('gdb-exit');
        } catch (_) {}
        try { this.gdbProcess.kill(); } catch (_) {}
        this.gdbProcess = null;
        this.isRunning = false;
        this._inferiorRunning = false;
        await this._cleanupLinuxTTY();
    }

    async run() {
        if (this._inferiorLaunched && this._inferiorRunning) return;
        if (this._inferiorLaunched && !this._inferiorRunning && !this.programExited) {
            return this.continue();
        }

        if (process.platform === 'linux') {
            try {
                const ttyInfo = await this._ensureLinuxTTY();
                if (ttyInfo && ttyInfo.ttyPath) {
                    await this._send(`gdb-set inferior-tty ${ttyInfo.ttyPath}`);
                }
            } catch (e) {
                global.logWarn?.('[GDB] TTY 设置失败', e);
            }
        }

        await this._send('exec-run');
        this._inferiorLaunched = true;
        this._inferiorRunning = true;
        this._expectingRunning = true;
        this.emit('running');
    }

    async continue() {
        if (this.programExited) return;
        if (!this._inferiorLaunched) return this.run();
        
        this._expectingRunning = true;
        try {
            await this._send('exec-continue');
        } catch (e) {
            this._expectingRunning = false;
            if (e.message.includes('not stopped')) {
                this._inferiorRunning = true; // Sync state
                this.emit('running');
            }
        }
    }

    async stepOver() { 
        this._expectingRunning = true;
        try { await this._send('exec-next'); } catch(e) { this._expectingRunning = false; throw e; }
    }
    async stepInto() { 
        this._expectingRunning = true;
        try { await this._send('exec-step'); } catch(e) { this._expectingRunning = false; throw e; }
    }
    async stepOut() { 
        this._expectingRunning = true;
        try { await this._send('exec-finish'); } catch(e) { this._expectingRunning = false; throw e; }
    }

    async setBreakpoint(file, line) {
        const location = `${this._escapePath(file)}:${line}`;
        try {
            const res = await this._send(`break-insert -f "${location}"`);
            const bkpt = res.bkpt;
            const b = {
                number: bkpt.number,
                file: this._normalizePath(bkpt.fullname || bkpt.file || file),
                line: parseInt(bkpt.line, 10)
            };
            this._breakpoints.push(b);
            this.emit('breakpoint-set', b);
            return b;
        } catch (e) {
            global.logWarn?.('[GDB] 设置断点失败', e);
            throw e;
        }
    }

    async removeBreakpoint(number) {
        await this._send(`break-delete ${number}`);
        this._breakpoints = this._breakpoints.filter(b => b.number != number);
        this.emit('breakpoint-removed', { number });
    }

    async addWatchVariable(expr) {
        this._watchExpressions.add(expr);
        await this.updateVariables();
    }

    async removeWatchVariable(expr) {
        this._watchExpressions.delete(expr);
        delete this._variables.watches[expr];
        this.emit('variables-updated', this._variables);
    }

    async updateVariables() {
        if (!this.isRunning || this._inferiorRunning) {
            try { global.logInfo?.(`[GDB] updateVariables 跳过: isRunning=${this.isRunning}, inferiorRunning=${this._inferiorRunning}`); } catch (_) { }
            return;
        }

        try {
            const localsOutput = await this._sendCLI('info locals');
            const parsedLocals = tokenizeGDBLocals(localsOutput);
            
            this._variables.local = {};
            for (const item of parsedLocals) {
                const entry = {
                    name: item.name,
                    value: item.value,
                    type: '', 
                    children: []
                };
                parseGDBWatchValue(entry, item.value);
                this._variables.local[item.name] = entry;
            }
        } catch (e) {
            global.logWarn?.('[GDB] 更新局部变量失败', e);
        }

        if (!this.isRunning || this._inferiorRunning) return;

        try {
            const argsOutput = await this._sendCLI('info args');
            const parsedArgs = tokenizeGDBLocals(argsOutput);
            for (const item of parsedArgs) {
                const entry = {
                    name: item.name,
                    value: item.value,
                    type: '',
                    children: []
                };
                parseGDBWatchValue(entry, item.value);
                this._variables.local[item.name] = entry;
            }
        } catch (e) {
             global.logWarn?.('[GDB] 更新参数失败', e);
        }

        if (!this.isRunning || this._inferiorRunning) return;

        this._variables.watches = {};
        for (const expr of this._watchExpressions) {
            try {
                const output = await this._sendCLI(`output ${expr}`);
                try { global.logInfo?.(`[GDB] 监视 ${expr} 输出: ${output}`); } catch (_) { }
                const entry = {
                    name: expr,
                    value: output,
                    type: '',
                    children: []
                };
                
                try {
                    const typeOutput = await this._sendCLI(`whatis ${expr}`);
                    if (typeOutput.startsWith('type = ')) {
                        entry.type = typeOutput.substring(7).trim();
                    }
                } catch (_) {}

                parseGDBWatchValue(entry, output);
                this._variables.watches[expr] = entry;
            } catch (e) {
                this._variables.watches[expr] = { name: expr, value: '<error>', children: [] };
            }
        }

        this.emit('variables-updated', this._variables);
    }
    
    async updateCallStack() {
        try {
            const res = await this._send('stack-list-frames');
            const stack = res.stack || res.frames || [];
            this._callStack = stack.map(f => {
                const frame = f.frame || f;
                return {
                    function: frame.func,
                    file: this._normalizePath(frame.fullname || frame.file),
                    line: parseInt(frame.line, 10),
                    level: parseInt(frame.level, 10)
                };
            });
            this.emit('callstack-updated', this._callStack);
        } catch (e) {
            global.logWarn?.('[GDB] 更新堆栈失败', e);
        }
    }

    getVariables() {
        return this._variables;
    }

    getCallStack() {
        return this._callStack;
    }

    async expandVariable(name, options = {}) {
        let root = null;
        let scope = options.scope || 'local';
        
        if (scope === 'watch' && this._variables.watches && this._variables.watches[name]) {
            root = this._variables.watches[name];
        } else if (scope === 'local' && this._variables.local && this._variables.local[name]) {
            root = this._variables.local[name];
        } else if (scope === 'global' && this._variables.global && this._variables.global[name]) {
            root = this._variables.global[name];
        }

        if (!root) {
            if (this._variables.watches && this._variables.watches[name]) {
                root = this._variables.watches[name];
                scope = 'watch';
            } else if (this._variables.local && this._variables.local[name]) {
                root = this._variables.local[name];
                scope = 'local';
            } else if (this._variables.global && this._variables.global[name]) {
                 root = this._variables.global[name];
                 scope = 'global';
            }
        }
        
        if (!root) {
             throw new Error(`Variable ${name} not found`);
        }

        if ((!options.path || options.path.length === 0) && (!root.children || root.children.length === 0)) {
            try {
                const output = await this._sendCLI(`output ${name}`);
                parseGDBWatchValue(root, output);
            } catch (e) {
                global.logWarn?.(`[GDB] 无法获取 ${name} 的子项`, e);
            }
        }
        
        let current = root;
        if (options.path && Array.isArray(options.path)) {
            for (const p of options.path) {
                const idx = Number(p);
                if (current.children && current.children[idx]) {
                    current = current.children[idx];
                } else {
                    break;
                }
            }
        }
        
        return {
            name,
            scope,
            path: options.path,
            data: current
        };
    }

    async collapseVariable(name, options = {}) {
        return {};
    }

    _onData(chunk) {
        this.buffer += chunk;
        const lines = this.buffer.split(/\r?\n/);
        this.buffer = lines.pop() || '';

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            
            // Suppress "Failed to set controlling terminal" warning which is expected when hijacking TTY
            if (trimmed.includes('Failed to set controlling terminal')) {
                continue;
            }

            try { global.logInfo?.('[GDB>>]', trimmed); } catch (_) { }

            if (line.startsWith('~')) {
                for (const req of this.pending.values()) {
                    if (req.captureOutput) {
                        req.captureOutput(line);
                        break; 
                    }
                }
            }

            const tokenMatch = line.match(/^(\d+)\^([a-zA-Z\-]+)(.*)$/);
            if (tokenMatch) {
                const [, tokenStr, status, rest] = tokenMatch;
                const token = parseInt(tokenStr, 10);
                const req = this.pending.get(token);
                if (req) {
                    this.pending.delete(token);
                    if (status === 'done' || status === 'running' || status === 'connected' || status === 'exit') {
                        req.resolve(this._parseMIResult(rest));
                    } else {
                        const err = this._parseMIResult(rest);
                        req.reject(new Error(err.msg || 'GDB Error'));
                    }
                }
                continue;
            }

            if (line.startsWith('*stopped')) {
                this._inferiorRunning = false;
                this._expectingRunning = false;
                try { global.logInfo?.('[GDB] 状态: 停止'); } catch (_) { }
                const data = this._parseMIResult(line.substring(8));
                const reason = data.reason;
                const frame = data.frame || {};
                
                this.emit('stopped', { 
                    reason, 
                    frame: {
                        file: this._normalizePath(frame.fullname || frame.file),
                        line: parseInt(frame.line, 10),
                        function: frame.func
                    }
                });
                
                this.updateVariables();
                this.updateCallStack();
            } else if (line.startsWith('*running')) {
                try { global.logInfo?.(`[GDB] 接收到 *running。期望=${this._expectingRunning}`); } catch (_) { }
                if (this._expectingRunning) {
                    this._inferiorRunning = true;
                    try { global.logInfo?.('[GDB] 状态: 运行'); } catch (_) { }
                    this.emit('running');
                } else {
                    try { global.logInfo?.('[GDB] 忽略意外的 *running 事件'); } catch (_) { }
                }
            } else if (line.startsWith('=thread-group-exited')) {
                this.programExited = true;
                this._inferiorRunning = false;
                this.emit('program-exited', {});
            }
        }
    }

    _parseMIResult(str) {
        const res = {};
        if (!str) return res;
        
        if (str.startsWith(',')) str = str.substring(1);
        
        let pos = 0;
        while (pos < str.length) {
            const eq = str.indexOf('=', pos);
            if (eq === -1) break;
            const key = str.substring(pos, eq).trim();
            pos = eq + 1;
            
            let value;
            if (str[pos] === '"') {
                let end = pos + 1;
                while (end < str.length) {
                    if (str[end] === '"' && str[end-1] !== '\\') break;
                    end++;
                }
                value = this._unescapeMIString(str.substring(pos, end + 1));
                pos = end + 1;
            } else if (str[pos] === '{') {
                let brace = 1;
                let end = pos + 1;
                while (end < str.length && brace > 0) {
                    if (str[end] === '{') brace++;
                    if (str[end] === '}') brace--;
                    end++;
                }
                value = str.substring(pos, end); 
                if (value.length > 2) {
                    value = this._parseMIResult(value.substring(1, value.length - 1));
                } else {
                    value = {};
                }
                pos = end;
            } else if (str[pos] === '[') {
                 let brace = 1;
                let end = pos + 1;
                while (end < str.length && brace > 0) {
                    if (str[end] === '[') brace++;
                    if (str[end] === ']') brace--;
                    end++;
                }
                
                const listContent = str.substring(pos + 1, end - 1);
                const items = [];
                let d = 0;
                let itemStart = 0;
                let b = 0;
                let q = false;
                while (d < listContent.length) {
                    if (listContent[d] === '"' && (d === 0 || listContent[d-1] !== '\\')) q = !q;
                    if (!q) {
                        if (listContent[d] === '{' || listContent[d] === '[') b++;
                        if (listContent[d] === '}' || listContent[d] === ']') b--;
                        if (listContent[d] === ',' && b === 0) {
                            items.push(listContent.substring(itemStart, d).trim());
                            itemStart = d + 1;
                        }
                    }
                    d++;
                }
                if (itemStart < listContent.length) {
                    items.push(listContent.substring(itemStart).trim());
                }

                value = items.map(item => {
                    if (!item) return null;
                    const eq = item.indexOf('=');
                    if (eq !== -1 && item.substring(0, eq).trim().match(/^[a-zA-Z0-9_\-]+$/)) {
                        const v = item.substring(eq + 1).trim();
                        if (v.startsWith('{')) {
                             return this._parseMIResult(v.substring(1, v.length - 1));
                        } else if (v.startsWith('"')) {
                             return this._unescapeMIString(v);
                        } else if (v.startsWith('[')) {
                             return v;
                        }
                        return v;
                    } else {
                        if (item.startsWith('"')) return this._unescapeMIString(item);
                        if (item.startsWith('{')) return this._parseMIResult(item.substring(1, item.length - 1));
                        return item;
                    }
                }).filter(x => x !== null);

                pos = end;
            } else {
                let end = str.indexOf(',', pos);
                if (end === -1) end = str.length;
                value = str.substring(pos, end);
                pos = end;
            }
            
            res[key] = value;
            if (str[pos] === ',') pos++;
        }
        return res;
    }

    _escapePath(p) {
        if (os.platform() === 'win32') return p.replace(/\\/g, '/');
        return p;
    }

    _normalizePath(p) {
        if (!p) return p;
        if (os.platform() === 'win32') {
            return path.normalize(p);
        }
        return p;
    }

    async _waitReady() {
        await new Promise(r => setTimeout(r, 100));
    }
    
    async _cleanupLinuxTTY() {
        if (this._ttyProcess) {
            try { this._ttyProcess.kill(); } catch (_) { }
        }
        if (this._ttyShellPid) {
            try { process.kill(this._ttyShellPid, 'SIGTERM'); } catch (_) { }
        }
        this._ttyProcess = null;
        this._ttyPath = null;
    }

    async _ensureLinuxTTY() {
        if (this._ttyPath) return { ttyPath: this._ttyPath };
        if (this._linuxTTYOptions.noNewConsole) return null;
        if (this._linuxTTYOptions.inferiorTTY) return { ttyPath: this._linuxTTYOptions.inferiorTTY };

        const { exec } = require('child_process');
        const util = require('util');
        const execPromise = util.promisify(exec);
        const sleepTime = 80000000 + Math.floor(Math.random() * 100000);
        const sleepCmd = `sleep ${sleepTime}`;
        let terminalApp = null;
        let args = [];
        const candidates = [
            { cmd: 'gnome-terminal', args: ['--', 'bash', '-c', sleepCmd] },
            { cmd: 'konsole', args: ['-e', 'bash', '-c', sleepCmd] },
            { cmd: 'xfce4-terminal', args: ['-T', 'Program Console', '-x', 'bash', '-c', sleepCmd] },
            { cmd: 'x-terminal-emulator', args: ['-e', 'bash', '-c', sleepCmd] },
            { cmd: 'xterm', args: ['-T', 'Program Console', '-e', sleepCmd] }
        ];

        for (const c of candidates) {
            try {
                await execPromise(`which ${c.cmd}`);
                terminalApp = c.cmd;
                args = c.args;
                break;
            } catch (e) {
            }
        }

        if (!terminalApp) {
            terminalApp = 'xterm';
            args = ['-T', 'Program Console', '-e', sleepCmd];
        }
        try {
            this._ttyProcess = spawn(terminalApp, args, {
                detached: true,
                stdio: 'ignore'
            });
            this._ttyProcess.unref(); 
        } catch (e) {
            global.logWarn?.('[GDB] 启动终端失败', e);
            return null;
        }
        for (let i = 0; i < 50; i++) {
            await new Promise(r => setTimeout(r, 200));
            
            try {
                const { stdout } = await execPromise('ps x -o tty,pid,command');
                const lines = stdout.split('\n');
                for (const line of lines) {
                    if (line.includes(sleepCmd) && !line.includes('ps x') && !line.includes(terminalApp)) {
                        const parts = line.trim().split(/\s+/);
                        if (parts.length >= 3) {
                            let tty = parts[0];
                            const pid = parts[1];
                            
                            if (tty === '?' || tty === '-') continue; 
                            
                            if (!tty.startsWith('/dev/')) {
                                tty = '/dev/' + tty;
                            }
                            
                            this._ttyPath = tty;
                            this._ttyShellPid = parseInt(pid, 10);
                            try { global.logInfo?.(`[GDB] 找到 TTY: ${tty} (PID: ${pid})`); } catch (_) { }
                            return { ttyPath: this._ttyPath };
                        }
                    }
                }
            } catch (e) {
            }
        }
        
        global.logWarn?.('[GDB] 找不到终端的 TTY');
        return null;
    }
}

module.exports = GDBDebugger;
