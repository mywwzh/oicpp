/**
 * Language Manager (i18n)
 *
 * Provides multi-language support for the OICPP IDE.
 * Usage:
 *   import lang from './lang';
 *   lang.setLanguage('en');
 *   lang.t('menu.file'); // => "File"
 *   lang.t('message.updateDownloading', { version: ' (v2.0)', progress: 50 }); // template substitution
 */

import * as fs from 'fs';
import * as path from 'path';

interface LanguageMeta {
    code: string;
    name: string;
    nameEn?: string;
}

interface LanguageEntry {
    code: string;
    name: string;
    nameEn: string;
}

class LanguageManager {
    private _currentLang: string = 'zh-cn';
    private _messages: Record<string, unknown> = {};
    private _fallbackMessages: Record<string, unknown> = {};
    private _loaded: boolean = false;

    constructor() {
        this._loadFallback();
    }

    /**
     * Load the fallback language (Chinese) so we always have defaults.
     */
    private _loadFallback(): void {
        try {
            const fallbackPath = path.join(__dirname, 'zh-cn.json');
            if (fs.existsSync(fallbackPath)) {
                this._fallbackMessages = JSON.parse(fs.readFileSync(fallbackPath, 'utf8')) as Record<string, unknown>;
            }
        } catch (e) {
            console.error('[LanguageManager] Failed to load fallback language:', e);
        }
    }

    /**
     * Load a language file.
     * @param langCode - Language code, e.g. 'zh-cn', 'en'
     * @returns Whether loading succeeded
     */
    loadLanguage(langCode: string): boolean {
        if (!langCode || typeof langCode !== 'string') {
            return false;
        }

        const normalizedCode = langCode.toLowerCase().replace(/_/g, '-');
        try {
            const langPath = path.join(__dirname, `${normalizedCode}.json`);
            if (!fs.existsSync(langPath)) {
                console.warn(`[LanguageManager] Language file not found: ${langPath}`);
                return false;
            }
            this._messages = JSON.parse(fs.readFileSync(langPath, 'utf8')) as Record<string, unknown>;
            this._currentLang = normalizedCode;
            this._loaded = true;
            return true;
        } catch (e) {
            console.error(`[LanguageManager] Failed to load language '${langCode}':`, e);
            return false;
        }
    }

    /**
     * Set the current language.
     * @param langCode
     * @returns
     */
    setLanguage(langCode: string): boolean {
        return this.loadLanguage(langCode);
    }

    /**
     * Get the current language code.
     * @returns
     */
    getCurrentLanguage(): string {
        return this._currentLang;
    }

    /**
     * Get the display name of the current language.
     * @returns
     */
    getCurrentLanguageName(): string {
        return (this._getNested(this._messages, 'meta.name') as string) ||
               (this._getNested(this._fallbackMessages, 'meta.name') as string) ||
               'Unknown';
    }

    /**
     * Get all available languages.
     * @returns
     */
    getAvailableLanguages(): LanguageEntry[] {
        const languages: LanguageEntry[] = [];
        try {
            const langDir = __dirname;
            const files = fs.readdirSync(langDir);
            for (const file of files) {
                if (!file.endsWith('.json') || file === 'index.ts' || file.startsWith('_')) {
                    continue;
                }
                try {
                    const content = JSON.parse(fs.readFileSync(path.join(langDir, file), 'utf8')) as { meta?: LanguageMeta };
                    if (content.meta && content.meta.code) {
                        languages.push({
                            code: content.meta.code,
                            name: content.meta.name || file.replace('.json', ''),
                            nameEn: content.meta.nameEn || content.meta.name || file.replace('.json', '')
                        });
                    }
                } catch (_) {
                    // skip invalid files
                }
            }
        } catch (e) {
            console.error('[LanguageManager] Failed to list available languages:', e);
        }
        return languages;
    }

    /**
     * Translate a key.
     * @param key - Dot-notation key, e.g. 'menu.file'
     * @param params - Optional template parameters for substitution, e.g. { msg: 'hello' }
     * @returns Translated string, or the key itself if not found
     */
    t(key: string, params?: Record<string, unknown>): string {
        if (!key || typeof key !== 'string') {
            return key || '';
        }

        // Try current language first, then fallback
        let value = this._getNested(this._messages, key);
        if (value === undefined || value === null) {
            value = this._getNested(this._fallbackMessages, key);
        }

        if (value === undefined || value === null) {
            return key;
        }

        // Ensure it's a string
        if (typeof value !== 'string') {
            return String(value);
        }

        // Substitute template parameters like {name}
        if (params && typeof params === 'object') {
            return value.replace(/\{(\w+)\}/g, (match: string, paramName: string) => {
                const paramValue = params[paramName];
                return paramValue !== undefined && paramValue !== null ? String(paramValue) : match;
            });
        }

        return value;
    }

    /**
     * Get a nested value from an object by dot-notation key.
     */
    private _getNested(obj: Record<string, unknown> | undefined | null, key: string): unknown {
        if (!obj || !key) return undefined;
        const keys = key.split('.');
        let current: unknown = obj;
        for (const k of keys) {
            if (current === null || current === undefined || typeof current !== 'object') {
                return undefined;
            }
            current = (current as Record<string, unknown>)[k];
        }
        return current;
    }

    /**
     * Reload the current language (useful after language file updates).
     */
    reload(): void {
        this._loadFallback();
        if (this._currentLang) {
            this.loadLanguage(this._currentLang);
        }
    }
}

// Singleton instance
const instance = new LanguageManager();

// Load default language (Chinese)
instance.loadLanguage('zh-cn');

export default instance;
export { LanguageManager };
