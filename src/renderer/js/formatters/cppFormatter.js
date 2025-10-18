(function () {
    function formatCpp(code, { tabSize = 4, insertSpaces = false } = {}) {
        if (!code || typeof code !== 'string') return code || '';

        const EOL = '\n';
        const src = code.replace(/\r\n?|\u2028|\u2029/g, '\n');

        const rawLines = src.split('\n');

        let inBlockComment = false;
        let indentLevel = 0;
        let blankCount = 0;

        const mkIndent = (level) => insertSpaces ? ' '.repeat(level * tabSize) : '\t'.repeat(level);

        const out = [];

        function processLine(line, nextLine) {
            const trimmedLeft = line.replace(/^[\t ]+/, '');
            if (trimmedLeft.startsWith('#')) {
                const keep = line.replace(/[ \t]+$/g, '');
                return { segments: [keep], open: 0, close: 0, noIndent: true };
            }

            let open = 0, close = 0;
            let i = 0, s = line;
            let out = '';
            let segments = [];

            let inStrS = false, inStrD = false, inStrRaw = false;
            let templateDepth = 0;
            let inlineBraceDepth = 0;
            let parenDepth = 0; // 括号深度，用于判定是否允许在分号处换行

            const isSpace = (ch) => ch === ' ' || ch === '\t';

            let pendingSpace = false; // 记录遇到的空白，按需输出
            const emitPendingSpaceIfNeeded = (nextCharCategory) => {
                if (!pendingSpace) return;
                const prev = out.replace(/\s+$/g, '').slice(-1);
                const noSpaceBefore = new Set([')', ']', '}', ',', ';', ':']);
                const noSpaceAfterPrev = new Set(['(', '[', '{']);
                if (prev && !noSpaceAfterPrev.has(prev) && nextCharCategory !== 'rb') {
                    if (!/\s$/.test(out)) out += ' ';
                }
                pendingSpace = false;
            };

            while (i < s.length) {
                const ch = s[i];
                const next = i + 1 < s.length ? s[i + 1] : '';
                const three = i + 2 < s.length ? s.substring(i, i + 3) : '';

                if (inBlockComment) {
                    if (pendingSpace) { out += ' '; pendingSpace = false; }
                    out += ch;
                    if (ch === '*' && next === '/') { out += '/'; i += 2; inBlockComment = false; continue; }
                    i++; continue;
                }
                if (!inStrS && !inStrD && !inStrRaw) {
                    if (ch === '/' && next === '*') { if (pendingSpace) { out += ' '; pendingSpace = false; } out += '/*'; inBlockComment = true; i += 2; continue; }
                    if (ch === '/' && next === '/') { if (pendingSpace) { out += ' '; pendingSpace = false; } out += s.substring(i); i = s.length; break; }
                }

                if (inStrS) {
                    if (pendingSpace) { out += ' '; pendingSpace = false; }
                    out += ch;
                    if (ch === '\\' && i + 1 < s.length) { out += s[i + 1]; i += 2; continue; }
                    if (ch === '\'') inStrS = false;
                    i++; continue;
                }
                if (inStrD) {
                    if (pendingSpace) { out += ' '; pendingSpace = false; }
                    out += ch;
                    if (ch === '\\' && i + 1 < s.length) { out += s[i + 1]; i += 2; continue; }
                    if (ch === '"') inStrD = false;
                    i++; continue;
                }
                if (inStrRaw) {
                    if (pendingSpace) { out += ' '; pendingSpace = false; }
                    out += ch;
                    if (ch === '"') inStrRaw = false;
                    i++; continue;
                }

                if (ch === '\'') { if (pendingSpace) { out += ' '; pendingSpace = false; } inStrS = true; out += ch; i++; continue; }
                if (ch === '"') {
                    const prev = s[i - 1] || '';
                    const look = s.substring(i, i + 2);
                    if (prev === 'R' && look === '"(') { if (pendingSpace) { out += ' '; pendingSpace = false; } inStrRaw = true; out += ch; i++; continue; }
                    if (pendingSpace) { out += ' '; pendingSpace = false; } inStrD = true; out += ch; i++; continue;
                }

                if (ch === '{') open++;
                if (ch === '}') close++;

                if (isSpace(ch)) { pendingSpace = true; i++; continue; }

                const two = ch + next;
                const spacedThree = ['>>=', '<<='];
                if (spacedThree.includes(three)) {
                    emitPendingSpaceIfNeeded('op');
                    out = out.replace(/[ ]+$/g, '');
                    if (out && out[out.length - 1] !== ' ') out += ' ';
                    out += three + ' ';
                    i += 3; continue;
                }
                if (two === '++' || two === '--') {
                    emitPendingSpaceIfNeeded('op');
                    const prevNonSpace = out.replace(/\s+$/g, '').slice(-1);
                    const shouldStripSpace = /[A-Za-z0-9_\)\]\}]/.test(prevNonSpace || ''); // i++、x)++ 等去掉前空格
                    if (shouldStripSpace) {
                        out = out.replace(/[ ]+$/g, '');
                    }
                    out += two;
                    i += 2; continue;
                }
                if (two === '->' || two === '::') {
                    out = out.replace(/[ ]+$/g, '');
                    out += two;
                    i += 2; continue;
                }
                if (two === '>>' && templateDepth > 0) {
                    out = out.replace(/[ ]+$/g, '');
                    out += '>>';
                    templateDepth = Math.max(0, templateDepth - 2);
                    i += 2; continue;
                }
                const spacedTwo = ['==', '!=', '<=', '>=', '&&', '||', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<', '>>'];
                if (spacedTwo.includes(two)) {
                    emitPendingSpaceIfNeeded('op');
                    out = out.replace(/[ ]+$/g, '');
                    if (out && out[out.length - 1] !== ' ') out += ' ';
                    out += two + ' ';
                    i += 2; continue;
                }

                if (ch === ',') {
                    pendingSpace = false;
                    out = out.replace(/[ ]+$/g, '');
                    out += ',';
                    const after = s.substring(i + 1).trimStart();
                    if (after && !after.startsWith(')') && !after.startsWith(';')) out += ' ';
                    i++; continue;
                }

                if (ch === ';') {
                    pendingSpace = false;
                    out = out.replace(/[ ]+$/g, '');
                    out += ';';
                    const afterRaw = s.substring(i + 1);
                    const after = afterRaw.trimStart();
                    if (parenDepth === 0 && after.length > 0) {
                        segments.push(out);
                        out = '';
                        i++;
                        while (i < s.length && (s[i] === ' ' || s[i] === '\t')) i++;
                        continue;
                    } else {
                        if (after && !after.startsWith(')') && !after.startsWith('}') && !after.startsWith(';')) {
                            out += ' ';
                        }
                        i++; continue;
                    }
                }

                if (ch === '?') {
                    emitPendingSpaceIfNeeded('op');
                    out = out.replace(/[ ]+$/g, '');
                    if (out && out[out.length - 1] !== ' ') out += ' ';
                    out += '? ';
                    i++; continue;
                }
                if (ch === ':') {
                    emitPendingSpaceIfNeeded('op');
                    out = out.replace(/[ ]+$/g, '');
                    if (out && out[out.length - 1] !== ' ') out += ' ';
                    out += ': ';
                    i++; continue;
                }

                if ('=+-*/%<>&|^'.includes(ch)) {
                    const prev = out.replace(/\s+$/g, '').slice(-1);
                    const unary = (ch === '*' || ch === '&' || ch === '+' || ch === '-') && (!prev || '([,{;=+-*/%&|^!~?:<>'.includes(prev));
                    const isTemplateStart = () => {
                        if (ch !== '<') return false;
                        const prevNonSpace = out.replace(/\s+$/g, '').slice(-1);
                        const prevLooksLikeName = /[A-Za-z0-9_>]/.test(prevNonSpace || '');
                        if (!prevLooksLikeName) return false;
                        let depth = 1;
                        let k = i + 1;
                        while (k < s.length) {
                            const c = s[k];
                            if (c === '<') depth++;
                            else if (c === '>') { depth--; if (depth === 0) break; }
                            else if (c === '"' || c === '\'') break; // 字符串/字符开始则放弃
                            else if (/[^\sA-Za-z0-9_,:<>&*]/.test(c)) { // 出现不被允许的字符
                                return false;
                            }
                            k++;
                        }
                        return k < s.length && depth === 0;
                    };
                    if (isTemplateStart()) {
                        emitPendingSpaceIfNeeded('op');
                        out = out.replace(/[ ]+$/g, '');
                        out += '<';
                        templateDepth++;
                        i++;
                        continue;
                    }
                    if (ch === '>' && templateDepth > 0) {
                        emitPendingSpaceIfNeeded('op');
                        out = out.replace(/[ ]+$/g, '');
                        out += '>';
                        templateDepth = Math.max(0, templateDepth - 1);
                        i++; continue;
                    }
                    if (unary) {
                        emitPendingSpaceIfNeeded('op');
                        out = out.replace(/[ ]+$/g, '');
                        out += ch; i++; continue;
                    }
                    emitPendingSpaceIfNeeded('op');
                    out = out.replace(/[ ]+$/g, '');
                    if (out && out[out.length - 1] !== ' ') out += ' ';
                    out += ch + ' ';
                    i++; continue;
                }

                if (ch === '(') {
                    const prevNonSpace = out.replace(/\s+$/g, '').slice(-1);
                    const keepTrailingSpace = prevNonSpace && /[=+\-*/%<>&|^!?~,:]/.test(prevNonSpace);
                    if (!keepTrailingSpace) {
                        out = out.replace(/[ ]+$/g, '');
                    }
                    out += '(';
                    parenDepth++;
                    i++;
                    while (i < s.length && isSpace(s[i])) i++;
                    continue;
                }
                if (ch === '{') {
                    emitPendingSpaceIfNeeded('op');
                    const prevNonSpace = out.replace(/\s+$/g, '').slice(-1);
                    const trimmedOut = out.replace(/\s+$/g, '');
                    const blockKeywordRegex = /\b(if|for|while|switch|else|do|try|catch|class|struct|namespace|union|enum|case|default)\b[^{}]*$/;
                    const endsWithControl = /[\)\]]$/.test(trimmedOut);
                    const isInitializerBrace = parenDepth > 0 || (!endsWithControl && !blockKeywordRegex.test(trimmedOut));
                    let shouldAddSpace = prevNonSpace && !/[\s{[(]/.test(prevNonSpace);
                    if (isInitializerBrace) {
                        const lastWordMatch = trimmedOut.match(/([A-Za-z_][A-Za-z0-9_]*)$/);
                        const lastWord = lastWordMatch ? lastWordMatch[1] : '';
                        const keywordsNeedingSpace = new Set(['return', 'co_return', 'throw', 'new']);
                        const prevRequiresSpace = prevNonSpace && /[=,:]/.test(prevNonSpace);
                        shouldAddSpace = keywordsNeedingSpace.has(lastWord) || prevRequiresSpace;
                    }
                    if (shouldAddSpace) {
                        out = out.replace(/[ ]+$/g, '');
                        out += ' ';
                    } else {
                        out = out.replace(/[ ]+$/g, '');
                    }
                    out += ch;
                    if (isInitializerBrace) {
                        inlineBraceDepth++;
                        i++;
                        continue;
                    }
                    const afterBrace = s.substring(i + 1).trim();
                    if (afterBrace && !afterBrace.startsWith('}')) {
                        segments.push(out);
                        out = '';
                        i++;
                        while (i < s.length && (s[i] === ' ' || s[i] === '\t')) i++;
                        continue;
                    }
                    i++; continue;
                }

                if (ch === '}') {
                    if (inlineBraceDepth > 0) {
                        inlineBraceDepth--;
                        emitPendingSpaceIfNeeded('op');
                        out = out.replace(/[ ]+$/g, '');
                        out += ch;
                        i++;
                        continue;
                    }
                    if (out.trim()) {
                        segments.push(out);
                        out = '';
                    }
                    emitPendingSpaceIfNeeded('op');
                    out += ch;
                    let j = i + 1;
                    while (j < s.length && (s[j] === ' ' || s[j] === '\t')) j++;
                    if (s[j] === ';') {
                        out += ';';
                        j++;
                        while (j < s.length && (s[j] === ' ' || s[j] === '\t')) j++;
                        if (j < s.length) {
                            segments.push(out);
                            out = '';
                            i = j;
                            continue;
                        } else {
                            i = j;
                            continue; // 行结束
                        }
                    }
                    const afterBrace = s.substring(i + 1).trim();
                    if (afterBrace) {
                        const varDeclPattern = /^[A-Za-z_\*\&\:\<\>\[\]\,\s0-9]+;\s*$/;
                        if (varDeclPattern.test(afterBrace) && !/\{/.test(afterBrace) && !/\}/.test(afterBrace) && !/\s/.test(afterBrace.replace(/;\s*$/, ''))) {
                            out += ' ' + afterBrace.replace(/\s+$/, '');
                            segments.push(out);
                            out = '';
                            i = s.length; // 跳到行尾
                            continue;
                        }
                        segments.push(out);
                        out = '';
                        i++;
                        while (i < s.length && (s[i] === ' ' || s[i] === '\t')) i++;
                        continue;
                    }
                    i++;
                    continue;
                }

                if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(ch)) {
                    emitPendingSpaceIfNeeded('id');
                    out += ch; i++; continue;
                }

                emitPendingSpaceIfNeeded('op');
                out += ch; i++;
            }

            out = out.replace(/\b(if|for|while|switch|catch)\s*\(/g, '$1 (');

            out = out.replace(/\bcase\s+([^:]+?)\s*:\s*/g, 'case $1: ');
            out = out.replace(/\bdefault\s*:\s*/g, 'default: ');
            {
                const kw = new Set(['if', 'for', 'while', 'switch', 'catch']);
                out = out.replace(/\b([A-Za-z_][A-Za-z0-9_]*)\s+\(/g, (m, name) => {
                    return kw.has(name) ? `${name} (` : `${name}(`;
                });
                out = out.replace(/([\]\>])\s+\(/g, '$1(');
            }
            out = out.replace(/([A-Za-z_][A-Za-z0-9_]*)\s*<\s*([^>]+?)\s*>/g, (m, name, inner) => {
                if (/[;(){}]/.test(inner)) return m;
                const cleaned = inner
                    .replace(/\s*,\s*/g, ', ')
                    .replace(/\s+/g, ' ')
                    .trim();
                return `${name}<${cleaned}>`;
            });

            out = out.replace(/[ \t]+$/g, '');

            out = out.replace(/}\n\s*;/g, '};');

            out = out.replace(/^(\s*case [^:]+:\s*)([^\n][^]*)/gm, (m, head, rest) => {
                if (/^break;/.test(rest.trim())) return head + '\n' + rest.trim();
                return head + '\n' + rest.trim();
            });

            if (out.length > 0) segments.push(out);

            return { segments, open, close, noIndent: false };
        }

        for (let idx = 0; idx < rawLines.length; idx++) {
            let line = rawLines[idx];
            line = line.replace(/[ \t]+$/g, '');

            if (line.trim() === '') {
                if (blankCount < 1) out.push('');
                blankCount++;
                continue;
            }
            blankCount = 0;

            const res = processLine(line, rawLines[idx + 1] || '');

            if (!res.noIndent && res.segments && res.segments.length > 0) {
                const lastSeg = res.segments[res.segments.length - 1];
                if (lastSeg && lastSeg.trim() === '}' && rawLines[idx + 1]) {
                    const nextRaw = rawLines[idx + 1].trim();
                    const nextBody = nextRaw.replace(/;\s*$/, '');
                    if (/^[A-Za-z_\*\&\<\[]/.test(nextRaw) && /;\s*$/.test(nextRaw) && !/=/.test(nextRaw) && !/\s/.test(nextBody)) {
                        res.segments[res.segments.length - 1] = lastSeg + ' ' + nextRaw;
                        idx++;
                        blankCount = 0;
                    }
                }
            }

            if (res.noIndent) {
                res.segments.forEach((seg, sidx) => {
                    out.push(seg);
                });
            } else {
                let tempLevel = indentLevel;
                res.segments.forEach((seg, idxInLine) => {
                    let text = seg.trimStart();
                    const startsClose = text.startsWith('}');
                    const isCaseLine = /^case\s+[^:]+:\s*$/.test(text) || /^default:\s*$/.test(text);
                    let segLevel = Math.max(0, tempLevel - (startsClose ? 1 : 0));
                    if (isCaseLine) {
                        if (segLevel > 0) segLevel -= 1;
                        text = text.trimEnd();
                    }
                    out.push(mkIndent(segLevel) + text);

                    const opens = (seg.match(/\{/g) || []).length;
                    const closes = (seg.match(/\}/g) || []).length;
                    tempLevel = Math.max(0, tempLevel + opens - closes);
                    if (isCaseLine) {
                        const nextSeg = res.segments[idxInLine + 1];
                        if (nextSeg && !/^\s*(case\s+|default:|})/.test(nextSeg)) {
                            tempLevel = tempLevel + 1; // 暂时加一层
                        }
                    }
                });
                indentLevel = tempLevel;
            }

        }

        return out.join(EOL);
    }

    if (!window.cppFormatter) {
        window.cppFormatter = { format: formatCpp };
    }
})();
