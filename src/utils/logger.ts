// @ts-nocheck
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

class Logger {
    private initialized: boolean = false;
    private logDir: string = path.join(os.homedir(), '.oicpp', 'logs');
    private logFile: string | null = null;

    static timestampFilename(date: Date = new Date()): string {
        const pad = (n: number): string => String(n).padStart(2, '0');
        const toCN = (d: Date): Date => {
            const offsetMin = d.getTimezoneOffset();
            const delta = (8 * 60 + offsetMin) * 60000; // 本地时间转为北京时间
            return new Date(d.getTime() + delta);
        };
        const d8 = toCN(date);
        const YYYY = d8.getFullYear();
        const MM = pad(d8.getMonth() + 1);
        const DD = pad(d8.getDate());
        const hh = pad(d8.getHours());
        const mm = pad(d8.getMinutes());
        const ss = pad(d8.getSeconds());
        return `${YYYY}-${MM}-${DD}_${hh}-${mm}-${ss}.log`;
    }

    init(): string | null {
        if (this.initialized) return this.logFile;
        try {
            if (!fs.existsSync(this.logDir)) {
                fs.mkdirSync(this.logDir, { recursive: true });
            }
            const fileName = Logger.timestampFilename();
            this.logFile = path.join(this.logDir, fileName);
            fs.writeFileSync(this.logFile, '', { flag: 'a' });

            this.rotate(5);

            this.initialized = true;
            return this.logFile;
        } catch (e) {
            return null;
        }
    }

    rotate(keepCount: number = 5): void {
        try {
            if (!fs.existsSync(this.logDir)) return;
            const files = fs
                .readdirSync(this.logDir)
                .filter((f: string) => f.endsWith('.log'))
                .map((f: string) => ({
                    name: f,
                    full: path.join(this.logDir, f),
                    mtime: fs.statSync(path.join(this.logDir, f)).mtimeMs,
                }))
                .sort((a: { mtime: number }, b: { mtime: number }) => b.mtime - a.mtime);

            const toDelete = files.slice(keepCount);
            for (const f of toDelete) {
                try { fs.unlinkSync(f.full); } catch (_) { }
            }
        } catch (e) {
        }
    }

    static serializeError(err: unknown): Record<string, unknown> {
        try {
            const base: Record<string, unknown> = {
                name: (err as Error)?.name || 'Error',
                message: Logger.redactString((err as Error)?.message || String(err)),
                stack: (err as Error)?.stack ? Logger.redactString((err as Error).stack) : undefined,
            };
            ['code', 'errno', 'syscall', 'path', 'address', 'port'].forEach((k: string) => {
                if (err && (err as Record<string, unknown>)[k] !== undefined) {
                    base[k] = typeof (err as Record<string, unknown>)[k] === 'string' ? Logger.redactString((err as Record<string, unknown>)[k] as string) : (err as Record<string, unknown>)[k];
                }
            });
            if (err && (err as Record<string, unknown>).cause) {
                base.cause = typeof (err as Record<string, unknown>).cause === 'object'
                    ? Logger.serializeError((err as Record<string, unknown>).cause)
                    : Logger.redactString(String((err as Record<string, unknown>).cause));
            }
            if (err && (err as Record<string, unknown>).data) {
                try {
                    base.data = JSON.parse(JSON.stringify((err as Record<string, unknown>).data, (key: string, value: unknown) => {
                        if (key && /token|password|passwd|secret|authorization|cookie|credential|apikey|api_key/i.test(key)) {
                            return '[REDACTED]';
                        }
                        return typeof value === 'string' ? Logger.redactString(value) : value;
                    }));
                } catch (_) {
                    base.data = Logger.redactString(String((err as Record<string, unknown>).data));
                }
            }
            return base;
        } catch (_) {
            return { message: String(err) };
        }
    }

