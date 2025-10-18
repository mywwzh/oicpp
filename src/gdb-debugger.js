const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const EventEmitter = require('events');

const DEFAULT_CHILDREN_CHUNK = 100;
const MAX_CHILDREN_CHUNK = 500;

class GDBDebugger extends EventEmitter {
    constructor() {
        super();
        this.isRunning = false;
        this.programExited = false;
        this.gdbProcess = null;
        this.buffer = '';
        this.seq = 1;
        this.pending = new Map(); // token -> {resolve, reject, cmd}
        this._variables = { local: {}, global: {}, watches: {} };
        this._callStack = [];
        this._breakpoints = []; // {number, file, line}
        this._varObjects = new Map(); // key -> {varName, numchild, type, value, loaded, chunkSize}
        this._pendingWatches = new Set(); // 程序未暂停时待评估的监视表达式
        this._watchExpressions = new Set(); // 已注册的监视表达式
        this._updatingVars = false; // 防止重复并发更新导致主进程阻塞
        this._updatePromise = null; // 保存当前变量刷新 Promise
        this.inferiorPid = null; // 被调试进程 PID（仅当 GDB 提供时）
        this._ttyProcess = null; // Linux: 保存为被调试进程保留的外部终端进程
        this._ttyPath = null;    // Linux: 记录分配的 /dev/pts/X 路径
        this._ttyPromise = null; // Linux: 终端准备中的临时 Promise
        this._linuxTTYOptions = {}; // Linux: 记录终端配置选项
        this._ttyShellPid = null; // Linux: 记录终端内运行脚本的 Shell PID，便于清理
        this._ttyMetadata = null; // Linux: 最近一次成功检测到的 TTY 元数据
        this._ttyWarningLogged = false; // Linux: 是否已记录“无法设置控制终端”的告警
        this._inferiorLaunched = false; // 是否已启动过被调试程序（exec-run 已发送且未重置）
        this._inferiorRunning = false;  // 被调试程序当前是否处于运行态（*running 与 *stopped 事件维护）
        this._lastErrorMsg = null; // 存储最近的 GDB 错误消息，用于提取 exit code
        this._immediateRefreshPending = false; // 暂停瞬间的刷新调度标记
    }

    _send(cmd) {
        return new Promise((resolve, reject) => {
            if (!this.gdbProcess) return reject(new Error('GDB 进程未启动'));
            const token = this.seq++;
            this.pending.set(token, { resolve, reject, cmd });
            const line = `${token}-${cmd}\n`;
            try { global.logInfo?.('[GDB<<]', line.trim()); } catch (_) { }
            this.gdbProcess.stdin.write(line);
        });
    }

    async _trySend(cmd) {
        try {
            await this._send(cmd);
        } catch (err) {
            try { global.logWarn?.(`[GDB][SETUP] 命令执行失败: ${cmd}, ${err?.message || err}`); } catch (_) { }
        }
    }

    async start(executablePath, sourcePath, options = {}) {
        const supportedPlatforms = new Set(['win32', 'linux']);
        if (this.gdbProcess) await this.stop();
        this.programExited = false;
        this._inferiorLaunched = false;
        this._inferiorRunning = false;
        this._lastErrorMsg = null;
        const env = options.env ? { ...process.env, ...options.env } : { ...process.env };
        const gdbExecutable = options.gdbPath || 'gdb';

        const args = ['-q', '--interpreter=mi2'];
        this.gdbProcess = spawn(gdbExecutable, args, {
            stdio: ['pipe', 'pipe', 'pipe'],
            env,
            windowsHide: false,
        });

        this.gdbProcess.stdout.on('data', (d) => this._onData(d.toString()))
        this.gdbProcess.stderr.on('data', (d) => {
            const s = d.toString();
            try { global.logWarn?.('[GDB-STDERR]', s); } catch (_) { }
        });
        this.gdbProcess.on('exit', (code, signal) => {
            this.isRunning = false;
            this.programExited = true;
            this._inferiorRunning = false;
            this._inferiorLaunched = false;
            this.emit('exited', { code, signal });
        });

        await this._waitReady();
        await this._send('gdb-set confirm off');
        await this._send('gdb-set pagination off');
        if (process.platform === 'win32') {
            await this._send('gdb-set new-console on');
        }
        await this._trySend('enable-pretty-printing');
        await this._trySend('gdb-set print pretty on');
        await this._trySend('gdb-set print array-indexes on');
        await this._trySend('gdb-set print elements 200');
        await this._trySend('gdb-set print repeats 0');
        await this._trySend('gdb-set breakpoint pending on');
        if (process.platform === 'linux') {
            const opts = options || {};
            this._linuxTTYOptions = {
                inferiorTTY: typeof opts.inferiorTTY === 'string' ? opts.inferiorTTY : undefined,
                noNewConsole: !!opts.noNewConsole
            };
            await this._cleanupLinuxTTY();
            if (this._linuxTTYOptions.inferiorTTY) {
                this._ttyPath = this._linuxTTYOptions.inferiorTTY;
            }
        } else {
            this._linuxTTYOptions = {};
        }
        await this._send(`file-exec-and-symbols "${escapePath(executablePath)}"`);

        this.isRunning = true;
        this.emit('started', { executable: executablePath, sourceFile: sourcePath });
    }

    async stop() {
        if (!this.gdbProcess) return;
        try {
            try { await this.killInferior(true); } catch (_) { }
            await this._send('gdb-exit');
        } catch (_) { }
        try { this.gdbProcess.kill(); } catch (_) { }
        this.gdbProcess = null;
        this.isRunning = false;
        this._inferiorRunning = false;
        this._inferiorLaunched = false;
        this._immediateRefreshPending = false;
        await this._cleanupLinuxTTY();
        this._linuxTTYOptions = {};
    }

    async run() {
        if (this._inferiorLaunched && this._inferiorRunning) {
            try { global.logInfo?.('[GDB][RUN] 已在运行，忽略重复 exec-run'); } catch (_) { }
            return;
        }
        if (this._inferiorLaunched && !this._inferiorRunning && !this.programExited) {
            await this._send('exec-continue');
            this._inferiorRunning = true;
            this.emit('running');
            return;
        }

        if (process.platform === 'linux') {
            try {
                const ttyInfo = await this._ensureLinuxTTY();
                const ttyPath = ttyInfo?.ttyPath || this._ttyPath;
                if (ttyPath) {
                    const fs = require('fs');
                    fs.accessSync(ttyPath, fs.constants.R_OK | fs.constants.W_OK);
                    this._captureTTYMetadata(ttyPath);
                    await this._bindTTYInGDB(ttyPath);
                    this._ttyPath = ttyPath;
                    try { global.logInfo?.('[GDB][TTY] 已绑定: ' + ttyPath); } catch (_) { }
                }
            } catch (ttyErr) {
                this._ttyPath = null;
                try { global.logWarn?.('[GDB][TTY] 终端绑定失败，将回退为无外部终端: ' + (ttyErr?.message || ttyErr)); } catch (_) { }
            }
        }
        try {
            await this._send('exec-run');
            this._inferiorLaunched = true;
            this._inferiorRunning = true; // 等待 *running 验证
            this.emit('running');
        } catch (execError) {
            if (process.platform === 'linux' && this._lastErrorMsg &&
                (this._lastErrorMsg.includes('No such file') || this._lastErrorMsg.includes('exited with code 1'))) {
                try { global.logWarn?.('[GDB][RETRY] 检测到 TTY 问题，尝试重建...'); } catch (_) { }

                await this._cleanupLinuxTTY();

                try {
                    const ttyInfo = await this._ensureLinuxTTY({ force: true });
                    const ttyPath = ttyInfo?.ttyPath || this._ttyPath;
                    if (ttyPath) {
                        const fs = require('fs');
                        fs.accessSync(ttyPath, fs.constants.R_OK | fs.constants.W_OK);
                        this._captureTTYMetadata(ttyPath);
                        await this._bindTTYInGDB(ttyPath);
                        try { global.logInfo?.('[GDB][RETRY] TTY 重建成功，重试 exec-run'); } catch (_) { }

                        await this._send('exec-run');
                        this._inferiorLaunched = true;
                        this._inferiorRunning = true;
                        this.emit('running');
                        return;
                    }
                } catch (retryError) {
                    try { global.logWarn?.('[GDB][RETRY] 重试失败: ' + (retryError?.message || retryError)); } catch (_) { }
                }
            }

            throw execError;
        }
    }

