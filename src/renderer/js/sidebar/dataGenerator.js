class DataGenerator {
    constructor() {
        this.panel = null;
        this.generators = [];
        this.nextId = 1;
        this.init();
    }

    init() {
        this.panel = document.getElementById('datagen-panel');
        if (!this.panel) {
            if (typeof logError === 'function') logError('数据生成器面板元素未找到');
            return;
        }
        this.setupStructure();
        this.setupEventListeners();
        this.loadDefaultGenerators();
    }

    // 初始化静态 DOM，不带任何行内内联样式，字数精简防止溢出
    setupStructure() {
        const content = this.panel.querySelector('.datagen-content');
        if (!content) return;

        content.innerHTML = `
            <div class="datagen-toolbar">
                <button id="datagen-add-btn" class="btn">添加变量</button>
                <button id="datagen-generate-btn" class="btn btn-primary">生成代码</button>
                <button id="datagen-preview-btn" class="btn">预览数据</button>
                <button id="datagen-export-btn" class="btn btn-success">导出文件</button>
                <button id="datagen-clear-btn" class="btn btn-danger">清空</button>
            </div>
            <div class="datagen-items"></div>
            <div class="datagen-tabs">
                <button type="button" id="datagen-tab-btn-preview" class="datagen-tab-btn active">数据预览</button>
                <button type="button" id="datagen-tab-btn-code" class="datagen-tab-btn">C++ 代码</button>
            </div>
            <div class="datagen-result">
                <div id="datagen-preview-content" class="datagen-tab-content active"></div>
                <div id="datagen-code-content" class="datagen-tab-content"></div>
            </div>
        `;
    }

    setupEventListeners() {
        const content = this.panel.querySelector('.datagen-content');
        
        this.panel.querySelector('#datagen-add-btn')?.addEventListener('click', () => this.addGeneratorItem());
        this.panel.querySelector('#datagen-generate-btn')?.addEventListener('click', () => this.generateCode());
        this.panel.querySelector('#datagen-preview-btn')?.addEventListener('click', () => this.previewData());
        this.panel.querySelector('#datagen-export-btn')?.addEventListener('click', () => this.exportFile());
        this.panel.querySelector('#datagen-clear-btn')?.addEventListener('click', () => this.clearAll());

        // 页签切换逻辑
        const tabPreviewBtn = this.panel.querySelector('#datagen-tab-btn-preview');
        const tabCodeBtn = this.panel.querySelector('#datagen-tab-btn-code');
        const viewPreview = this.panel.querySelector('#datagen-preview-content');
        const viewCode = this.panel.querySelector('#datagen-code-content');

        tabPreviewBtn?.addEventListener('click', () => {
            tabPreviewBtn.classList.add('active');
            tabCodeBtn?.classList.remove('active');
            viewPreview?.classList.add('active');
            viewCode?.classList.remove('active');
        });

        tabCodeBtn?.addEventListener('click', () => {
            tabCodeBtn.classList.add('active');
            tabPreviewBtn?.classList.remove('active');
            viewCode?.classList.add('active');
            viewPreview?.classList.remove('active');
        });

        // 委托监听配置域变动
        const itemsDiv = this.panel.querySelector('.datagen-items');
        itemsDiv?.addEventListener('change', (e) => {
            const itemEl = e.target.closest('.datagen-item');
            if (!itemEl) return;
            const id = parseInt(itemEl.dataset.id);
            const field = e.target.dataset.field;
            if (field) {
                if (field === 'type') {
                    this.onTypeChange(id, e.target.value);
                } else {
                    this.updateGeneratorItem(id, field, e.target.value);
                }
            }
        });

        itemsDiv?.addEventListener('click', (e) => {
            const delBtn = e.target.closest('.datagen-delete-btn');
            if (delBtn) {
                const itemEl = delBtn.closest('.datagen-item');
                if (itemEl) this.removeGeneratorItem(parseInt(itemEl.dataset.id));
            }
        });
    }

    loadDefaultGenerators() {
        this.generators = [
            { id: this.nextId++, name: 'n', type: 'integer', min: '1', max: '100', arraySize: '10', cols: '5', description: '数据规模' }
        ];
        this.renderItems();
    }

    addGeneratorItem() {
        const item = {
            id: this.nextId++,
            name: `var_${this.nextId - 1}`,
            type: 'integer',
            min: '1',
            max: '100',
            arraySize: '10',
            cols: '5',
            description: ''
        };
        this.generators.push(item);
        this.renderItems();
    }

    removeGeneratorItem(id) {
        this.generators = this.generators.filter(g => g.id !== id);
        this.renderItems();
    }

    updateGeneratorItem(id, field, value) {
        const gen = this.generators.find(g => g.id === id);
        if (gen) gen[field] = value;
    }

    onTypeChange(id, newType) {
        const gen = this.generators.find(g => g.id === id);
        if (gen) {
            gen.type = newType;
            this.renderItems();
        }
    }

    renderItems() {
        const container = this.panel.querySelector('.datagen-items');
        if (!container) return;
        container.innerHTML = '';

        this.generators.forEach(gen => {
            const item = document.createElement('div');
            item.className = 'datagen-item';
            item.dataset.id = gen.id;

            item.innerHTML = `
                <div class="datagen-item-header">
                    <input type="text" data-field="name" class="datagen-name-input" placeholder="变量名" value="${gen.name}">
                    <select data-field="type" class="datagen-type-select">
                        <option value="integer" ${gen.type === 'integer' ? 'selected' : ''}>整数 (int)</option>
                        <option value="longlong" ${gen.type === 'longlong' ? 'selected' : ''}>长整数 (long long)</option>
                        <option value="array" ${gen.type === 'array' ? 'selected' : ''}>一维数组</option>
                        <option value="array2d" ${gen.type === 'array2d' ? 'selected' : ''}>二维数组</option>
                    </select>
                    <button class="datagen-delete-btn" title="删除">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M3 6h18M19 6v14c0 1.1-.9 2-2 2H7c-1.1 0-2-.9-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                    </button>
                </div>
                <div class="datagen-item-content">
                    <div class="datagen-row">
                        <label>最小值:</label>
                        <input type="text" data-field="min" value="${gen.min}" placeholder="数字或变量名">
                    </div>
                    <div class="datagen-row">
                        <label>最大值:</label>
                        <input type="text" data-field="max" value="${gen.max}" placeholder="数字或变量名">
                    </div>
                    ${gen.type === 'array' ? `
                    <div class="datagen-row">
                        <label>数组大小:</label>
                        <input type="text" data-field="arraySize" value="${gen.arraySize}" placeholder="数字或变量名">
                    </div>` : ''}
                    ${gen.type === 'array2d' ? `
                    <div class="datagen-row">
                        <label>行数:</label>
                        <input type="text" data-field="arraySize" value="${gen.arraySize}" placeholder="数字或变量名">
                    </div>
                    <div class="datagen-row">
                        <label>列数:</label>
                        <input type="text" data-field="cols" value="${gen.cols}" placeholder="数字或变量名">
                    </div>` : ''}
                    <div class="datagen-row">
                        <label>描述:</label>
                        <input type="text" data-field="description" value="${gen.description || ''}" placeholder="注释说明">
                    </div>
                </div>
            `;
            container.appendChild(item);
        });
    }

    // ────────────────────────────────────────────────────────
    // 💡 核心解析引擎：支持混合变量域计算 (数字 or 已有变量名)
    // ────────────────────────────────────────────────────────
    parseValue(valStr, scope) {
        const trimmed = valStr.trim();
        if (scope && scope.hasOwnProperty(trimmed)) {
            return scope[trimmed];
        }
        const num = parseInt(trimmed);
        return isNaN(num) ? 0 : num;
    }

    // ────────────────────────────────────────────────────────
    // 🎲 带有动态 Scope 作用域的模拟数据预览
    // ────────────────────────────────────────────────────────
    previewData() {
        let preview = '';
        const scope = {}; // 存放运行时生成的快照值，供后面的变量引用

        this.generators.forEach((gen) => {
            const min = this.parseValue(gen.min, scope);
            const max = this.parseValue(gen.max, scope);
            
            switch (gen.type) {
                case 'integer':
                case 'longlong': {
                    const val = Math.floor(Math.random() * (max - min + 1)) + min;
                    scope[gen.name] = val; // 注册入作用域
                    preview += `${val}\n`;
                    break;
                }
                case 'array': {
                    const size = this.parseValue(gen.arraySize, scope);
                    let arr = [];
                    for (let i = 0; i < size; i++) {
                        arr.push(Math.floor(Math.random() * (max - min + 1)) + min);
                    }
                    preview += `${arr.join(' ')}\n`;
                    break;
                }
                case 'array2d': {
                    const rows = this.parseValue(gen.arraySize, scope); // 复用字段作为行数
                    const cols = this.parseValue(gen.cols, scope);
                    for (let i = 0; i < rows; i++) {
                        let row = [];
                        for (let j = 0; j < cols; j++) {
                            row.push(Math.floor(Math.random() * (max - min + 1)) + min);
                        }
                        preview += `${row.join(' ')}\n`;
                    }
                    break;
                }
            }
        });

        const previewDiv = this.panel.querySelector('#datagen-preview-content');
        if (previewDiv) previewDiv.textContent = preview;
        this.panel.querySelector('#datagen-tab-btn-preview')?.click();
    }

    // ────────────────────────────────────────────────────────
    // 💻 现代化 C++ 智能关联代码生成
    // ────────────────────────────────────────────────────────
    generateCode() {
        let code = `#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    // 建立随机数快照引擎\n    mt19937 rng(chrono::steady_clock::now().time_since_epoch().count());\n\n`;
        const definedVars = new Set();

        this.generators.forEach((gen) => {
            // 判断输入的是数字还是已有变量
            const isMinVar = definedVars.has(gen.min.trim());
            const isMaxVar = definedVars.has(gen.max.trim());
            const isSizeVar = definedVars.has(gen.arraySize.trim());
            const isColsVar = definedVars.has(gen.cols.trim());

            const minExpr = isMinVar ? gen.min.trim() : gen.min;
            const maxExpr = isMaxVar ? gen.max.trim() : gen.max;
            const typeStr = gen.type === 'longlong' ? 'long long' : 'int';
            const desc = gen.description ? ` // ${gen.description}` : '';

            if (gen.type === 'integer' || gen.type === 'longlong') {
                code += `    ${typeStr} ${gen.name} = uniform_int_distribution<${typeStr}>(${minExpr}, ${maxExpr})(rng);${desc}\n`;
                code += `    cout << ${gen.name} << "\\n";\n\n`;
                definedVars.add(gen.name);
            } 
            else if (gen.type === 'array') {
                const sizeExpr = isSizeVar ? gen.arraySize.trim() : gen.arraySize;
                code += `    int size_${gen.name} = ${sizeExpr};${desc}\n`;
                code += `    vector<int> ${gen.name}(size_${gen.name});\n`;
                code += `    for(int i = 0; i < size_${gen.name}; i++) {\n`;
                code += `        ${gen.name}[i] = uniform_int_distribution<int>(${minExpr}, ${maxExpr})(rng);\n`;
                code += `        cout << ${gen.name}[i] << (i == size_${gen.name} - 1 ? "" : " ");\n`;
                code += `    }\n`;
                code += `    cout << "\\n";\n\n`;
                definedVars.add(gen.name);
            } 
            else if (gen.type === 'array2d') {
                const rowsExpr = isSizeVar ? gen.arraySize.trim() : gen.arraySize;
                const colsExpr = isColsVar ? gen.cols.trim() : gen.cols;
                code += `    int r_${gen.name} = ${rowsExpr}, c_${gen.name} = ${colsExpr};${desc}\n`;
                code += `    for(int i = 0; i < r_${gen.name}; i++) {\n`;
                code += `        for(int j = 0; j < c_${gen.name}; j++) {\n`;
                code += `            int val = uniform_int_distribution<int>(${minExpr}, ${maxExpr})(rng);\n`;
                code += `            cout << val << (j == c_${gen.name} - 1 ? "" : " ");\n`;
                code += `        }\n`;
                code += `        cout << "\\n";\n`;
                code += `    }\n\n`;
                definedVars.add(gen.name);
            }
        });

        code += `    return 0;\n}\n`;

        const codeDiv = this.panel.querySelector('#datagen-code-content');
        if (codeDiv) codeDiv.textContent = code;
        this.panel.querySelector('#datagen-tab-btn-code')?.click();
    }

    clearAll() {
        this.generators = [];
        this.nextId = 1;
        this.loadDefaultGenerators();
        const codeDiv = this.panel.querySelector('#datagen-code-content');
        const previewDiv = this.panel.querySelector('#datagen-preview-content');
        if (codeDiv) codeDiv.textContent = '';
        if (previewDiv) previewDiv.textContent = '';
    }

    async exportFile() {
        const code = this.generateCodeToString();
        
        try {
            if (window.electronAPI && window.electronAPI.showSaveDialog) {
                const result = await window.electronAPI.showSaveDialog({
                    title: '导出生成器文件',
                    defaultPath: 'generator.cpp',
                    filters: [
                        { name: 'C++ Source Files', extensions: ['cpp'] },
                        { name: 'All Files', extensions: ['*'] }
                    ]
                });
                
                if (result && result.filePath) {
                    await window.electronAPI.writeFile(result.filePath, code);
                    if (typeof logInfo === 'function') logInfo('数据生成器文件已导出:', result.filePath);
                    if (window.oicppApp?.showMessage) {
                        window.oicppApp.showMessage('生成器文件导出成功!', 'success');
                    }
                }
            } else {
                this.downloadFileInBrowser(code, 'generator.cpp');
            }
        } catch (error) {
            if (typeof logError === 'function') logError('导出文件失败:', error);
            if (window.oicppApp?.showMessage) {
                window.oicppApp.showMessage('导出文件失败: ' + error.message, 'error');
            }
        }
    }

    generateCodeToString() {
        let code = `#include <bits/stdc++.h>
using namespace std;

int main() {
    // 建立随机数快照引擎
    mt19937 rng(chrono::steady_clock::now().time_since_epoch().count());

`;
        const definedVars = new Set();

        this.generators.forEach((gen) => {
            const isMinVar = definedVars.has(gen.min.trim());
            const isMaxVar = definedVars.has(gen.max.trim());
            const isSizeVar = definedVars.has(gen.arraySize.trim());
            const isColsVar = definedVars.has(gen.cols.trim());

            const minExpr = isMinVar ? gen.min.trim() : gen.min;
            const maxExpr = isMaxVar ? gen.max.trim() : gen.max;
            const typeStr = gen.type === 'longlong' ? 'long long' : 'int';
            const desc = gen.description ? ` // ${gen.description}` : '';

            if (gen.type === 'integer' || gen.type === 'longlong') {
                code += `    ${typeStr} ${gen.name} = uniform_int_distribution<${typeStr}>(${minExpr}, ${maxExpr})(rng);${desc}\n`;
                code += `    cout << ${gen.name} << "\\n";\n\n`;
                definedVars.add(gen.name);
            } 
            else if (gen.type === 'array') {
                const sizeExpr = isSizeVar ? gen.arraySize.trim() : gen.arraySize;
                code += `    int size_${gen.name} = ${sizeExpr};${desc}\n`;
                code += `    vector<int> ${gen.name}(size_${gen.name});\n`;
                code += `    for(int i = 0; i < size_${gen.name}; i++) {\n`;
                code += `        ${gen.name}[i] = uniform_int_distribution<int>(${minExpr}, ${maxExpr})(rng);\n`;
                code += `        cout << ${gen.name}[i] << (i == size_${gen.name} - 1 ? "" : " ");\n`;
                code += `    }\n`;
                code += `    cout << "\\n";\n\n`;
                definedVars.add(gen.name);
            } 
            else if (gen.type === 'array2d') {
                const rowsExpr = isSizeVar ? gen.arraySize.trim() : gen.arraySize;
                const colsExpr = isColsVar ? gen.cols.trim() : gen.cols;
                code += `    int r_${gen.name} = ${rowsExpr}, c_${gen.name} = ${colsExpr};${desc}\n`;
                code += `    for(int i = 0; i < r_${gen.name}; i++) {\n`;
                code += `        for(int j = 0; j < c_${gen.name}; j++) {\n`;
                code += `            int val = uniform_int_distribution<int>(${minExpr}, ${maxExpr})(rng);\n`;
                code += `            cout << val << (j == c_${gen.name} - 1 ? "" : " ");\n`;
                code += `        }\n`;
                code += `        cout << "\\n";\n`;
                code += `    }\n\n`;
                definedVars.add(gen.name);
            }
        });

        code += `    return 0;\n}\n`;
        return code;
    }

    downloadFileInBrowser(content, filename) {
        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    activate() {
        if (typeof logInfo === 'function') logInfo('数据生成器面板已激活');
    }
}

if (typeof window !== 'undefined') {
    window.DataGenerator = DataGenerator;
}