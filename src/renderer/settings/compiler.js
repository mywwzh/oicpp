class CompilerSettings {
    constructor() {
        this.settings = {
            compilerPath: '',
            pythonInterpreterPath: '',
            compilerArgs: '-std=c++14 -O2 -static'
        }
        
        this.init();
    }
    
    setupSidebarNavigation() {
        const sidebarItems = document.querySelectorAll('.sidebar-item');
        const sections = document.querySelectorAll('.settings-section');

        sidebarItems.forEach(item => {
            item.addEventListener('click', () => {
                sidebarItems.forEach(i => i.classList.remove('active'));
                item.classList.add('active');

                sections.forEach(section => section.classList.remove('active'));
                
                const targetId = item.getAttribute('data-target');
                const targetSection = document.getElementById(targetId);
                if (targetSection) {
                    targetSection.classList.add('active');
                }
            });
        });
    }

    async init() {
        const urlParams = new URLSearchParams(window.location.search);
        const themeFromUrl = urlParams.get('theme');
        if (themeFromUrl) {
            this.applyTheme(themeFromUrl);
        }
        await this.loadSettings();
        this.setupEventListeners();
        this.setupThemeListener();
        await this.applyCurrentTheme();
        this.updateUI();
        this.detectExistingCompiler();
    }

    setupThemeListener() {
        if (window.electronIPC && window.electronIPC.on) {
            window.electronIPC.on('theme-changed', (event, theme) => {
                logInfo('编译器设置页面收到主题变更:', theme);
                this.applyTheme(theme);
            });
        }
    }

    async applyCurrentTheme() {
        try {
            if (window.electronAPI && window.electronAPI.getAllSettings) {
                const settings = await window.electronAPI.getAllSettings();
                if (settings && settings.theme) {
                    this.applyTheme(settings.theme);
                }
            }
        } catch (error) {
            logError('获取主题设置失败:', error);
        }
    }

    applyTheme(theme) {
        logInfo('应用主题到编译器设置页面:', theme);
        document.body.setAttribute('data-theme', theme);
        document.documentElement.setAttribute('data-theme', theme);
    }

    setupEventListeners() {
        logInfo('[编译器设置] 开始设置事件监听器');
        
        this.setupSidebarNavigation();
        
        const browseBtn = document.getElementById('browse-compiler');
        if (browseBtn) {
            logInfo('[编译器设置] 浏览编译器按钮事件已绑定');
            browseBtn.addEventListener('click', (e) => {
                logInfo('[编译器设置] 浏览编译器按钮被点击');
                e.preventDefault();
                this.browseCompiler();
            });
        } else {
            logError('[编译器设置] 未找到浏览编译器按钮');
        }

        const browsePythonBtn = document.getElementById('browse-python-interpreter');
        if (browsePythonBtn) {
            browsePythonBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.browsePythonInterpreter();
            });
        }
        
        const browseTestlibBtn = document.getElementById('browse-testlib');
        if (browseTestlibBtn) {
            browseTestlibBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.browseTestlib();
            });
        }
        
        const installBtn = document.getElementById('install-compiler');
        if (installBtn) {
            this.getCurrentPlatform().then(p => {
                if (p !== 'windows') {
                    installBtn.disabled = true;
                    installBtn.title = '非 Windows 平台请使用系统自带/自行安装的编译器';
                    installBtn.textContent = '下载已禁用 (请使用系统编译器)';
                } else {
                    logInfo('[编译器设置] 安装编译器按钮事件已绑定');
                    installBtn.addEventListener('click', (e) => {
                        logInfo('[编译器设置] 安装编译器按钮被点击');
                        e.preventDefault();
                        this.showInstallDialog();
                    });
                }
            });
        }
        
        const installTestlibBtn = document.getElementById('install-testlib');
        if (installTestlibBtn) {       
          installTestlibBtn.addEventListener('click', (e) => {
              e.preventDefault();
              this.showTestlibInstallDialog();
          });
        }
        
        const closeBtn = document.getElementById('close-install-dialog');
        if (closeBtn) {
            logInfo('[编译器设置] 关闭安装对话框按钮事件已绑定');
            closeBtn.addEventListener('click', (e) => {
                logInfo('[编译器设置] 关闭安装对话框按钮被点击');
                e.preventDefault();
                this.closeInstallDialog();
            });
        }
        
        const closeTestlibBtn = document.getElementById('close-testlib-install-dialog');
        if (closeTestlibBtn) {
            closeTestlibBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.closeTestlibInstallDialog();
            });
        }
        
        const installDialog = document.getElementById('install-dialog');
        if (installDialog) {
            installDialog.addEventListener('click', (e) => {
                if (e.target === installDialog) {
                    logInfo('[编译器设置] 点击对话框背景关闭');
                    this.closeInstallDialog();
                }
            });
        }
        
        const saveBtn = document.getElementById('save-settings');
        if (saveBtn) {
            logInfo('[编译器设置] 保存设置按钮事件已绑定');
            saveBtn.addEventListener('click', (e) => {
                logInfo('[编译器设置] 保存设置按钮被点击');
                e.preventDefault();
                this.saveSettings();
            });
        } else {
            logError('[编译器设置] 未找到保存设置按钮');
        }
        
        const cancelBtn = document.getElementById('cancel-settings');
        if (cancelBtn) {
            logInfo('[编译器设置] 取消按钮事件已绑定');
            cancelBtn.addEventListener('click', (e) => {
                logInfo('[编译器设置] 取消按钮被点击');
                e.preventDefault();
                this.closeWindow();
            });
        } else {
            logError('[编译器设置] 未找到取消按钮');
        }
        
        const resetBtn = document.getElementById('reset-settings');
        if (resetBtn) {
            logInfo('[编译器设置] 重置按钮事件已绑定');
            resetBtn.addEventListener('click', (e) => {
                logInfo('[编译器设置] 重置按钮被点击');
                e.preventDefault();
                this.resetSettings();
            });
        }
        
        const compilerOptions = document.getElementById('compiler-options');
        if (compilerOptions) {
            compilerOptions.addEventListener('input', (e) => {
                logInfo('[编译器设置] 编译器选项发生变化:', e.target.value);
                this.settings.compilerArgs = e.target.value;
            });
            logInfo('[编译器设置] 编译器选项变化监听已绑定');
        } else {
            logError('[编译器设置] 未找到编译器选项元素');
        }
        
        const compilerPath = document.getElementById('compiler-path');
        if (compilerPath) {
            compilerPath.addEventListener('input', (e) => {
                logInfo('[编译器设置] 编译器路径发生变化:', e.target.value);
                this.settings.compilerPath = e.target.value;
            });
            logInfo('[编译器设置] 编译器路径变化监听已绑定');
        } else {
            logError('[编译器设置] 未找到编译器路径元素');
        }

        const pythonInterpreterPath = document.getElementById('python-interpreter-path');
        if (pythonInterpreterPath) {
            pythonInterpreterPath.addEventListener('input', (e) => {
                this.settings.pythonInterpreterPath = e.target.value;
            });
        }
        
        const testTestlibBtn = document.getElementById('test-testlib');
        if (testTestlibBtn) {
            testTestlibBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.testTestlib();
            });
        }
        
        const closeDialogBtn = document.getElementById('close-install-dialog');
        if (closeDialogBtn) {
            closeDialogBtn.addEventListener('click', () => {
                logInfo('[编译器设置] 关闭安装对话框按钮被点击');
                this.closeInstallDialog();
            });
        }
    }

    async loadSettings() {
        try {
            const allSettings = await window.electronAPI.getAllSettings();
            if (allSettings) {
                this.settings = {
                    compilerPath: allSettings.compilerPath || '',
                    pythonInterpreterPath: allSettings.pythonInterpreterPath || '',
                    compilerArgs: allSettings.compilerArgs || '-std=c++14 -O2 -static',
                    testlibPath: allSettings.testlibPath || ''
                };
            }
            logInfo('编译器设置加载完成:', this.settings);
        } catch (error) {
            logError('加载编译器设置失败:', error);
        }
    }

    updateUI() {
        const compilerPathInput = document.getElementById('compiler-path');
        const pythonInterpreterPathInput = document.getElementById('python-interpreter-path');
        const compilerOptionsInput = document.getElementById('compiler-options');
        const testlibPathInput = document.getElementById('testlib-path');
        
        if (compilerPathInput) compilerPathInput.value = this.settings.compilerPath || '';
        if (pythonInterpreterPathInput) pythonInterpreterPathInput.value = this.settings.pythonInterpreterPath || '';
        if (compilerOptionsInput) compilerOptionsInput.value = this.settings.compilerArgs || '-std=c++14 -O2 -static';
        if (testlibPathInput) testlibPathInput.value = this.settings.testlibPath || '';
    }

    async browsePythonInterpreter() {
        try {
            const platform = await this.getCurrentPlatform();
            let title = '选择 Python 解释器';
            let filters = [{ name: '所有文件', extensions: ['*'] }];

            if (platform === 'windows') {
                title = '选择 Python 解释器 (python.exe)';
                filters = [
                    { name: '可执行文件 (*.exe)', extensions: ['exe'] },
                    { name: '所有文件', extensions: ['*'] }
                ];
            }

            const result = await window.electronAPI.showOpenDialog({
                title,
                filters,
                properties: ['openFile']
            });

            if (!result.canceled && result.filePaths.length > 0) {
                const selectedPath = result.filePaths[0];
                this.settings.pythonInterpreterPath = selectedPath;
                const input = document.getElementById('python-interpreter-path');
                if (input) {
                    input.value = selectedPath;
                }
                this.showMessage('已选择 Python 解释器', 'success');
            }
        } catch (error) {
            logError('浏览 Python 解释器失败:', error);
            this.showMessage('浏览 Python 解释器失败：' + error.message, 'error');
        }
    }

    async browseCompiler() {
        try {
            const platform = await this.getCurrentPlatform();
            let title = '选择 C++ 编译器';
            let filters = [];
            let defaultPath = '';

            if (platform === 'windows') {
                title = '选择 C++ 编译器 (请选择 g++.exe / gcc.exe / clang++.exe)';
                filters = [
                    { name: '可执行文件 (*.exe)', extensions: ['exe'] },
                    { name: '所有文件', extensions: ['*'] }
                ];
                defaultPath = '';
            } else {
                title = '选择 C++ 编译器 (g++, gcc, clang++)';
                filters = [
                    { name: '所有文件', extensions: ['*'] }
                ];
            }

            const result = await window.electronAPI.showOpenDialog({
                title,
                defaultPath,
                filters,
                properties: ['openFile']
            });
            if (platform !== 'windows') {
                logInfo('[编译器设置] 非 Windows 平台选择结果:', result);
            }
            
            if (!result.canceled && result.filePaths.length > 0) {
        const selectedPath = result.filePaths[0];
        const fileName = selectedPath.split(/[\\\/]/).pop().toLowerCase();
        const isWin = platform === 'windows';
        const looksLikeCompiler = fileName.includes('g++') || fileName.includes('gcc') || fileName.includes('clang++') || (!isWin && fileName.includes('clang'));

        if (!looksLikeCompiler) {
                    const confirmed = await this.showConfirmDialog(
                        '文件选择确认',
            `您选择的文件是 "${fileName}"，这可能不是 C++ 编译器。\n\n推荐选择：\n• g++ (推荐)\n• gcc\n• clang++\n\n是否继续使用此文件？`,
                        '继续使用',
                        '重新选择'
                    );
                    
                    if (!confirmed) {
                        return this.browseCompiler();
                    }
                }
                
                this.settings.compilerPath = selectedPath;
                document.getElementById('compiler-path').value = this.settings.compilerPath;
                
                this.showMessage(`已选择编译器: ${fileName}`, 'success');
                
            } else if (platform !== 'windows' && !result.canceled) {
                this.showMessage('未选择文件，请确认有权限访问 /usr/bin 或自定义安装路径', 'error');
            }
        } catch (error) {
            logError('浏览编译器失败:', error);
            this.showMessage('浏览编译器失败：' + error.message, 'error');
        }
    }



    showInstallDialog() {
        const dialog = document.getElementById('install-dialog');
        if (dialog) {
            dialog.style.display = 'block';
        }
        
        this.loadAvailableCompilers();
    }

    closeInstallDialog() {
        const dialog = document.getElementById('install-dialog');
        if (dialog) {
            dialog.style.display = 'none';
        }
    }

    async loadAvailableCompilers() {
        const compilerList = document.getElementById('compiler-list');
        if (!compilerList) return;
        
        compilerList.innerHTML = '<div class="loading">正在获取编译器列表...</div>';
        
        try {
            const response = await fetch('https://oicpp.mywwzh.top/api/getAvailableCompilerList');
            
            if (!response.ok) {
                throw new Error(`网络错误: ${response.status} ${response.statusText}`);
            }
            
            const compilers = await response.json();
            
            logInfo('[编译器设置] 服务器返回的编译器数据:', compilers);
            if (compilers && compilers.length > 0) {
                logInfo('[编译器设置] 第一个编译器对象结构:', compilers[0]);
            }
            
            compilerList.innerHTML = '';
            
            if (!compilers || compilers.length === 0) {
                compilerList.innerHTML = '<div class="no-compilers">暂无可用编译器</div>';
                return;
            }
            
            const platform = await this.getCurrentPlatform();
            
            const platformCompilers = compilers.filter(compiler => 
                compiler.platform && compiler.platform.toLowerCase() === platform.toLowerCase()
            );
            
            if (platformCompilers.length === 0) {
                compilerList.innerHTML = `<div class="no-compilers">暂无适用于 ${platform} 平台的编译器</div>`;
                return;
            }
            
            const downloadedVersions = await this.getDownloadedVersions();
            
            for (const compiler of platformCompilers) {
                const isDownloaded = downloadedVersions.includes(compiler.version);
                const isSelected = await this.isCompilerSelected(compiler.version);
                
                const compilerDiv = document.createElement('div');
                compilerDiv.className = `compiler-item ${isDownloaded ? 'downloaded' : ''} ${isSelected ? 'selected' : ''}`;
                
                compilerDiv.innerHTML = `
                    <div class="compiler-info">
                        <h4>${compiler.name}</h4>
                        <p>版本: ${compiler.version}</p>
                        <span class="platform">平台: ${compiler.platform}</span>
                    </div>
                    <div class="compiler-actions">
                        ${isSelected ? 
                            '<span class="status selected-status">已选中</span>' :
                            isDownloaded ? 
                                `<button class="select-btn" data-version="${compiler.version}">选择</button>` :
                                `<button class="download-btn" data-url="${compiler.download_url}" data-version="${compiler.version}" data-name="${compiler.name}">下载</button>`
                        }
                        ${isDownloaded ? '<span class="status downloaded-status">已下载</span>' : ''}
                    </div>
                `;
                
                this.addCompilerItemListeners(compilerDiv, compiler);
                
                compilerList.appendChild(compilerDiv);
            }
            
        } catch (error) {
            logError('获取编译器列表失败:', error);
            compilerList.innerHTML = `
                <div class="error-message">
                    <p>网络错误：无法获取编译器列表</p>
                    <p class="error-detail">${error.message}</p>
                    <button class="retry-btn" onclick="this.loadAvailableCompilers()">重试</button>
                </div>
            `;
        }
    }

    async saveSettings() {
        try {
            const compilerPath = document.getElementById('compiler-path').value;
            const pythonInterpreterPath = document.getElementById('python-interpreter-path').value;
            const compilerArgs = document.getElementById('compiler-options').value;
            
            const newSettings = {
                compilerPath: compilerPath,
                pythonInterpreterPath: pythonInterpreterPath,
                compilerArgs: compilerArgs
            };
            
            logInfo('准备保存编译器设置:', newSettings);
            
            if (window.electronAPI && window.electronAPI.updateSettings) {
                const result = await window.electronAPI.updateSettings(newSettings);
                logInfo('保存设置结果:', result);
                if (result.success) {
                    this.showMessage('编译器设置保存成功！', 'success');
                    
                    setTimeout(() => {
                        this.closeWindow();
                    }, 1000);
                } else {
                    this.showMessage('保存设置失败：' + (result.error || '未知错误'), 'error');
                }
            } else {
                this.showMessage('设置 API 不可用', 'error');
            }
            
        } catch (error) {
            logError('保存编译器设置失败:', error);
            this.showMessage('保存设置失败：' + error.message, 'error');
        }
    }

    async resetSettings() {
        try {
            if (window.electronAPI && window.electronAPI.resetSettings) {
                const result = await window.electronAPI.resetSettings();
                if (result.success) {
                    await this.loadSettings();
                    this.updateUI();
                    this.showMessage('编译器设置已重置为默认值', 'success');
                } else {
                    this.showMessage('重置设置失败：' + (result.error || '未知错误'), 'error');
                }
            } else {
                this.showMessage('设置 API 不可用', 'error');
            }
        } catch (error) {
            logError('重置设置失败:', error);
            this.showMessage('重置设置失败：' + error.message, 'error');
        }
    }

    detectExistingCompiler() {
        logInfo('编译器自动检测功能在当前安全配置下不可用，请手动选择编译器路径');
    }

    async getCurrentPlatform() {
        if (window.electronAPI && window.electronAPI.getPlatform) {
            return await window.electronAPI.getPlatform();
        }
        
        const userAgent = navigator.userAgent.toLowerCase();
    if (userAgent.includes('win')) return 'windows';
    if (userAgent.includes('linux')) return 'linux';
        return 'windows'; // 默认
    }

    async getDownloadedVersions() {
        try {
            if (window.electronAPI && window.electronAPI.getDownloadedCompilers) {
                return await window.electronAPI.getDownloadedCompilers();
            }
        } catch (error) {
            logError('获取已下载编译器失败:', error);
        }
        return [];
    }

    async isCompilerSelected(version) {
        try {
            if (window.electronAPI && window.electronAPI.getAllSettings) {
                const settings = await window.electronAPI.getAllSettings();
                const userHome = await window.electronAPI.getUserHome();
                
                if (!settings.compilerPath) {
                    return false;
                }
                
                const normalizePathPath = (path) => {
                    return path.replace(/\\/g, '/').replace(/\/+/g, '/');
                };
                
                const currentPath = normalizePathPath(settings.compilerPath);
                const expectedPath = normalizePathPath(`${userHome}/.oicpp/Compilers/${version}`);
                
                const isMatch = currentPath.includes(expectedPath);
                
                logInfo(`检查编译器选中状态 - 版本: ${version}`);
                logInfo(`当前编译器路径: ${currentPath}`);
                logInfo(`期望路径包含: ${expectedPath}`);
                logInfo(`匹配结果: ${isMatch}`);
                
                return isMatch;
            }
        } catch (error) {
            logError('检查编译器选中状态失败:', error);
        }
        return false;
    }

    addCompilerItemListeners(compilerDiv, compiler) {
        const downloadBtn = compilerDiv.querySelector('.download-btn');
        if (downloadBtn) {
            logInfo('绑定下载按钮事件，编译器:', compiler.name, compiler.version);
            downloadBtn.addEventListener('click', (e) => {
                logInfo('下载按钮被点击，编译器:', compiler);
                e.preventDefault();
                this.downloadCompiler(compiler);
            });
        }

        const selectBtn = compilerDiv.querySelector('.select-btn');
        if (selectBtn) {
            logInfo('绑定选择按钮事件，版本:', compiler.version);
            selectBtn.addEventListener('click', (e) => {
                logInfo('选择按钮被点击，版本:', compiler.version);
                e.preventDefault();
                this.selectCompiler(compiler.version);
            });
        }

        const retryBtn = compilerDiv.querySelector('.retry-btn');
        if (retryBtn) {
            retryBtn.addEventListener('click', (e) => {
                logInfo('重试按钮被点击');
                e.preventDefault();
                this.loadAvailableCompilers();
            });
        }
    }

    async downloadCompiler(compiler) {
        logInfo('[编译器设置] 开始下载编译器流程:', compiler);

        const downloadBtn = document.querySelector(`button.download-btn[data-version="${compiler.version}"]`);
        if (!downloadBtn) {
            logError('[编译器设置] 未找到下载按钮，compiler.version:', compiler.version);
            return;
        }

        try {
            downloadBtn.disabled = true;
            downloadBtn.textContent = '下载中...';
            logInfo('[编译器设置] 按钮状态已更新为下载中');

            this.showMessage(`开始下载 ${compiler.name} ${compiler.version}...`, 'info');

            logInfo('[编译器设置] 准备调用下载API，参数:', {
                url: compiler.download_url,
                version: compiler.version,
                name: compiler.name
            });

            if (window.electronAPI && window.electronAPI.downloadCompiler) {
                logInfo('[编译器设置] 调用electronAPI.downloadCompiler');
                const result = await window.electronAPI.downloadCompiler({
                    url: compiler.download_url,
                    version: compiler.version,
                    name: compiler.name
                });

                logInfo('[编译器设置] downloadCompiler返回结果:', result);

                if (result.success) {
                    logInfo('[编译器设置] 下载成功，准备更新UI状态');
                    this.showMessage(`${compiler.name} ${compiler.version} 下载并安装成功！`, 'success');
                    
                    downloadBtn.textContent = '已下载';
                    downloadBtn.disabled = false;
                    downloadBtn.classList.remove('download-btn');
                    downloadBtn.classList.add('downloaded-btn');
                    logInfo('[编译器设置] 按钮状态已更新为已下载');
                    
                    if (result.compilerPath) {
                        logInfo('[编译器设置] 设置编译器路径:', result.compilerPath);
                        await this.setCompilerPath(result.compilerPath);
                        
                        logInfo('[编译器设置] 自动选择刚下载的编译器');
                        await this.selectCompiler(compiler.version);
                    } else {
                        this.refreshCompilerItemState(compiler.version, 'downloaded');
                    }
                } else {
                    logError('[编译器设置] 下载失败，result.success为false:', result);
                    throw new Error(result.error || '下载失败');
                }
            } else {
                logError('[编译器设置] 下载 API 不可用');
                throw new Error('下载 API 不可用');
            }

        } catch (error) {
            logError('[编译器设置] 下载编译器失败:', error);
            this.showMessage(`下载失败: ${error.message}`, 'error');
            
            if (downloadBtn) {
                downloadBtn.disabled = false;
                downloadBtn.textContent = '下载';
                logInfo('[编译器设置] 按钮状态已恢复为下载');
            }
        }
    }

    async selectCompiler(version) {
        try {
            if (window.electronAPI && window.electronAPI.selectCompiler) {
                const result = await window.electronAPI.selectCompiler(version);
                
                if (result.success) {
                    await this.setCompilerPath(result.compilerPath);
                    
                    logInfo(`开始重置所有编译器状态，当前选择版本: ${version}`);
                    
                    const allCompilerItems = document.querySelectorAll('.compiler-item');
                    logInfo(`找到 ${allCompilerItems.length} 个编译器项`);
                    
                    allCompilerItems.forEach(item => {
                        let itemVersion = null;
                        
                        const versionEl = item.querySelector('[data-version]');
                        if (versionEl) {
                            itemVersion = versionEl.getAttribute('data-version');
                        }
                        
                        if (!itemVersion) {
                            const buttonEl = item.querySelector('button[data-version]');
                            if (buttonEl) {
                                itemVersion = buttonEl.getAttribute('data-version');
                            }
                        }
                        
                        if (!itemVersion) {
                            const infoDiv = item.querySelector('.compiler-info');
                            if (infoDiv) {
                                const versionText = infoDiv.textContent;
                                const versionMatch = versionText.match(/版本:\s*([^\s]+)/);
                                if (versionMatch) {
                                    itemVersion = versionMatch[1];
                                }
                            }
                        }
                        
                        logInfo(`编译器项版本: ${itemVersion}，当前选择: ${version}`);
                        
                        if (itemVersion) {
                            if (itemVersion !== version) {
                                if (item.classList.contains('selected') || item.querySelector('.selected-status')) {
                                    logInfo(`重置编译器 ${itemVersion} 为已下载状态`);
                                    this.refreshCompilerItemState(itemVersion, 'downloaded');
                                }
                            }
                        }
                    });
                    
                    logInfo(`设置编译器 ${version} 为选中状态`);
                    this.refreshCompilerItemState(version, 'selected');
                    
                    this.showMessage(`已选择编译器版本 ${version}`, 'success');
                    
                } else {
                    throw new Error(result.error || '选择编译器失败');
                }
            } else {
                throw new Error('选择编译器 API 不可用');
            }
        } catch (error) {
            logError('选择编译器失败:', error);
            this.showMessage(`选择编译器失败: ${error.message}`, 'error');
        }
    }

    async setCompilerPath(path) {
        this.settings.compilerPath = path;
        const compilerPathInput = document.getElementById('compiler-path');
        if (compilerPathInput) {
            compilerPathInput.value = path;
        }
        
        try {
            const newSettings = {
                compilerPath: path,
                compilerArgs: this.settings.compilerArgs
            };
            
            logInfo('自动保存编译器路径设置:', newSettings);
            
            if (window.electronAPI && window.electronAPI.updateSettings) {
                const result = await window.electronAPI.updateSettings(newSettings);
                if (result.success) {
                    logInfo('编译器路径设置已自动保存');
                } else {
                    logError('自动保存编译器路径失败:', result.error);
                }
            }
        } catch (error) {
            logError('自动保存编译器路径时出错:', error);
        }
    }

    showMessage(message, type = 'info') {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message-toast ${type}`;
        messageDiv.textContent = message;
        messageDiv.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 12px 20px;
            border-radius: 4px;
            color: white;
            font-weight: bold;
            z-index: 9999;
            opacity: 0;
            transition: opacity 0.3s;
        `;
        
        switch (type) {
            case 'success':
                messageDiv.style.backgroundColor = '#4CAF50';
                break;
            case 'error':
                messageDiv.style.backgroundColor = '#f44336';
                break;
            default:
                messageDiv.style.backgroundColor = '#2196F3';
        }
        
        try {
            if (type === 'error') {
                const errObj = message instanceof Error ? message : new Error(String(message));
                logError('[CompilerSettingsToastError]', { message: String(message), stack: errObj.stack });
            }
        } catch (_) {}
        document.body.appendChild(messageDiv);
        
        requestAnimationFrame(() => {
            messageDiv.style.opacity = '1';
        });
        
        setTimeout(() => {
            messageDiv.style.opacity = '0';
            setTimeout(() => {
                if (messageDiv.parentNode) {
                    messageDiv.parentNode.removeChild(messageDiv);
                }
            }, 300);
        }, 3000);
    }

    showConfirmDialog(title, message, confirmText = '确定', cancelText = '取消') {
        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.className = 'dialog-overlay';
            overlay.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background-color: rgba(0, 0, 0, 0.5);
                display: flex;
                justify-content: center;
                align-items: center;
                z-index: 10000;
            `;
            
            const dialog = document.createElement('div');
            dialog.className = 'confirm-dialog';
            dialog.style.cssText = `
                background: white;
                border-radius: 8px;
                padding: 20px;
                min-width: 300px;
                max-width: 500px;
                box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
            `;
            
            dialog.innerHTML = `
                <div style="margin-bottom: 15px;">
                    <h3 style="margin: 0; color: #333; font-size: 16px;">${title}</h3>
                </div>
                <div style="margin-bottom: 20px; line-height: 1.5; white-space: pre-line;">
                    ${message}
                </div>
                <div style="text-align: right;">
                    <button class="cancel-btn" style="
                        margin-right: 10px;
                        padding: 8px 16px;
                        border: 1px solid #ddd;
                        background: #f5f5f5;
                        border-radius: 4px;
                        cursor: pointer;
                    ">${cancelText}</button>
                    <button class="confirm-btn" style="
                        padding: 8px 16px;
                        border: none;
                        background: #007acc;
                        color: white;
                        border-radius: 4px;
                        cursor: pointer;
                    ">${confirmText}</button>
                </div>
            `;
            
            overlay.appendChild(dialog);
            document.body.appendChild(overlay);
            
            const confirmBtn = dialog.querySelector('.confirm-btn');
            const cancelBtn = dialog.querySelector('.cancel-btn');
            
            const cleanup = () => {
                document.body.removeChild(overlay);
            };
            
            confirmBtn.addEventListener('click', () => {
                cleanup();
                resolve(true);
            });
            
            cancelBtn.addEventListener('click', () => {
                cleanup();
                resolve(false);
            });
            
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) {
                    cleanup();
                    resolve(false);
                }
            });
        });
    }

    refreshCompilerItemState(version, newState) {
        logInfo(`刷新编译器项状态: ${version} -> ${newState}`);
        
        let compilerItem = null;
        
        const versionEl = document.querySelector(`[data-version="${version}"]`);
        if (versionEl) {
            compilerItem = versionEl.closest('.compiler-item');
        }
        
        if (!compilerItem) {
            const buttonEl = document.querySelector(`button[data-version="${version}"]`);
            if (buttonEl) {
                compilerItem = buttonEl.closest('.compiler-item');
            }
        }
        
        if (!compilerItem) {
            const allItems = document.querySelectorAll('.compiler-item');
            for (const item of allItems) {
                const infoDiv = item.querySelector('.compiler-info');
                if (infoDiv && infoDiv.textContent.includes(version)) {
                    compilerItem = item;
                    break;
                }
            }
        }
        
        if (!compilerItem) {
            logWarn(`未找到编译器项: ${version}`);
            return;
        }
        
        const actionsDiv = compilerItem.querySelector('.compiler-actions');
        if (!actionsDiv) {
            logWarn(`未找到编译器动作区域: ${version}`);
            return;
        }
        
        logInfo(`找到编译器项，当前类: ${compilerItem.className}`);
        
        actionsDiv.innerHTML = '';
        
        switch (newState) {
            case 'downloaded':
                logInfo(`设置编译器为已下载状态: ${version}`);
                compilerItem.classList.add('downloaded');
                compilerItem.classList.remove('selected');
                actionsDiv.innerHTML = `
                    <button class="select-btn" data-version="${version}">选择</button>
                    <span class="status downloaded-status">已下载</span>
                `;
                const selectBtn = actionsDiv.querySelector('.select-btn');
                if (selectBtn) {
                    logInfo(`重新绑定选择按钮事件: ${version}`);
                    selectBtn.addEventListener('click', (e) => {
                        e.preventDefault();
                        logInfo(`选择按钮被点击: ${version}`);
                        this.selectCompiler(version);
                    });
                }
                break;
                
            case 'selected':
                logInfo(`设置编译器为已选中状态: ${version}`);
                compilerItem.classList.add('downloaded', 'selected');
                actionsDiv.innerHTML = `
                    <span class="status selected-status">已选中</span>
                    <span class="status downloaded-status">已下载</span>
                `;
                break;
                
            case 'not-downloaded':
                logInfo(`设置编译器为未下载状态: ${version}`);
                compilerItem.classList.remove('downloaded', 'selected');
                break;
        }
        
        logInfo(`编译器项状态已更新: ${version} -> ${newState}，新类: ${compilerItem.className}`);
    }

    async browseTestlib() {
        try {
            if (window.electronAPI && window.electronAPI.showOpenDialog) {
                const result = await window.electronAPI.showOpenDialog({
                    title: '选择testlib.h文件',
                    properties: ['openFile'],
                    filters: [
                        { name: 'Testlib头文件', extensions: ['h'] },
                        { name: '所有文件', extensions: ['*'] }
                    ]
                });
                
                if (!result.canceled && result.filePaths.length > 0) {
                    const testlibPath = result.filePaths[0];
                    
                    const fileName = testlibPath.split(/[\\\/]/).pop().toLowerCase();
                    if (fileName !== 'testlib.h') {
                        this.showMessage('请选择testlib.h文件', 'error');
                        return;
                    }
                    
                    document.getElementById('testlib-path').value = testlibPath;
                    
                    if (window.electronAPI && window.electronAPI.saveSetting) {
                        await window.electronAPI.saveSetting('testlibPath', testlibPath);
                        this.showMessage('Testlib路径已保存', 'success');
                    }
                }
            }
        } catch (error) {
            logError('选择testlib.h文件失败:', error);
            this.showMessage('选择testlib.h文件失败: ' + error.message, 'error');
        }
    }
    
    async testTestlib() {
        const testlibPath = document.getElementById('testlib-path').value;
        const resultDiv = document.getElementById('testlib-test-result');
        
        if (!testlibPath) {
            resultDiv.innerHTML = '<div class="error">请先设置Testlib路径</div>';
            return;
        }
        
        resultDiv.innerHTML = '正在测试Testlib...';
        
        try {
            if (window.electronAPI && window.electronAPI.testTestlib) {
                const result = await window.electronAPI.testTestlib(testlibPath);
                
                if (result.success) {
                    resultDiv.innerHTML = '<div class="success">Testlib测试成功！</div>';
                } else {
                    resultDiv.innerHTML = `<div class="error">Testlib测试失败: ${result.error}</div>`;
                }
            } else {
                resultDiv.innerHTML = '<div class="error">测试API不可用</div>';
            }
        } catch (error) {
            logError('测试Testlib失败:', error);
            resultDiv.innerHTML = `<div class="error">测试失败: ${error.message}</div>`;
        }
    }
    
    showTestlibInstallDialog() {
        const dialog = document.getElementById('testlib-install-dialog');
        if (dialog) {
            dialog.style.display = 'flex';
            this.loadAvailableTestlibs();
        }
    }
    
    closeTestlibInstallDialog() {
        const dialog = document.getElementById('testlib-install-dialog');
        if (dialog) {
            dialog.style.display = 'none';
        }
    }
    
    async loadAvailableTestlibs() {
        const testlibList = document.getElementById('testlib-list');
        if (!testlibList) return;
        
        testlibList.innerHTML = '<div class="loading">正在获取Testlib列表...</div>';
        
        try {
            const response = await fetch('https://oicpp.mywwzh.top/api/getAvailableTestlibList');
            
            if (!response.ok) {
                throw new Error(`网络错误: ${response.status} ${response.statusText}`);
            }
            
            const testlibs = await response.json();
            
            testlibList.innerHTML = '';
            
            if (!testlibs || testlibs.length === 0) {
                testlibList.innerHTML = '<div class="no-compilers">暂无可用Testlib版本</div>';
                return;
            }
            
            const downloadedVersions = await this.getDownloadedTestlibVersions();
            
            for (const testlib of testlibs) {
                const isDownloaded = downloadedVersions.includes(testlib.version);
                const isSelected = await this.isTestlibSelected(testlib.version);
                
                const testlibDiv = document.createElement('div');
                testlibDiv.className = `compiler-item ${isDownloaded ? 'downloaded' : ''} ${isSelected ? 'selected' : ''}`;
                
                const downloadUrl = testlib.downloadUrl.startsWith('http') 
                    ? testlib.downloadUrl 
                    : `https://oicpp.mywwzh.top${testlib.downloadUrl}`;
                
                testlibDiv.innerHTML = `
                    <div class="compiler-info">
                        <h4>${testlib.name}</h4>
                        <p>版本: ${testlib.version}</p>
                        <p>${testlib.description}</p>
                        <span class="platform">大小: ${testlib.file_size_mb}MB</span>
                    </div>
                    <div class="compiler-actions">
                        ${isSelected ? 
                            '<span class="status selected-status">已选中</span>' :
                            isDownloaded ? 
                                `<button class="select-btn" data-version="${testlib.version}">选择</button>` :
                                `<button class="download-btn" data-url="${downloadUrl}" data-version="${testlib.version}" data-name="${testlib.name}">下载</button>`
                        }
                        ${isDownloaded ? '<span class="status downloaded-status">已下载</span>' : ''}
                    </div>
                `;
                
                this.addTestlibItemListeners(testlibDiv, testlib);
                testlibList.appendChild(testlibDiv);
            }
            
        } catch (error) {
            logError('获取Testlib列表失败:', error);
            testlibList.innerHTML = `
                <div class="error-message">
                    <p>网络错误：无法获取Testlib列表</p>
                    <p class="error-detail">${error.message}</p>
                    <button class="retry-btn" onclick="this.loadAvailableTestlibs()">重试</button>
                </div>
            `;
        }
    }
    
    addTestlibItemListeners(testlibDiv, testlib) {
        const downloadBtn = testlibDiv.querySelector('.download-btn');
        if (downloadBtn) {
            downloadBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.downloadTestlib(testlib);
            });
        }
        
        const selectBtn = testlibDiv.querySelector('.select-btn');
        if (selectBtn) {
            selectBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.selectTestlib(testlib.version);
            });
        }
    }
    
    async downloadTestlib(testlib) {
        const downloadBtn = document.querySelector(`button.download-btn[data-version="${testlib.version}"]`);
        if (!downloadBtn) return;
        
        try {
            downloadBtn.disabled = true;
            downloadBtn.textContent = '下载中...';
            
            this.showMessage(`开始下载 ${testlib.name} ${testlib.version}...`, 'info');
            
            if (window.electronAPI && window.electronAPI.downloadTestlib) {
                const fullUrl = testlib.downloadUrl.startsWith('http') 
                    ? testlib.downloadUrl 
                    : `https://oicpp.mywwzh.top${testlib.downloadUrl}`;
                
                const result = await window.electronAPI.downloadTestlib({
                    url: fullUrl,
                    version: testlib.version,
                    name: testlib.name
                });
                
                if (result.success) {
                    this.showMessage(`${testlib.name} ${testlib.version} 下载并安装成功！`, 'success');
                    
                    downloadBtn.textContent = '已下载';
                    downloadBtn.disabled = false;
                    downloadBtn.classList.remove('download-btn');
                    downloadBtn.classList.add('downloaded-btn');
                    
                    if (result.testlibPath) {
                        await this.setTestlibPath(result.testlibPath);
                        await this.selectTestlib(testlib.version);
                    }
                } else {
                    throw new Error(result.error || '下载失败');
                }
            } else {
                throw new Error('下载 API 不可用');
            }
        } catch (error) {
            logError('下载Testlib失败:', error);
            this.showMessage(`下载失败: ${error.message}`, 'error');
            
            if (downloadBtn) {
                downloadBtn.disabled = false;
                downloadBtn.textContent = '下载';
            }
        }
    }
    
    async selectTestlib(version) {
        try {
            if (window.electronAPI && window.electronAPI.selectTestlib) {
                const result = await window.electronAPI.selectTestlib(version);
                
                if (result.success) {
                    this.showMessage(`已选择Testlib ${version}`, 'success');
                    
                    if (result.testlibPath) {
                        await this.setTestlibPath(result.testlibPath);
                    }
                    
                    const testlibItems = document.querySelectorAll('.compiler-item');
                    testlibItems.forEach(item => {
                        const selectBtn = item.querySelector('.select-btn');
                        if (selectBtn) {
                            const itemVersion = selectBtn.getAttribute('data-version');
                            if (itemVersion === version) {
                                item.classList.add('selected');
                                const actionsDiv = item.querySelector('.compiler-actions');
                                actionsDiv.innerHTML = `
                                    <span class="status selected-status">已选中</span>
                                    <span class="status downloaded-status">已下载</span>
                                `;
                            } else {
                                item.classList.remove('selected');
                                if (item.classList.contains('downloaded')) {
                                    const actionsDiv = item.querySelector('.compiler-actions');
                                    actionsDiv.innerHTML = `
                                        <button class="select-btn" data-version="${itemVersion}">选择</button>
                                        <span class="status downloaded-status">已下载</span>
                                    `;
                                    const newSelectBtn = actionsDiv.querySelector('.select-btn');
                                    if (newSelectBtn) {
                                        newSelectBtn.addEventListener('click', (e) => {
                                            e.preventDefault();
                                            this.selectTestlib(itemVersion);
                                        });
                                    }
                                }
                            }
                        }
                    });
                } else {
                    throw new Error(result.error || '选择失败');
                }
            }
        } catch (error) {
            logError('选择Testlib失败:', error);
            this.showMessage(`选择失败: ${error.message}`, 'error');
        }
    }
    
    async setTestlibPath(path) {
        document.getElementById('testlib-path').value = path;
        
        if (window.electronAPI && window.electronAPI.saveSetting) {
            await window.electronAPI.saveSetting('testlibPath', path);
        }
    }
    
    async getDownloadedTestlibVersions() {
        try {
            if (window.electronAPI && window.electronAPI.getDownloadedTestlibs) {
                return await window.electronAPI.getDownloadedTestlibs();
            }
        } catch (error) {
            logError('获取已下载Testlib失败:', error);
        }
        return [];
    }
    
    async isTestlibSelected(version) {
        try {
            if (window.electronAPI && window.electronAPI.isTestlibSelected) {
                return await window.electronAPI.isTestlibSelected(version);
            }
        } catch (error) {
            logError('检查Testlib选择状态失败:', error);
        }
        return false;
    }

    closeWindow() {
        window.close();
    }
}

window.addEventListener('DOMContentLoaded', () => {
    new CompilerSettings();
});