    async continue() {
        if (this.programExited) return;
        if (!this._inferiorLaunched) {
            return this.run();
        }
        if (this._inferiorRunning) return;
        await this._send('exec-continue');
        this._inferiorRunning = true;
        this.emit('running');
    }

    async stepOver() { await this._send('exec-next'); }
    async stepInto() { await this._send('exec-step'); }
    async stepOut() { await this._send('exec-finish'); }

    async sendInput(_input) {
        return { success: true };
    }

    async setBreakpoint(file, line) {
        const makeLocation = (target) => `${target}:${line}`;
        const resolvedPath = typeof file === 'string' ? escapePath(file) : String(file || '');
        const attempts = [];
        if (resolvedPath) attempts.push(makeLocation(resolvedPath));
        const basename = typeof file === 'string' ? path.basename(file) : '';
        if (basename && makeLocation(basename) !== attempts[0]) {
            attempts.push(makeLocation(basename));
        }

        let lastError = null;
        for (let i = 0; i < attempts.length; i += 1) {
            const location = attempts[i];
            try {
                const res = await this._send(`break-insert ${miQuote(location)}`);
                const bkpt = pick(res, ['bkpt']);
                if (bkpt) {
                    const b = normalizeBkpt(bkpt);
                    this._syncBreakpoint(b);
                    this.emit('breakpoint-set', b);
                    if (i > 0) {
                        try { global.logWarn?.(`[GDB][BREAKPOINT] 断点通过备用定位成功: ${location}`); } catch (_) { }
                    }
                    return b;
                }
            } catch (err) {
                lastError = err;
                if (i === 0 && attempts.length > 1) {
                    try {
                        const message = err?.message || String(err);
                        global.logWarn?.(`[GDB][BREAKPOINT] 使用绝对路径设置断点失败 (${message})，尝试备用路径 ${attempts[1]}`);
                    } catch (_) { }
                }
            }
        }

        if (lastError) throw lastError;
    }

    async removeBreakpoint(number) {
        await this._send(`break-delete ${number}`);
        this._breakpoints = this._breakpoints.filter(b => String(b.number) !== String(number));
        this.emit('breakpoint-removed', { number });
    }

    getBreakpoints() { return [...this._breakpoints]; }

    async updateVariables() {
        if (this._updatePromise) {
            try {
                await this._updatePromise;
            } catch (_) { }
            return this.getVariables();
        }

        this._updatePromise = (async () => {
            this._updatingVars = true;
            try {
                const res = await this._send('stack-list-variables --simple-values');
                const vars = pick(res, ['variables']) || [];
                const local = {};
                for (const v of vars) {
                    if (!v || !v.name) continue;
                    const entry = {
                        type: v.type || '',
                        value: v.value || '',
                        isArray: isArrayType(v.type) || looksArrayValue(v.value),
                        isContainer: false,
                        elementCount: parseArrayCount(v.type),
                        children: []
                    };
                    if (isLikelyStdContainer(entry.type, entry.value)) {
                        entry.isContainer = true;
                        entry.isArray = entry.isArray || isLikelySequentialContainer(entry.type);
                        const inferred = inferStdContainerLength(entry.value, entry.type);
                        if (Number.isFinite(inferred)) entry.elementCount = inferred;
                    }
                    local[v.name] = entry;
                }
                this._variables.local = local;
                this._variables.global = this._variables.global || {};

                const watchContainer = this._ensureWatchContainer();
                try {
                    const watchExprs = Array.from(this._watchExpressions);
                    for (let i = 0; i < watchExprs.length; i++) {
                        const expr = watchExprs[i];
                        await this._updateWatchValue(expr, { silent: true, allowCreate: true });
                        if ((i % 5) === 4) { await new Promise(r => setImmediate(r)); }
                    }
                    Object.keys(watchContainer).forEach((key) => {
                        if (!this._watchExpressions.has(key)) delete watchContainer[key];
                    });
                } catch (_) { }

                this.emit('variables-updated', this.getVariables());
            } finally {
                this._updatingVars = false;
                this._updatePromise = null;
            }
        })();

        try {
            await this._updatePromise;
        } catch (_) { }
        return this.getVariables();
    }

    getVariables() { return this._variables; }

    async updateCallStack() {
        const res = await this._send('stack-list-frames');
        const stack = pick(res, ['stack']) || pick(res, ['frames']) || [];
        this._callStack = stack.map((f) => normalizeFrame(f.frame || f));
        this.emit('callstack-updated', this._callStack);
    }

    getCallStack() { return [...this._callStack]; }

    async addWatchVariable(expr) {
        const expression = normalizeWatchExpression(expr);
        if (!expression) return;

        this._watchExpressions.add(expression);
        this._pendingWatches.delete(expression);
        this._ensureWatchContainer();

        try {
            await this._updateWatchValue(expression, { allowCreate: true });
        } catch (_) {
        }
    }

    async removeWatchVariable(expr) {
        const expression = normalizeWatchExpression(expr);
        if (!expression) return;

        this._watchExpressions.delete(expression);
        this._pendingWatches.delete(expression);

        const obj = this._varObjects.get(expression);
        if (obj) {
            await this._disposeVarObject(obj);
        }
        this._varObjects.delete(expression);

        if (this._variables.watches) {
            delete this._variables.watches[expression];
        }
    }

    _getContainer(scope) {
        if (scope === 'watch') {
            this._variables.watches = this._variables.watches || {};
            return this._variables.watches;
        }
        if (scope === 'global') {
            this._variables.global = this._variables.global || {};
            return this._variables.global;
        }
        this._variables.local = this._variables.local || {};
        return this._variables.local;
    }

    _ensureVariableEntry(scope, name) {
        const container = this._getContainer(scope);
        if (!container[name]) {
            container[name] = {
                type: '',
                value: '',
                isArray: false,
                isContainer: false,
                elementCount: null,
                children: [],
                expression: scope === 'watch' ? normalizeWatchExpression(name) : name
            };
        }
        return container[name];
    }

    _resolveNode(entry, path = []) {
        if (!entry) return null;
        if (!Array.isArray(path) || path.length === 0) return entry;
        let node = entry;
        for (const segment of path) {
            const idx = Number(segment);
            if (!Array.isArray(node.children) || idx < 0 || idx >= node.children.length) {
                return null;
            }
            node = node.children[idx];
        }
        return node;
    }

    _dropVarObjectCache(prefix) {
        if (!prefix) return;
        const keysToDelete = [];
        this._varObjects.forEach((_, key) => {
            if (key === prefix || key.startsWith(`${prefix}:`)) {
                keysToDelete.push(key);
            }
        });
        keysToDelete.forEach((key) => this._varObjects.delete(key));
    }

