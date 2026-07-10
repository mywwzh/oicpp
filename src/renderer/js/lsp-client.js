class LspClientBridge {
    constructor() {
        this._ready = false;
        this._readyPromise = null;
        this._serverCapabilities = null;
        this._semanticTokensLegend = null;
        this._readyListeners = new Set();
        this._diagnosticListeners = new Set();
        this._notificationListeners = new Set();
        this._bindNotifications();
    }

    _bindNotifications() {
        if (!window.electronAPI || typeof window.electronAPI.onLspNotification !== 'function') {
            return;
        }
        window.electronAPI.onLspNotification((payload) => {
            if (!payload || typeof payload.method !== 'string') {
                return;
            }
            if (payload.method === 'textDocument/publishDiagnostics') {
                const params = payload.params || {};
                const uri = params.uri || '';
                const diagnostics = Array.isArray(params.diagnostics) ? params.diagnostics : [];
                this._diagnosticListeners.forEach((listener) => {
                    try { listener(uri, diagnostics); } catch (_) {}
                });
            }
            this._notificationListeners.forEach((listener) => {
                try { listener(payload); } catch (_) {}
            });
        });
    }

    async start(options = {}) {
        if (this._readyPromise) {
            return this._readyPromise;
        }
        this._readyPromise = this._startInternal(options);
        return this._readyPromise;
    }

    async restart(options = {}) {
        this._ready = false;
        this._readyPromise = null;
        this._readyPromise = this._restartInternal(options).catch((err) => {
            this._readyPromise = null;
            throw err;
        });
        return this._readyPromise;
    }

    async _restartInternal(options = {}) {
        const api = window.electronAPI;
        if (!api) {
            throw new Error('LSP API unavailable');
        }

        if (typeof api.lspRestart === 'function') {
            const startResult = await api.lspRestart({
                workspaceRoot: options.workspaceRoot || '',
                clangdArgs: Array.isArray(options.clangdArgs) ? options.clangdArgs : [],
                fallbackFlags: Array.isArray(options.fallbackFlags) ? options.fallbackFlags : [],
                compilerPath: options.compilerPath || '',
                rootUri: options.rootUri || ''
            });

            if (!startResult || startResult.ok !== true) {
                const errMsg = startResult?.error || (window.i18n ? window.i18n.t('lsp.restartFailUnknown') : 'clangd 重启失败（未知原因）');
                logError('[LSP] clangd 重启失败:', errMsg);
                throw new Error('clangd restart failed: ' + errMsg);
            }

            if (startResult.alreadyRunning) {
                logInfo('[LSP] clangd 已在运行中，复用现有进程');
            } else {
                logInfo('[LSP] clangd 进程已启动:', startResult.clangdPath || '');
            }

            return await this._finishStartup(startResult, options);
        }

        if (typeof api.lspStop === 'function') {
            await api.lspStop();
        }
        return await this._startInternal(options);
    }

    async _startInternal(options = {}) {
        const api = window.electronAPI;
        if (!api || typeof api.lspStart !== 'function') {
            logError('[LSP] LSP API 不可用，无法启动');
            throw new Error('LSP API unavailable');
        }

        const rootUri = options.rootUri || '';
        const workspaceFolders = rootUri
            ? [{ uri: rootUri, name: options.workspaceName || 'workspace' }]
            : [];

        logInfo('[LSP] 正在启动 clangd LSP 客户端...');
        logInfo('[LSP] 工作区根目录:', options.workspaceRoot || '(无)');
        logInfo('[LSP] rootUri:', rootUri || '(无)');
        if (Array.isArray(options.fallbackFlags) && options.fallbackFlags.length > 0) {
            logInfo('[LSP] 回退编译参数:', options.fallbackFlags.join(' '));
        }
        if (options.compilerPath) {
            logInfo('[LSP] 编译器路径:', options.compilerPath);
        }

        const startResult = await api.lspStart({
            workspaceRoot: options.workspaceRoot || '',
            clangdArgs: Array.isArray(options.clangdArgs) ? options.clangdArgs : [],
            fallbackFlags: Array.isArray(options.fallbackFlags) ? options.fallbackFlags : [],
            compilerPath: options.compilerPath || '',
            rootUri
        });

        // 检查 clangd 启动结果
        if (!startResult || startResult.ok !== true) {
            const errMsg = startResult?.error || (window.i18n ? window.i18n.t('lsp.startFailUnknown') : 'clangd 启动失败（未知原因）');
            logError('[LSP] clangd 启动失败:', errMsg);
            throw new Error('clangd start failed: ' + errMsg);
        }

        if (startResult.alreadyRunning) {
            logInfo('[LSP] clangd 已在运行中，复用现有进程');
        } else {
            logInfo('[LSP] clangd 进程已启动:', startResult.clangdPath || '');
        }

        // 使用主进程返回的 fallbackFlags（已包含编译器 include 路径）
        const effectiveFallbackFlags = Array.isArray(startResult.fallbackFlags)
            ? startResult.fallbackFlags
            : (Array.isArray(options.fallbackFlags) ? options.fallbackFlags : []);

        return await this._finishStartup(startResult, options, api, effectiveFallbackFlags);
    }

    async _finishStartup(startResult, options = {}, api = window.electronAPI, effectiveFallbackFlags = null) {
        const rootUri = options.rootUri || '';
        const workspaceFolders = rootUri
            ? [{ uri: rootUri, name: options.workspaceName || 'workspace' }]
            : [];

        const fallbackFlags = Array.isArray(effectiveFallbackFlags)
            ? effectiveFallbackFlags
            : (Array.isArray(startResult?.fallbackFlags)
                ? startResult.fallbackFlags
                : (Array.isArray(options.fallbackFlags) ? options.fallbackFlags : []));

        logInfo('[LSP] 发送 initialize 请求...');

        const initializeParams = {
            processId: null,
            rootUri: rootUri || null,
            workspaceFolders,
            capabilities: {
                textDocument: {
                    synchronization: {
                        didSave: true,
                        willSave: false,
                        willSaveWaitUntil: false
                    },
                    completion: {
                        completionItem: {
                            snippetSupport: true,
                            insertReplaceSupport: true,
                            resolveSupport: {
                                properties: ['detail', 'documentation', 'additionalTextEdits']
                            }
                        },
                        contextSupport: true,
                        dynamicRegistration: false
                    },
                    hover: {
                        contentFormat: ['markdown', 'plaintext']
                    },
                    signatureHelp: {
                        signatureInformation: {
                            documentationFormat: ['markdown', 'plaintext'],
                            parameterInformation: {
                                labelOffsetSupport: true
                            }
                        }
                    },
                    definition: {
                        linkSupport: true
                    },
                    documentSymbol: {
                        hierarchicalDocumentSymbolSupport: true,
                        symbolKind: {
                            valueSet: [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26]
                        }
                    },
                    references: {},
                    semanticTokens: {
                        requests: { full: true },
                        tokenTypes: [],
                        tokenModifiers: [],
                        formats: ['relative']
                    }
                },
                workspace: {
                    workspaceFolders: true
                }
            },
            initializationOptions: {
                fallbackFlags
            }
        };

        const initResult = await api.lspRequest('initialize', initializeParams);
        this._serverCapabilities = initResult && initResult.capabilities ? initResult.capabilities : null;
        this._semanticTokensLegend = this._serverCapabilities?.semanticTokensProvider?.legend || null;

        const serverInfo = initResult?.serverInfo || {};
        logInfo('[LSP] 初始化完成, 服务器:', serverInfo.name || 'clangd', '版本:', serverInfo.version || '?');
        if (this._semanticTokensLegend) {
            logInfo('[LSP] 语义令牌支持: ' + (this._semanticTokensLegend.tokenTypes?.length || 0) + ' 种类型, ' + (this._semanticTokensLegend.tokenModifiers?.length || 0) + ' 种修饰符');
        }

        await api.lspNotify('initialized', {});
        this._ready = true;
        logInfo('[LSP] clangd LSP 客户端就绪');

        this._readyListeners.forEach((listener) => {
            try { listener(this); } catch (_) {}
        });
        return initResult;
    }

    async request(method, params) {
        const api = window.electronAPI;
        if (!api || typeof api.lspRequest !== 'function') {
            throw new Error('LSP request API unavailable');
        }
        return await api.lspRequest(method, params);
    }

    async notify(method, params) {
        const api = window.electronAPI;
        if (!api || typeof api.lspNotify !== 'function') {
            throw new Error('LSP notify API unavailable');
        }
        const result = await api.lspNotify(method, params);
        // 检查通知是否发送成功（进程可能已停止）
        if (result && result.ok === false) {
            logWarn('[LSP] 通知发送失败 (' + method + '):', result.error || '未知错误');
        }
        return result;
    }

    onReady(listener) {
        if (typeof listener !== 'function') return () => {};
        this._readyListeners.add(listener);
        if (this._ready) {
            try { listener(this); } catch (_) {}
        }
        return () => this._readyListeners.delete(listener);
    }

    onDiagnostics(listener) {
        if (typeof listener !== 'function') return () => {};
        this._diagnosticListeners.add(listener);
        return () => this._diagnosticListeners.delete(listener);
    }

    onNotification(listener) {
        if (typeof listener !== 'function') return () => {};
        this._notificationListeners.add(listener);
        return () => this._notificationListeners.delete(listener);
    }

    getSemanticTokensLegend() {
        return this._semanticTokensLegend;
    }

    getServerCapabilities() {
        return this._serverCapabilities;
    }
}

window.LspClientBridge = LspClientBridge;
window.lspClient = window.lspClient || new LspClientBridge();
