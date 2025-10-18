class FontDetector {
    constructor() {
        this.testString = 'mmmmmmmmmmlli';
        this.testSize = '72px';
        this.fallbackFont = 'monospace';
        const platform = (typeof process!=='undefined' && process.platform)||'';
        if(platform==='win32') {
            this.defaultFont = 'Consolas';
        } else {
            this.defaultFont = 'monospace, monospace';
        }
        this._warnedFonts = new Set();
    }

    isFontAvailable(fontName) {
    if(!fontName) return false;
    const genericFamilies = ['monospace','serif','sans-serif'];
    if (genericFamilies.includes(fontName.toLowerCase())) return true;
        const testElement = document.createElement('span');
        testElement.style.position = 'absolute';
        testElement.style.left = '-9999px';
        testElement.style.top = '-9999px';
        testElement.style.fontSize = this.testSize;
        testElement.style.fontFamily = this.fallbackFont;
        testElement.textContent = this.testString;
        
        document.body.appendChild(testElement);
        
        const fallbackWidth = testElement.offsetWidth;
        const fallbackHeight = testElement.offsetHeight;
        
        testElement.style.fontFamily = `"${fontName}", ${this.fallbackFont}`;
        
        const testWidth = testElement.offsetWidth;
        const testHeight = testElement.offsetHeight;
        
        document.body.removeChild(testElement);
        
        return testWidth !== fallbackWidth || testHeight !== fallbackHeight;
    }

    validateFont(fontName) {
        if (!fontName || fontName.trim() === '') {
            return this.defaultFont;
        }

        let cleanFontName = fontName.replace(/["']/g, '').trim();
        const aliasMap = {
            'mono': 'monospace',
            'monospaced': 'monospace',
            'code': 'monospace'
        };
        const lower = cleanFontName.toLowerCase();
        if(aliasMap[lower]) cleanFontName = aliasMap[lower];
        
        const firstFont = cleanFontName.split(',')[0].trim();
        if (['monospace','serif','sans-serif'].includes(firstFont.toLowerCase())) {
            return firstFont;
        }
        
        if (this.isFontAvailable(firstFont)) {
            return firstFont;
        } else {
            if(!this._warnedFonts.has(firstFont)) {
                this._warnedFonts.add(firstFont);
                logWarn(`字体 "${firstFont}" 在系统中不可用，已切换到默认字体 "${this.defaultFont}"`);
                const platform = (typeof process!=='undefined' && process.platform)||'';
                if(platform!=='win32') this.showFontNotAvailableMessage(firstFont);
            }
            return this.defaultFont;
        }
    }

    showFontNotAvailableMessage(fontName) {
        const message = document.createElement('div');
        message.className = 'font-warning-message';
        message.innerHTML = `
            <div class="font-warning-content">
                <div class="font-warning-icon">⚠️</div>
                <div class="font-warning-text">
                    <strong>字体不可用</strong><br>
                    系统中未找到字体 "${fontName}"，已自动切换到 "${this.defaultFont}"
                </div>
                <button class="font-warning-close" onclick="this.parentElement.parentElement.remove()">×</button>
            </div>
        `;
        
        message.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: #fff3cd;
            border: 1px solid #ffeaa7;
            border-left: 4px solid #ffc107;
            border-radius: 6px;
            padding: 0;
            z-index: 10000;
            max-width: 350px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
            animation: slideInRight 0.3s ease-out;
        `;
        
        const content = message.querySelector('.font-warning-content');
        content.style.cssText = `
            display: flex;
            align-items: flex-start;
            padding: 12px 16px;
            gap: 12px;
        `;
        
        const icon = message.querySelector('.font-warning-icon');
        icon.style.cssText = `
            font-size: 20px;
            flex-shrink: 0;
            margin-top: 2px;
        `;
        
        const text = message.querySelector('.font-warning-text');
        text.style.cssText = `
            flex: 1;
            color: #856404;
            font-size: 13px;
            line-height: 1.4;
        `;
        
        const closeBtn = message.querySelector('.font-warning-close');
        closeBtn.style.cssText = `
            background: none;
            border: none;
            color: #856404;
            font-size: 18px;
            cursor: pointer;
            padding: 0;
            width: 20px;
            height: 20px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 3px;
            transition: background-color 0.2s;
        `;
        
        closeBtn.addEventListener('mouseenter', () => {
            closeBtn.style.backgroundColor = 'rgba(133, 100, 4, 0.1)';
        });
        
        closeBtn.addEventListener('mouseleave', () => {
            closeBtn.style.backgroundColor = 'transparent';
        });
        
        const style = document.createElement('style');
        style.textContent = `
            @keyframes slideInRight {
                from {
                    opacity: 0;
                    transform: translateX(100%);
                }
                to {
                    opacity: 1;
                    transform: translateX(0);
                }
            }
        `;
        document.head.appendChild(style);
        
        document.body.appendChild(message);
        
        setTimeout(() => {
            if (message.parentElement) {
                message.style.animation = 'slideInRight 0.3s ease-out reverse';
                setTimeout(() => {
                    if (message.parentElement) {
                        message.remove();
                    }
                }, 300);
            }
        }, 5000);
    }

    getAvailableMonospaceFonts() {
        const commonMonospaceFonts = [
            'Consolas',
            'Monaco',
            'Menlo',
            'Ubuntu Mono',
            'Courier New',
            'Lucida Console',
            'DejaVu Sans Mono',
            'Liberation Mono',
            'Courier',
            'monospace'
        ];
        
        return commonMonospaceFonts.filter(font => {
            if (font === 'monospace') return true; // 通用字体总是可用
            return this.isFontAvailable(font);
        });
    }

    async getSystemFontsFromAPI() {
        try {
            if ('queryLocalFonts' in window) {
                const fonts = await window.queryLocalFonts();
                const fontNames = [...new Set(fonts.map(font => font.family))].sort();
                logInfo('通过API获取到的系统字体:', fontNames.length, '个');
                return fontNames;
            }
        } catch (error) {
            logWarn('无法使用字体查询API:', error);
        }
        return [];
    }

    async getAllAvailableFonts() {
        const systemFonts = await this.getSystemFontsFromAPI();
        
        const commonFonts = [
            'Consolas',
            'Monaco',
            'Menlo',
            'Fira Code',
            'Source Code Pro',
            'JetBrains Mono',
            'Cascadia Code',
            'Ubuntu Mono',
            'Roboto Mono',
            'Inconsolata',
            'Droid Sans Mono',
            'PT Mono',
            'Anonymous Pro',
            'Courier New',
            'Lucida Console',
            'DejaVu Sans Mono',
            'Liberation Mono',
            'Noto Sans Mono',
            'SF Mono',
            'Operator Mono',
            'Hack',
            'IBM Plex Mono',
            'Space Mono',
            'Victor Mono',
            'Courier',
            'Arial',
            'Helvetica',
            'Times New Roman',
            'Georgia',
            'Verdana',
            'Tahoma',
            'Trebuchet MS',
            'Impact',
            'Comic Sans MS',
            'Palatino',
            'Garamond',
            'Bookman',
            'Avant Garde',
            'Microsoft YaHei',
            'SimSun',
            'SimHei',
            'KaiTi',
            'FangSong',
            'NSimSun',
            'PingFang SC',
            'Hiragino Sans GB',
            'Source Han Sans CN',
            'Noto Sans CJK SC',
            'monospace',
            'serif',
            'sans-serif'
        ];
        
        const allFonts = [...new Set([...systemFonts, ...commonFonts])];
        
        const availableFonts = allFonts.filter(font => {
            if (['monospace', 'serif', 'sans-serif'].includes(font)) {
                return true;
            }
            return this.isFontAvailable(font);
        });
        
        const consolas = 'Consolas';
        const filteredFonts = availableFonts.filter(font => font !== consolas);
        if (availableFonts.includes(consolas)) {
            return [consolas, ...filteredFonts];
        }
        
        return availableFonts;
    }

    getAllAvailableFontsSync() {
        const commonFonts = [
            'Consolas',
            'Monaco',
            'Menlo',
            'Fira Code',
            'Source Code Pro',
            'JetBrains Mono',
            'Cascadia Code',
            'Ubuntu Mono',
            'Roboto Mono',
            'Inconsolata',
            'Droid Sans Mono',
            'PT Mono',
            'Anonymous Pro',
            'Courier New',
            'Lucida Console',
            'DejaVu Sans Mono',
            'Liberation Mono',
            'Noto Sans Mono',
            'SF Mono',
            'Operator Mono',
            'Hack',
            'IBM Plex Mono',
            'Space Mono',
            'Victor Mono',
            'Courier',
            'Arial',
            'Helvetica',
            'Times New Roman',
            'Georgia',
            'Verdana',
            'Tahoma',
            'Trebuchet MS',
            'Impact',
            'Comic Sans MS',
            'Palatino',
            'Garamond',
            'Bookman',
            'Avant Garde',
            'Microsoft YaHei',
            'SimSun',
            'SimHei',
            'KaiTi',
            'FangSong',
            'NSimSun',
            'PingFang SC',
            'Hiragino Sans GB',
            'Source Han Sans CN',
            'Noto Sans CJK SC',
            'monospace',
            'serif',
            'sans-serif'
        ];
        
        const availableFonts = commonFonts.filter(font => {
            if (['monospace', 'serif', 'sans-serif'].includes(font)) {
                return true;
            }
            return this.isFontAvailable(font);
        });
        
        const consolas = 'Consolas';
        const filteredFonts = availableFonts.filter(font => font !== consolas);
        if (availableFonts.includes(consolas)) {
            return [consolas, ...filteredFonts];
        }
        
        return availableFonts;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = FontDetector;
}

if (typeof window !== 'undefined') {
    window.FontDetector = FontDetector;
    window.fontDetector = new FontDetector();
}