    _normalizeExpandOptions(name, options = {}) {
        const rawPath = Array.isArray(options.path) ? options.path : [];
        const path = rawPath.map((seg) => Number(seg)).filter((seg) => Number.isInteger(seg) && seg >= 0);
        const scope = options.scope
            || (this._variables.watches && this._variables.watches[name] ? 'watch'
                : (this._variables.global && this._variables.global[name] ? 'global' : 'local'));
        const cacheKey = options.cacheKey || buildCacheKey(scope, name, path);
        const chunk = Math.max(1, Math.min(Number(options.count) || DEFAULT_CHILDREN_CHUNK, MAX_CHILDREN_CHUNK));
        const append = !!options.append;
        const explicitStart = Number(options.start);
        const start = Number.isFinite(explicitStart) ? Math.max(0, explicitStart) : null;
        return { path, scope, cacheKey, chunk, append, start };
    }

    async _ensureVarObjectForNode(rootName, scope, target, cacheKey, options = {}) {
        if (!target) return null;
        let obj = this._varObjects.get(cacheKey);
        if (obj) return obj;

        if (options.varObjectName) {
            obj = {
                varName: options.varObjectName,
                type: target.type || '',
                numchild: Number(target.numchild || 0),
                value: target.value || '',
                loaded: 0,
                chunkSize: DEFAULT_CHILDREN_CHUNK
            };
            this._varObjects.set(cacheKey, obj);
            target.varObjectName = options.varObjectName;
            return obj;
        }

        if (target.varObjectName) {
            obj = {
                varName: target.varObjectName,
                type: target.type || '',
                numchild: Number(target.numchild || 0),
                value: target.value || '',
                loaded: 0,
                chunkSize: DEFAULT_CHILDREN_CHUNK
            };
            this._varObjects.set(cacheKey, obj);
            return obj;
        }

        let expression = options.expression || target.expression;
        if (!expression && scope !== 'watch') {
            expression = rootName;
            if (Array.isArray(options.path) && options.path.length > 0) {
                expression = buildIndexedExpression(rootName, options.path[options.path.length - 1]);
            }
        }
        expression = normalizeWatchExpression(expression);
        if (!expression) return null;

        const varNameBase = `node_${options.path ? options.path.join('_') : 'root'}`;
        const uniqueName = uniqueVarName(this._varObjects, varNameBase || 'node');
        const created = await this._send(`var-create ${miQuote(uniqueName)} * ${miQuote(expression)}`);
        const type = pick(created, ['type']) || '';
        const numchild = Number(pick(created, ['numchild']) || 0);
        const value = pick(created, ['value']) || '';
        obj = {
            varName: created.name || uniqueName,
            type,
            numchild,
            value,
            loaded: 0,
            chunkSize: DEFAULT_CHILDREN_CHUNK
        };
        this._varObjects.set(cacheKey, obj);
        target.varObjectName = obj.varName;
        target.expression = expression;
        target.type = target.type || type;
        target.value = target.value || value;
        target.numchild = Number.isFinite(numchild) ? numchild : target.numchild;
        return obj;
    }

    _mergeChildren(target, normalized, { append = false } = {}) {
        const existing = Array.isArray(target.children) ? target.children.filter(ch => !ch?.isPlaceholder) : [];
        const byIndex = new Map();
        const byName = new Map();
        existing.forEach((child) => {
            if (child.index != null) byIndex.set(child.index, child);
            const nameKey = child.name != null ? String(child.name) : null;
            if (nameKey) {
                const list = byName.get(nameKey) || [];
                list.push(child);
                byName.set(nameKey, list);
            }
        });

        const result = append ? existing.slice() : [];

        normalized.forEach((child, idx) => {
            const fallbackIndex = append ? existing.length + idx : idx;
            const indexKey = child.index != null ? child.index : fallbackIndex;
            let previous = byIndex.get(indexKey);
            if (previous) {
                byIndex.delete(indexKey);
            } else if (child.name != null) {
                const nameList = byName.get(String(child.name));
                if (nameList && nameList.length > 0) {
                    previous = nameList.shift();
                    if (nameList.length === 0) byName.delete(String(child.name));
                }
            }
            const mergedChild = mergeChildData(child, previous);
            mergedChild.index = indexKey;
            result.push(mergedChild);
        });

        return result;
    }

    async expandVariable(name, options = {}) {
        const normalized = this._normalizeExpandOptions(name, options);
        const context = {
            ...normalized,
            varObjectName: options.varObjectName,
            expression: options.expression
        };

        if (!Array.isArray(normalized.path) || normalized.path.length === 0) {
            return this._expandRootVariable(name, context);
        }
        return this._expandNestedVariable(name, context);
    }

    async _expandRootVariable(name, context) {
        const { scope, cacheKey, chunk, append, start } = context;
        const target = this._ensureVariableEntry(scope, name);
        target.type = target.type || '';
        target.value = target.value || '';

        let obj = this._varObjects.get(cacheKey);
        if (!obj) {
            if (scope === 'watch') {
                obj = await this._ensureWatchVarObject(name);
            } else {
                const varName = uniqueVarName(this._varObjects, `loc_${name}`);
                const created = await this._send(`var-create ${miQuote(varName)} * ${miQuote(name)}`);
                const type = pick(created, ['type']) || '';
                const numchild = Number(pick(created, ['numchild']) || 0);
                const value = pick(created, ['value']) || '';
                obj = {
                    varName: created.name || varName,
                    type,
                    numchild,
                    value,
                    loaded: 0,
                    chunkSize: DEFAULT_CHILDREN_CHUNK
                };
            }
            this._varObjects.set(cacheKey, obj);
            if (!this._varObjects.has(name)) {
                this._varObjects.set(name, obj);
            }
        }

        const chunkSize = Math.max(1, Math.min(chunk || obj.chunkSize || DEFAULT_CHILDREN_CHUNK, MAX_CHILDREN_CHUNK));
        obj.chunkSize = chunkSize;
        const startIndex = start != null ? start : (append ? (obj.loaded || 0) : 0);
        const to = startIndex + chunkSize - 1;

        const args = ['var-list-children', '--all-values'];
        if (startIndex > 0) args.push('--from', String(startIndex));
        if (to >= startIndex) args.push('--to', String(to));
        args.push(miQuote(obj.varName));

        const childrenRes = await this._send(args.join(' '));
        const children = pick(childrenRes, ['children']) || [];
        let normalized = children.map((ch, idx) => {
            const child = normalizeChild(ch.child || ch);
            child.index = startIndex + idx;
            child.canExpand = child.canExpand || Number(child.numchild || 0) > 0;
            return child;
        });

        target.type = target.type || obj.type || target.type;
        target.value = target.value || obj.value || target.value;

        const targetType = target.type || obj.type || '';
        const sequentialFallbackNeeded = (target.isContainer || obj.numchild > 0 || isLikelySequentialContainer(targetType)) &&
            (normalized.length === 0 || normalized.every(ch => !isSequentialElementNode(ch)));

        if (sequentialFallbackNeeded) {
            try {
                const fallback = await this._fetchSequentialChildren(name, {
                    target,
                    start: startIndex,
                    count: chunkSize,
                    append,
                    typeHint: targetType
                });
                if (fallback && Array.isArray(fallback.children) && fallback.children.length > 0) {
                    normalized = fallback.children.map((child, idx) => ({
                        ...child,
                        index: (startIndex + idx),
                        canExpand: child.canExpand || Number(child.numchild || 0) > 0
                    }));
                    if (Number.isFinite(fallback.totalCount)) {
                        target.elementCount = fallback.totalCount;
                        obj.numchild = fallback.totalCount;
                    }
                    if (fallback.elementType && (!targetType || targetType === obj.type)) {
                        obj.elementTypeHint = fallback.elementType;
                    }
                }
            } catch (seqErr) {
                try { global.logWarn?.('[GDB][SEQ] 容器回退展开失败: ' + (seqErr?.message || seqErr)); } catch (_) { }
            }
        }

        const merged = this._mergeChildren(target, normalized, { append });
        obj.loaded = merged.length;
        target.children = merged;
        target.varObjectName = obj.varName;
        target.cacheKey = cacheKey;
        target.chunkSize = chunkSize;
        target.loaded = obj.loaded;
        target.numchild = Number.isFinite(obj.numchild) ? obj.numchild : target.numchild;
        target.expression = target.expression || (scope === 'watch' ? normalizeWatchExpression(name) : name);

        target.isArray = target.isArray || (obj.numchild > 0) || isLikelySequentialContainer(targetType);
        target.isContainer = target.isContainer || (obj.numchild > 0) || isLikelyStdContainer(targetType, target.value);
        if (!Number.isFinite(target.elementCount)) {
            target.elementCount = Number.isFinite(obj.numchild) ? obj.numchild : target.elementCount;
        }

        const totalChildren = Number.isFinite(target.elementCount)
            ? Number(target.elementCount)
            : (Number.isFinite(obj.numchild) ? Number(obj.numchild) : merged.length);
        const remaining = Math.max(0, totalChildren - merged.length);
        if (remaining > 0) {
            target.children.push({
                name: '更多…',
                value: `共 ${totalChildren} 项，已显示 ${merged.length} 项`,
                type: '',
                isPlaceholder: true,
                nextIndex: merged.length,
                remaining,
                chunkSize: obj.chunkSize || DEFAULT_CHILDREN_CHUNK
            });
        }

        this.emit('variables-updated', this.getVariables());
        return {
            scope,
            name,
            path: [],
            cacheKey,
            data: cloneVariableEntry(target)
        };
    }