    static redactString(text: unknown): string {
        const REDACT_KEY_RE = /(["']?)(token|password|passwd|secret|authorization|cookie|credential|apikey|api_key|login_?token)\1(\s*(?::|=|\bis\b)\s*)(?:"[^"]*"|'[^']*'|Bearer\s+[^\s,}\]]+|[^,}\r\n]+)/gi;
        return String(text ?? '')
            .replace(REDACT_KEY_RE, (_match: string, quote: string, key: string, separator: string) => `${quote}${key}${quote}${separator}[REDACTED]`)
            .replace(/(Bearer\s+)[A-Za-z0-9._\-]+/gi, '$1[REDACTED]');
    }

    static stringifyArgs(args: unknown[], { level = 'info', maxLen = 2000 }: { level?: string; maxLen?: number } = {}): string {
        const REDACT_KEY_RE = /token|password|passwd|secret|authorization|cookie|credential|apikey|api_key/i;
        const redactingReplacer = (key: string, value: unknown) => {
            if (key && REDACT_KEY_RE.test(key)) return '[REDACTED]';
            if (value instanceof Error) return Logger.serializeError(value);
            return typeof value === 'string' ? Logger.redactString(value) : value;
        };
        const serializeError = Logger.serializeError;
        const INFO_PER_ARG_LIMIT = 1200;
        const clamp = (s: unknown, lim: number = INFO_PER_ARG_LIMIT): unknown => {
            if (typeof s !== 'string') return s;
            if (s.length <= lim) return s;
            return `${s.slice(0, lim)} ... [truncated ${s.length - lim} chars]`;
        };
        const infoStringify = (v: unknown): string => {
            if (v === null || v === undefined) return String(v);
            if (v instanceof Error) return JSON.stringify(serializeError(v), null, 2);
            if (typeof v === 'string') return clamp(Logger.redactString(v), INFO_PER_ARG_LIMIT);
            try {
                const full = JSON.stringify(v, redactingReplacer, 2);
                if (full && full.length <= INFO_PER_ARG_LIMIT) return full;

                if (Array.isArray(v)) {
                    const sample = v.slice(0, 10);
                    const sampleStr = JSON.stringify(sample, redactingReplacer, 2);
                    const suffix = v.length > 10 ? ` ... [+${v.length - 10} more]` : '';
                    return `[Array(${v.length}) sample]: ${clamp(sampleStr, INFO_PER_ARG_LIMIT)}${suffix}`;
                }

                if (typeof v === 'object') {
                    const keys = Object.keys(v);
                    const pick = keys.slice(0, 12);
                    const sampleObj: Record<string, unknown> = {};
                    for (const k of pick) sampleObj[k] = v[k];
                    const sampleStr = JSON.stringify(sampleObj, redactingReplacer, 2);
                    const more = keys.length > pick.length ? `, ... ${keys.length - pick.length} more keys` : '';
                    return `{Object with ${keys.length} keys, sample}: ${clamp(sampleStr, INFO_PER_ARG_LIMIT)}${more}`;
                }

                return clamp(Logger.redactString(String(v)), INFO_PER_ARG_LIMIT);
            } catch (_) {
                try { return JSON.stringify(v, redactingReplacer); } catch (e2) { return String(v); }
            }
        };
        const verbose = (v: unknown): string => {
            if (v === null || v === undefined) return String(v);
            if (v instanceof Error) return JSON.stringify(serializeError(v), null, 2);
            if (typeof v === 'string') return Logger.redactString(v);
            if (typeof v === 'object' && v && (v as Record<string, unknown>).error instanceof Error && Object.keys(v as Record<string, unknown>).length === 1) {
                return Logger.redactString(JSON.stringify({ error: serializeError((v as Record<string, unknown>).error) }, null, 2));
            }
            try { return JSON.stringify(v, redactingReplacer, 2); } catch (_) { return String(v); }
        };
        try {
            const joined = args.map(level === 'info' ? infoStringify : verbose).join(' ');
            if (level === 'info' && typeof joined === 'string' && joined.length > maxLen) {
                return `${joined.slice(0, maxLen)} ... [truncated ${joined.length - maxLen} chars]`;
            }
            return joined;
        } catch (_) {
            return String(args);
        }
    }

    write(level: string, ...args: unknown[]): void {
        const pad = (n: number, w: number = 2): string => String(n).padStart(w, '0');
        const now = new Date();
        const offsetMin = now.getTimezoneOffset();
        const delta = (8 * 60 + offsetMin) * 60000;
        const d8 = new Date(now.getTime() + delta);
        const ts = `${d8.getFullYear()}-${pad(d8.getMonth() + 1)}-${pad(d8.getDate())} ${pad(d8.getHours())}:${pad(d8.getMinutes())}:${pad(d8.getSeconds())}.${pad(d8.getMilliseconds(), 3)}+08:00`;
        const line = `[${ts}] [${level.toUpperCase()}] ${Logger.stringifyArgs(args, { level })}\n`;

        try {
            if (!this.initialized) this.init();
            if (this.logFile) fs.appendFileSync(this.logFile, line, 'utf8');
        } catch (e) {
        }
    }

    logInfo(...args: unknown[]): void { this.write('info', ...args); }
    logwarn(...args: unknown[]): void { this.write('warn', ...args); }
    logerror(...args: unknown[]): void { this.write('error', ...args); }
    logWarn(...args: unknown[]): void { this.write('warn', ...args); }
    logError(...args: unknown[]): void { this.write('error', ...args); }

    getLogFile(): string | null { if (!this.initialized) this.init(); return this.logFile; }
}

export default new Logger();