    async _expandNestedVariable(name, context) {
        const { scope, cacheKey, chunk, append, start, path, varObjectName, expression } = context;
        const rootEntry = this._ensureVariableEntry(scope, name);
        const target = this._resolveNode(rootEntry, path);
        if (!target) {
            return {
                scope,
                name,
                path,
                cacheKey,
                data: cloneVariableEntry(rootEntry)
            };
        }

        const obj = await this._ensureVarObjectForNode(name, scope, target, cacheKey, {
            varObjectName,
            expression,
            path
        });
        if (!obj) {
            return {
                scope,
                name,
                path,
                cacheKey,
                data: cloneVariableEntry(rootEntry)
            };
        }

        const chunkSize = Math.max(1, Math.min(chunk || obj.chunkSize || DEFAULT_CHILDREN_CHUNK, MAX_CHILDREN_CHUNK));
        obj.chunkSize = chunkSize;
        const startIndex = start != null ? start : (append ? (obj.loaded || 0) : 0);
        const to = startIndex + chunkSize - 1;

        const args = ['var-list-children', '--all-values'];
        if (startIndex > 0) args.push('--from', String(startIndex));
        if (to >= startIndex) args.push('--to', String(to));
        args.push(miQuote(obj.varName));

        const childrenRes = await this._send(args.join(' '));
        const children = pick(childrenRes, ['children']) || [];
        let normalized = children.map((ch, idx) => {
            const child = normalizeChild(ch.child || ch);
            child.index = startIndex + idx;
            child.canExpand = child.canExpand || Number(child.numchild || 0) > 0;
            return child;
        });

        const merged = this._mergeChildren(target, normalized, { append });
        obj.loaded = merged.length;
        target.children = merged;
        target.varObjectName = obj.varName;
        target.chunkSize = chunkSize;
        target.loaded = obj.loaded;
        target.numchild = Number.isFinite(obj.numchild) ? obj.numchild : target.numchild;

        if (!Number.isFinite(target.elementCount)) {
            target.elementCount = Number.isFinite(obj.numchild) ? obj.numchild : target.elementCount;
        }

        const totalChildren = Number.isFinite(target.elementCount)
            ? Number(target.elementCount)
            : (Number.isFinite(obj.numchild) ? Number(obj.numchild) : merged.length);
        const remaining = Math.max(0, totalChildren - merged.length);
        if (remaining > 0) {
            target.children.push({
                name: '更多…',
                value: `共 ${totalChildren} 项，已显示 ${merged.length} 项`,
                type: '',
                isPlaceholder: true,
                nextIndex: merged.length,
                remaining,
                chunkSize: obj.chunkSize || DEFAULT_CHILDREN_CHUNK
            });
        }

        this.emit('variables-updated', this.getVariables());
        return {
            scope,
            name,
            path,
            cacheKey,
            data: cloneVariableEntry(rootEntry)
        };
    }

    async collapseVariable(name, options = {}) {
        const normalized = this._normalizeExpandOptions(name, options);
        const { scope, path, cacheKey } = normalized;
        if (!Array.isArray(path) || path.length === 0) {
            const container = this._getContainer(scope);
            const entry = container[name];
            if (!entry) return;
            entry.children = [];
            entry.loaded = 0;
            entry.elementCount = null;
            const rootObj = this._varObjects.get(name);
            if (rootObj) rootObj.loaded = 0;
            if (scope !== 'watch') {
                this._varObjects.delete(name);
            }
            this._dropVarObjectCache(cacheKey);
        } else {
            const rootEntry = this._ensureVariableEntry(scope, name);
            const target = this._resolveNode(rootEntry, path);
            if (!target) return;
            target.children = [];
            target.loaded = 0;
            target.elementCount = null;
            const obj = this._varObjects.get(cacheKey);
            if (obj) obj.loaded = 0;
            this._dropVarObjectCache(cacheKey);
        }
        this.emit('variables-updated', this.getVariables());
    }

    _requestRefreshAfterStop() {
        if (!this.isRunning || this.programExited) return;
        if (this._immediateRefreshPending) return;
        this._immediateRefreshPending = true;
        setImmediate(() => {
            this._immediateRefreshPending = false;
            this.updateVariables()
                .then(() => this.updateCallStack().catch(() => { }))
                .catch(() => { });
        });
    }

    async _fetchSequentialChildren(expr, options = {}) {
        const sanitizedExpr = normalizeWatchExpression(expr);
        if (!sanitizedExpr) return { children: [], totalCount: 0, elementType: '' };

        const { target = {}, start = 0, count = DEFAULT_CHILDREN_CHUNK, typeHint = '' } = options;
        const elementType = extractSequentialElementType(typeHint || target.type || '') || '';

        let totalCount = Number.isFinite(target.elementCount) ? Number(target.elementCount) : null;
        if (!Number.isFinite(totalCount)) {
            try {
                const sizeVal = await this._evaluateExpression(`(unsigned long long)(${sanitizedExpr}.size())`);
                const parsed = Number(sizeVal);
                if (Number.isFinite(parsed)) totalCount = parsed;
            } catch (_) { }
        }

        if (!Number.isFinite(totalCount)) {
            totalCount = null;
        }

        const endExclusive = Number.isFinite(totalCount) ? Math.min(totalCount, start + count) : (start + count);
        const children = [];
        for (let idx = start; idx < endExclusive; idx++) {
            const elementExpr = buildIndexedExpression(sanitizedExpr, idx);
            let value = '';
            let childType = elementType;
            let canExpand = false;
            try {
                const evaluated = await this._evaluateExpression(elementExpr);
                value = evaluated != null ? String(evaluated) : '';
                if (!childType) {
                    childType = inferTypeFromValue(value) || '';
                }
                if (value && (value.includes('{') || value.startsWith('std::'))) {
                    canExpand = true;
                }
            } catch (err) {
                value = `(不可用) ${normalizeWatchErrorMessage(err?.message || err)}`;
            }
            children.push({
                name: `[${idx}]`,
                value,
                type: childType,
                numchild: 0,
                canExpand,
                expression: elementExpr,
                varObjectName: ''
            });

            if ((idx - start) % 8 === 7) {
                await new Promise(resolve => setImmediate(resolve));
            }
        }

        return { children, totalCount, elementType };
    }

    async _evaluateExpression(expr) {
        const res = await this._send(`data-evaluate-expression ${miQuote(expr)}`);
        return pick(res, ['value']);
    }

    _onData(chunk) {
        this.buffer += chunk;
        const lines = this.buffer.split(/\r?\n/);
        this.buffer = lines.pop() || '';
        for (const raw of lines) {
            const line = raw.trim();
            if (!line) continue;

            const suppressTtyWarning = line.startsWith('&"warning: GDB: Failed to set controlling terminal') ||
                line.includes('Failed to set controlling terminal: 不允许的操作') ||
                line.includes('Failed to set controlling terminal: Operation not permitted');

            if (suppressTtyWarning) {
                if (!this._ttyWarningLogged) {
                    this._ttyWarningLogged = true;
                    try {
                        global.logWarn?.('[GDB][TTY] 控制终端交接被底层拒绝，已改用非控制模式。交互功能仍旧可用。');
                    } catch (_) { }
                }
                continue;
            }

            try { global.logInfo?.('[GDB>>]', line); } catch (_) { }
            const tokenMatch = line.match(/^(\d+)\^([a-zA-Z\-]+)(.*)$/);
            if (tokenMatch) {
                const [, tokenStr, status, rest] = tokenMatch;
                const token = Number(tokenStr);
                const pending = this.pending.get(token);
                if (!pending) continue;
                this.pending.delete(token);
                if (status === 'done' || status === 'running' || status === 'connected' || status === 'exit') {
                    pending.resolve(parseMIResult(rest));
                } else if (status === 'error') {
                    const err = parseMIResult(rest);
                    this._lastErrorMsg = err?.msg || err?.message || 'error';
                    pending.reject(new Error(this._lastErrorMsg));
                } else {
                    try { global.logWarn?.('[GDB][STATE] 未知结果状态视为成功: ' + status); } catch (_) { }
                    pending.resolve(parseMIResult(rest));
                }
                continue;
            }

            if (line.startsWith('*stopped')) {
                const data = parseMIResult(line.replace('*stopped', '')) || {};
                const reason = data.reason || '';
                this._inferiorRunning = false;
                if (reason.includes('exited')) {
                    this.programExited = true;
                    this.isRunning = false;
                    this._inferiorLaunched = false;
                    this.emit('program-exited', { exitCode: Number(data['exit-code'] || 0) });
                } else {
                    const frame = normalizeFrame(data.frame || {});
                    this.emit('stopped', { reason, frame });
                    if (reason === 'breakpoint-hit') {
                        const file = frame.file || '';
                        const lineNo = frame.line ? Number(frame.line) : undefined;
                        this.emit('breakpoint-hit', { file, line: lineNo, function: frame.function });
                    }
                    try {
                        if (this._pendingWatches.size > 0) {
                            const pending = Array.from(this._pendingWatches);
                            this._pendingWatches.clear();
                            pending.forEach((expr) => {
                                try { this.addWatchVariable(expr).catch(() => { }); } catch (_) { }
                            });
                        }
                    } catch (_) { }
                    this._requestRefreshAfterStop();
                }
                continue;
            }

            if (line.startsWith('=thread-group-started')) {
                const data = parseMIResult(line.replace('=thread-group-started', '')) || {};
                const pidStr = data.pid || data['pid'] || '';
                const pid = Number(pidStr);
                if (pid && !Number.isNaN(pid)) this.inferiorPid = pid;
                continue;
            }

            if (line.startsWith('=breakpoint-created') || line.startsWith('=breakpoint-modified')) {
                const data = parseMIResult(line.split(',').slice(1).join(',')) || {};
                const b = normalizeBkpt((data.bkpt) || {});
                this._syncBreakpoint(b);
                this.emit('breakpoint-set', b);
                continue;
            }

            if (line.startsWith('=breakpoint-deleted')) {
                this._refreshBreakpoints().catch(() => { });
                continue;
            }

            if (line.startsWith('=thread-group-exited')) {
                const data = parseMIResult(line.replace('=thread-group-exited', '')) || {};
                this.programExited = true;
                this.isRunning = false;
                this._inferiorRunning = false;
                this._inferiorLaunched = false;
                this.inferiorPid = null;
                this._immediateRefreshPending = false;
                let exitCode = Number(data['exit-code'] || 0);
                if (exitCode === 0 && this._lastErrorMsg) {
                    const match = this._lastErrorMsg.match(/exited with code (\d+)/);
                    if (match) exitCode = Number(match[1]);
                }
                this.emit('program-exited', { exitCode });
                continue;
            }
        }
    }

    async killInferior(force = false) {
        try {
            await this._send('exec-abort');
        } catch (_) { }

        const pid = this.inferiorPid;
        if (!pid) return; // 无 PID 无需进一步处理

        try { process.kill(pid); } catch (_) { }

        if (force && process.platform === 'win32') {
            try {
                const { spawnSync } = require('child_process');
                spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
            } catch (_) { }
        }
    }

    async _waitReady() {
        await new Promise(r => setTimeout(r, 150));
    }

    async _refreshBreakpoints() {
        try {
            const res = await this._send('break-list');
            const table = pick(res, ['BreakpointTable']) || pick(res, ['BreakpointTable', 'body']) || {};
            const rows = table.body || table.rows || [];
            this._breakpoints = rows.map(r => normalizeBkpt(r.bkpt || r));
        } catch (_) { }
    }

    _syncBreakpoint(b) {
        if (!b || !b.number) return;
        const idx = this._breakpoints.findIndex(x => String(x.number) === String(b.number));
        if (idx >= 0) this._breakpoints[idx] = b; else this._breakpoints.push(b);
    }

    async _updateWatchValue(expr, options = {}) {
        const opts = typeof options === 'boolean' ? { silent: options } : (options || {});
        const { silent = false, allowCreate = false } = opts;
        const expression = normalizeWatchExpression(expr);
        if (!expression) return;
        if (!this._watchExpressions.has(expression) && !allowCreate) return;

        const performUpdate = async () => {
            const obj = await this._ensureWatchVarObject(expression);
            try { await this._send(`var-update --all-values ${miQuote(obj.varName)}`); } catch (_) { }

            const valueInfo = await this._send(`var-evaluate-expression ${miQuote(obj.varName)}`);
            const typeInfo = await this._send(`var-info-type ${miQuote(obj.varName)}`);
            const countInfo = await this._send(`var-info-num-children ${miQuote(obj.varName)}`);

            const value = pick(valueInfo, ['value']) || '';
            const type = pick(typeInfo, ['type']) || '';
            const numchild = Number(pick(countInfo, ['numchild']) || 0);

            obj.type = type;
            obj.value = value;
            obj.numchild = numchild;
            obj.loaded = 0;
            obj.chunkSize = obj.chunkSize || DEFAULT_CHILDREN_CHUNK;

            this._pendingWatches.delete(expression);
            this._snapshotWatchValue(expression, { type, value, numchild });
        };

        try {
            await performUpdate();
        } catch (error) {
            const retry = await this._handleWatchUpdateFailure(expression, error, allowCreate);
            if (retry) {
                try {
                    await performUpdate();
                } catch (retryErr) {
                    await this._handleWatchUpdateFailure(expression, retryErr, false);
                }
            }
        }

        if (!silent) this.emit('variables-updated', this.getVariables());
    }

    _ensureWatchContainer() {
        if (!this._variables.watches || typeof this._variables.watches !== 'object') {
            this._variables.watches = {};
        }
        return this._variables.watches;
    }

    async _ensureWatchVarObject(expression) {
        let obj = this._varObjects.get(expression);
        if (obj) return obj;

        const sanitized = expression.replace(/[^a-zA-Z0-9_]/g, '_') || 'expr';
        const compressed = sanitized.replace(/_+/g, '_').replace(/^_+|_+$/g, '');
        const base = (`watch_${compressed || 'expr'}`).slice(-120);
        const varName = uniqueVarName(this._varObjects, base.slice(0, 60) || 'watch_expr');

        const created = await this._send(`var-create ${miQuote(varName)} * ${miQuote(expression)}`);
        const actualName = pick(created, ['name']) || varName;
        const type = pick(created, ['type']) || '';
        const numchild = Number(pick(created, ['numchild']) || 0);
        const value = pick(created, ['value']) || '';

        obj = {
            varName: actualName,
            type,
            numchild,
            value,
            loaded: 0,
            chunkSize: DEFAULT_CHILDREN_CHUNK
        };
        this._varObjects.set(expression, obj);
        return obj;
    }

    async _handleWatchUpdateFailure(expression, error, allowCreate) {
        const message = String(error?.message || error || '').trim();
        const lower = message.toLowerCase();

        if (isRunningEvalError(lower)) {
            this._pendingWatches.add(expression);
            this._snapshotWatchPending(expression);
            return false;
        }

        const existing = this._varObjects.get(expression);
        if (existing) {
            await this._disposeVarObject(existing);
        }
        this._varObjects.delete(expression);

        const shouldRetry = /varobj|variable object|has expired|not found|no such object|value is not available/.test(lower) || (allowCreate && !message);
        if (shouldRetry) {
            try {
                await this._ensureWatchVarObject(expression);
                return true;
            } catch (createErr) {
                const createMsg = String(createErr?.message || createErr || '').trim();
                if (isRunningEvalError(createMsg)) {
                    this._pendingWatches.add(expression);
                    this._snapshotWatchPending(expression);
                } else {
                    this._snapshotWatchError(expression, createMsg || message);
                }
                return false;
            }
        }

        if (/no symbol/.test(lower) || /not in scope/.test(lower)) {
            this._snapshotWatchError(expression, '变量不在当前作用域');
            return false;
        }
        if (/optimized out/.test(lower)) {
            this._snapshotWatchError(expression, '变量已被优化，无法获取值');
            return false;
        }

        this._snapshotWatchError(expression, message || '无法评估该表达式');
        return false;
    }

    _snapshotWatchValue(expression, { type = '', value = '', numchild = 0 }) {
        const container = this._ensureWatchContainer();
        const numericChildren = Number.isFinite(numchild) ? Number(numchild) : null;
        let isArray = isArrayType(type) || looksArrayValue(value);
        let isContainer = (numericChildren ?? 0) > 0;
        let elementCount = numericChildren;

        if (!isContainer && isLikelyStdContainer(type, value)) {
            isContainer = true;
            if (isLikelySequentialContainer(type)) isArray = true;
            const inferred = inferStdContainerLength(value, type);
            if (Number.isFinite(inferred)) elementCount = inferred;
        }

        container[expression] = {
            type,
            value,
            isArray,
            isContainer,
            elementCount,
            numchild: numericChildren,
            expression,
            children: []
        };
    }

    _snapshotWatchPending(expression, message = '(运行中，待暂停后评估)') {
        const container = this._ensureWatchContainer();
        container[expression] = {
            type: '',
            value: message,
            isArray: false,
            isContainer: false,
            elementCount: null,
            children: []
        };
    }

    _snapshotWatchError(expression, errorMessage) {
        const container = this._ensureWatchContainer();
        const display = normalizeWatchErrorMessage(errorMessage);
        container[expression] = {
            type: '',
            value: `(不可用) ${display}`,
            isArray: false,
            isContainer: false,
            elementCount: null,
            children: []
        };
    }

    async _disposeVarObject(obj) {
        if (!obj || !obj.varName) return;
        try {
            await this._send(`var-delete ${miQuote(obj.varName)}`);
        } catch (_) { }
    }
}

function escapePath(p) {
    if (os.platform() === 'win32') return p.replace(/\\/g, '/');
    return p;
}

function miQuote(s) {
    const esc = String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return `"${esc}"`;
}

function isArrayType(type) {
    return typeof type === 'string' && /\[[0-9]*\]$/.test(type);
}
function parseArrayCount(type) {
    if (!type) return null;
    const m = String(type).match(/\[(\d+)\]$/);
    return m ? Number(m[1]) : null;
}
function looksArrayValue(val) {
    return typeof val === 'string' && /^\{.*\}$/.test(val.trim());
}

function isSequentialElementNode(child) {
    if (!child) return false;
    const name = String(child.name || '').trim();
    return /^\[\d+\]$/.test(name);
}

function normalizeBkpt(b) {
    return {
        number: b.number || b['bkptno'] || b.id,
        file: b.file || b.fullname || b.original_location || '',
        line: b.line ? Number(b.line) : (b.func || undefined)
    };
}

function normalizeFrame(f) {
    return {
        function: f.func || f.function || '',
        file: f.file || f.fullname || '',
        line: f.line ? Number(f.line) : undefined
    };
}

function normalizeChild(ch) {
    const varName = ch.name || '';
    const expression = ch.exp || '';
    return {
        name: expression || varName || '',
        value: ch.value || '',
        type: ch.type || '',
        numchild: ch.numchild ? Number(ch.numchild) : 0,
        varObjectName: varName,
        expression
    };
}

function uniqueVarName(map, base) {
    let idx = 1;
    let name = base;
    while ([...map.values()].some(o => o.varName === name)) {
        name = `${base}_${idx++}`;
    }
    return name;
}

function isLikelyStdContainer(type, value) {
    const typeStr = String(type || '');
    if (/std::(vector|array|deque|list|forward_list|set|map|unordered_set|unordered_map|multiset|multimap|queue|stack|basic_string|u8string|u16string|u32string|wstring)\b/.test(typeStr)) {
        return true;
    }
    const valueStr = String(value || '');
    return /std::(vector|array|deque|list)/.test(valueStr);
}

function isLikelySequentialContainer(type) {
    const typeStr = String(type || '');
    return /std::(vector|array|deque|list|forward_list|basic_string|u8string|u16string|u32string|wstring)\b/.test(typeStr);
}

function extractSequentialElementType(typeStr) {
    const str = String(typeStr || '');
    if (!str.includes('std::')) return '';
    if (/std::basic_string/.test(str)) return 'char';
    const firstArg = extractFirstTemplateArgument(str);
    return firstArg || '';
}

function extractFirstTemplateArgument(typeStr) {
    const str = String(typeStr || '');
    const lt = str.indexOf('<');
    if (lt < 0) return '';
    let depth = 0;
    let arg = '';
    for (let i = lt + 1; i < str.length; i++) {
        const ch = str[i];
        if (ch === '<') {
            depth += 1;
            arg += ch;
        } else if (ch === '>') {
            if (depth === 0) break;
            depth -= 1;
            arg += ch;
        } else if (ch === ',' && depth === 0) {
            break;
        } else {
            arg += ch;
        }
    }
    return arg.trim();
}

function buildIndexedExpression(expr, index) {
    const sanitized = String(expr || '').trim();
    if (!sanitized) return `[${index}]`;
    return `(${sanitized})[${index}]`;
}

function inferTypeFromValue(value) {
    const text = String(value || '').trim();
    if (/^'.*'$/.test(text)) return 'char';
    if (/^-?\d+(\.\d+)?$/.test(text)) return text.includes('.') ? 'double' : 'int';
    return '';
}

function inferStdContainerLength(value, type = '') {
    const val = String(value || '');
    const typeStr = String(type || '');
    const patterns = [
        /size\s*=\s*(\d+)/i,
        /length\s*=\s*(\d+)/i,
        /count\s*=\s*(\d+)/i,
        /of\s+length\s+(\d+)/i,
        /elements?\s*=\s*(\d+)/i
    ];
    for (const re of patterns) {
        const m = val.match(re);
        if (m) {
            const num = Number(m[1]);
            if (Number.isFinite(num)) return num;
        }
    }

    const arrayMatch = typeStr.match(/std::array<[^,]+,\s*(\d+)\s*>/);
    if (arrayMatch) {
        const num = Number(arrayMatch[1]);
        if (Number.isFinite(num)) return num;
    }

    return null;
}

function normalizeWatchExpression(expr) {
    if (expr == null) return '';
    return String(expr).trim();
}

function buildCacheKey(scope, name, path = []) {
    const safeScope = scope || 'local';
    const safeName = encodeURIComponent(String(name || ''));
    if (!Array.isArray(path) || path.length === 0) {
        return `${safeScope}:${safeName}`;
    }
    return `${safeScope}:${safeName}:${path.map((seg) => String(seg)).join('.')}`;
}

function normalizeWatchErrorMessage(message) {
    const text = String(message || '').trim();
    if (!text) return '无法评估该表达式';
    const lower = text.toLowerCase();
    if (/变量不在当前作用域/.test(text)) return '变量不在当前作用域';
    if (/not in (current )?scope|no symbol/.test(lower)) return '变量不在当前作用域';
    if (/optimized out/.test(lower)) return '变量已被优化，无法获取值';
    if (/not available|unavailable/.test(lower)) return '当前无法获取该值';
    if (/cannot access memory/.test(lower)) return '无法访问目标内存';
    return text;
}

function isRunningEvalError(message) {
    const lower = String(message || '').toLowerCase();
    return /(not\s+stopped|target\s+is\s+running|program\s+is\s+running|cannot evaluate|运行中|正在运行|程序正在运行)/.test(lower);
}

function cloneVariableChild(child) {
    if (!child) return child;
    const cloned = { ...child };
    if (Array.isArray(child.children)) {
        cloned.children = child.children.map(cloneVariableChild);
    }
    return cloned;
}

function cloneVariableEntry(entry) {
    if (!entry) {
        return {
            type: '',
            value: '',
            isArray: false,
            isContainer: false,
            elementCount: null,
            children: []
        };
    }
    const cloned = {
        ...entry,
        type: entry.type || '',
        value: entry.value || '',
        isArray: !!entry.isArray,
        isContainer: !!entry.isContainer,
        elementCount: Number.isFinite(entry.elementCount) ? Number(entry.elementCount) : (entry.elementCount ?? null)
    };
    cloned.children = Array.isArray(entry.children) ? entry.children.map(cloneVariableChild) : [];
    return cloned;
}

function mergeChildData(newChild, previousChild) {
    if (!previousChild) {
        const base = { ...newChild };
        if (Array.isArray(newChild.children)) {
            base.children = newChild.children.map(cloneVariableChild);
        }
        return base;
    }
    const merged = { ...previousChild, ...newChild };
    if (Array.isArray(newChild.children)) {
        merged.children = newChild.children.map(cloneVariableChild);
    } else if (Array.isArray(previousChild.children)) {
        merged.children = previousChild.children.map(cloneVariableChild);
    }
    if (previousChild.varObjectName && !merged.varObjectName) merged.varObjectName = previousChild.varObjectName;
    if (previousChild.expression && !merged.expression) merged.expression = previousChild.expression;
    if (previousChild.cacheKey && !merged.cacheKey) merged.cacheKey = previousChild.cacheKey;
    return merged;
}

function pick(obj, pathArr) {
    try {
        if (!obj) return undefined;
        let cur = obj;
        for (const k of pathArr) {
            if (cur && Object.prototype.hasOwnProperty.call(cur, k)) {
                cur = cur[k];
            } else {
                return undefined;
            }
        }
        return cur;
    } catch (_) { return undefined; }
}

function parseMIResult(rest) {
    const text = rest?.trim?.() || '';
    if (!text) return {};
    const s = text.startsWith(',') ? text.slice(1) : text;
    return parseKeyValues(s);
}

function parseKeyValues(s) {
    const result = {};
    let i = 0;
    while (i < s.length) {
        let key = '';
        while (i < s.length && s[i] !== '=') { key += s[i++]; }
        if (s[i] !== '=') break; // 结束
        i++; // skip '='
        const { value, next } = parseValue(s, i);
        result[key] = value;
        i = next;
        if (s[i] === ',') i++;
    }
    return result;
}

function parseValue(s, i) {
    skipSpaces();
    if (s[i] === '"') return parseString(s, i);
    if (s[i] === '{') return parseTuple(s, i);
    if (s[i] === '[') return parseList(s, i);
    let j = i;
    while (j < s.length && !",}]".includes(s[j])) j++;
    const atom = s.slice(i, j);
    return { value: atom, next: j };

    function skipSpaces() { while (i < s.length && s[i] === ' ') i++; }
}

function parseString(s, i) {
    let j = i + 1, out = '';
    while (j < s.length) {
        const ch = s[j];
        if (ch === '\\') { // 转义
            const n = s[j + 1];
            if (n === '"' || n === '\\') { out += n; j += 2; continue; }
            out += n; j += 2; continue;
        }
        if (ch === '"') break;
        out += ch; j++;
    }
    return { value: out, next: j + 1 };
}

function parseTuple(s, i) {
    let j = i + 1; // after '{'
    const obj = {};
    while (j < s.length) {
        if (s[j] === '}') { j++; break; }
        let key = '';
        while (j < s.length && s[j] !== '=') { key += s[j++]; }
        if (s[j] !== '=') break;
        j++;
        const r = parseValue(s, j);
        obj[key] = r.value;
        j = r.next;
        if (s[j] === ',') j++;
    }
    return { value: obj, next: j };
}

function parseList(s, i) {
    let j = i + 1;
    const arr = [];
    while (j < s.length) {
        if (s[j] === ']') { j++; break; }
        const r = parseValue(s, j);
        arr.push(r.value);
        j = r.next;
        if (s[j] === ',') j++;
    }
    return { value: arr, next: j };
}

module.exports = GDBDebugger;

GDBDebugger.prototype._cleanupLinuxTTY = async function () {
    if (this._ttyProcess) {
        try { this._ttyProcess.kill(); } catch (_) { }
    }
    if (this._ttyShellPid) {
        try {
            process.kill(this._ttyShellPid, 'SIGTERM');
        } catch (_) { }
        try {
            process.kill(this._ttyShellPid, 0);
            try { process.kill(this._ttyShellPid, 'SIGKILL'); } catch (_) { }
        } catch (_) { }
    }
    this._ttyProcess = null;
    this._ttyPath = null;
    this._ttyPromise = null;
    this._ttyShellPid = null;
    this._ttyMetadata = null;
};

GDBDebugger.prototype._ensureLinuxTTY = async function (options = {}) {
    if (process.platform !== 'linux') return null;
    const force = !!options.force;
    const fs = require('fs');

    const noNewConsole = !!(this._linuxTTYOptions && this._linuxTTYOptions.noNewConsole);
    const directTTY = this._linuxTTYOptions?.inferiorTTY;

    if (noNewConsole && !directTTY) {
        return null;
    }
    if (typeof directTTY === 'string' && directTTY) {
        try {
            fs.accessSync(directTTY, fs.constants.R_OK | fs.constants.W_OK);
            this._ttyProcess = null;
            this._ttyPath = directTTY;
            this._ttyShellPid = null;
            return { ttyPath: directTTY, proc: null, shellPid: null };
        } catch (_) {
            try { global.logWarn?.('[GDB][TTY] 自定义 TTY 路径不可用: ' + directTTY); } catch (_) { }
            this._ttyPath = null;
            this._ttyShellPid = null;
        }
    }

    if (!force && this._ttyPath) {
        try {
            if (fs.existsSync(this._ttyPath)) {
                fs.accessSync(this._ttyPath, fs.constants.R_OK | fs.constants.W_OK);
                return { ttyPath: this._ttyPath, proc: this._ttyProcess, shellPid: this._ttyShellPid };
            }
        } catch (_) {
            this._ttyPath = null;
            this._ttyShellPid = null;
        }
    }

    if (this._ttyPromise) {
        return this._ttyPromise;
    }

    const prepareOptions = { ...(this._linuxTTYOptions || {}) };
    this._ttyPromise = (async () => {
        if (force) {
            if (this._ttyProcess) {
                try { this._ttyProcess.kill(); } catch (_) { }
            }
            this._ttyProcess = null;
            this._ttyPath = null;
        }

        const ttyInfo = await this._prepareLinuxTTY(prepareOptions);
        if (!ttyInfo || !ttyInfo.ttyPath) {
            this._ttyProcess = null;
            this._ttyPath = null;
            this._ttyShellPid = null;
            return null;
        }
        this._ttyProcess = ttyInfo.proc || null;
        this._ttyPath = ttyInfo.ttyPath;
        this._ttyShellPid = ttyInfo.shellPid || null;
        if (this._ttyShellPid) {
            try { global.logInfo?.('[GDB][TTY] Shell PID: ' + this._ttyShellPid); } catch (_) { }
        }
        return ttyInfo;
    })();

    try {
        return await this._ttyPromise;
    } finally {
        this._ttyPromise = null;
    }
};

GDBDebugger.prototype._captureTTYMetadata = function (ttyPath) {
    if (!ttyPath) {
        this._ttyMetadata = null;
        return;
    }
    try {
        const fs = require('fs');
        const stat = fs.statSync(ttyPath);
        const mode = (stat.mode & 0o777).toString(8).padStart(3, '0');
        this._ttyMetadata = {
            path: ttyPath,
            mode,
            uid: stat.uid,
            gid: stat.gid,
            atimeMs: stat.atimeMs,
            mtimeMs: stat.mtimeMs
        };
        try { global.logInfo?.(`[GDB][TTY] 权限: path=${ttyPath}, uid=${stat.uid}, gid=${stat.gid}, mode=${mode}`); } catch (_) { }
    } catch (error) {
        const message = error?.message || String(error);
        this._ttyMetadata = { path: ttyPath, error: message };
        try { global.logWarn?.(`[GDB][TTY] 读取 ${ttyPath} 状态失败: ${message}`); } catch (_) { }
    }
};

GDBDebugger.prototype._bindTTYInGDB = async function (ttyPath) {
    if (!ttyPath) return;
    const rawCommand = `gdb-set inferior-tty ${ttyPath}`;
    try {
        await this._send(rawCommand);
        this._ttyWarningLogged = false;
    } catch (error) {
        const message = error?.message || String(error);
        try { global.logWarn?.(`[GDB][TTY] MI 绑定失败(${ttyPath}): ${message}，尝试 CLI fallback`); } catch (_) { }
        try {
            await this._send(`interpreter-exec console ${miQuote(`set inferior-tty ${ttyPath}`)}`);
            this._ttyWarningLogged = false;
        } catch (cliError) {
            const cliMsg = cliError?.message || String(cliError);
            try { global.logWarn?.(`[GDB][TTY] CLI 绑定 ${ttyPath} 失败: ${cliMsg}`); } catch (_) { }
            throw cliError;
        }
    }
};

GDBDebugger.prototype._prepareLinuxTTY = async function (options = {}) {
    const { spawn, spawnSync } = require('child_process');
    const fs = require('fs');
    if (options.inferiorTTY && typeof options.inferiorTTY === 'string') {
        return { ttyPath: options.inferiorTTY, proc: null, shellPid: null }; // 视为外部管理，不负责关闭
    }

    const terminals = [
        { cmd: 'gnome-terminal', mode: 'gnome' },
        { cmd: 'konsole', mode: 'generic', flag: '-e' },
        { cmd: 'xfce4-terminal', mode: 'generic', flag: '-e' },
        { cmd: 'mate-terminal', mode: 'gnome' },
        { cmd: 'tilix', mode: 'generic', flag: '-e' },
        { cmd: 'xterm', mode: 'generic', flag: '-e' },
        { cmd: 'lxterminal', mode: 'generic', flag: '-e' },
        { cmd: 'alacritty', mode: 'generic', flag: '-e' }
    ];

    function existsInPath(bin) {
        try { const r = spawnSync('which', [bin], { stdio: 'ignore' }); return r.status === 0; } catch (_) { return false; }
    }

    const term = terminals.find(t => existsInPath(t.cmd));
    if (!term) return null; // 没有可用终端则回退为内嵌，不报错

    const base = `/tmp/oicpp_tty_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const ttyFile = `${base}.path`;
    const pidFile = `${base}.pid`;

    const cleanupTempFiles = () => {
        [ttyFile, pidFile].forEach((file) => {
            try { fs.unlinkSync(file); } catch (_) { }
        });
    };

    const bashCmd = [
        'set -e',
        `tty > ${ttyFile}`,
        `echo $$ > ${pidFile}`,
        `chmod 600 ${ttyFile} ${pidFile}`,
        'while true; do sleep 3600; done'
    ].join('; ');

    let proc;
    try {
        if (term.mode === 'gnome') {
            proc = spawn(term.cmd, ['--', 'bash', '-lc', bashCmd], {
                detached: true,
                stdio: 'ignore'
            });
        } else {
            const flag = term.flag || '-e';
            proc = spawn(term.cmd, [flag, 'bash', '-lc', bashCmd], {
                detached: true,
                stdio: 'ignore'
            });
        }
    } catch (e) {
        try { global.logWarn?.('[GDB][TTY] 启动终端失败: ' + e.message); } catch (_) { }
        cleanupTempFiles();
        return null;
    }

    proc.unref();

    const deadline = Date.now() + 5000;
    let ttyPath = null;
    let shellPid = null;
    while (Date.now() < deadline) {
        try {
            if (!ttyPath && fs.existsSync(ttyFile)) {
                const content = (fs.readFileSync(ttyFile, 'utf8') || '').trim();
                if (content.startsWith('/dev/pts/')) {
                    ttyPath = content;
                }
            }
            if (!shellPid && fs.existsSync(pidFile)) {
                const pidStr = (fs.readFileSync(pidFile, 'utf8') || '').trim();
                const parsed = Number(pidStr);
                if (parsed && !Number.isNaN(parsed)) {
                    shellPid = parsed;
                }
            }
            if (ttyPath && shellPid) break;
        } catch (_) { }
        await new Promise((resolve) => setTimeout(resolve, 100));
    }

    if (!ttyPath) {
        cleanupTempFiles();
        try { proc.kill(); } catch (_) { }
        return null;
    }

    const accessDeadline = Date.now() + 3000;
    const openFlags = (fs.constants?.O_RDWR || 0) | (fs.constants?.O_NOCTTY || 0);
    let ttyReady = false;
    while (Date.now() < accessDeadline) {
        try {
            const fd = fs.openSync(ttyPath, openFlags);
            fs.closeSync(fd);
            ttyReady = true;
            break;
        } catch (_) {
            await new Promise((resolve) => setTimeout(resolve, 50));
        }
    }

    if (!ttyReady) {
        cleanupTempFiles();
        try { proc.kill(); } catch (_) { }
        return null;
    }

    cleanupTempFiles();
    return { ttyPath, proc, shellPid };
};
