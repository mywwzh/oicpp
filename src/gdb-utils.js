class Token {
    constructor(start, end, type) {
        this.start = start;
        this.end = end;
        this.type = type;
        this.hasRepeatedChar = false;
    }
}
Token.Undefined  = 0;
Token.OpenBrace  = 1;
Token.CloseBrace = 2;
Token.Equal      = 3;
Token.String     = 4;
Token.Comma      = 5;
Token.prototype.extractString = function (s) {
    return s.substring(this.start, this.end);
};
Token.prototype.trim = function (s) {
    while (this.start < s.length && (s[this.start] === ' ' || s[this.start] === '\t' || s[this.start] === '\n')) {
        this.start++;
    }
    while (this.end > 0 && (s[this.end - 1] === ' ' || s[this.end - 1] === '\t' || s[this.end - 1] === '\n')) {
        this.end--;
    }
};
function skipShortenedString(str, pos) {
    while (pos < str.length && str[pos] === '.') {
        pos++;
    }
    return pos;
}
const _reRepeatedChars = /^((\\'.{1,6}\\')|('.{1,6}'))[ \t](<repeats[ \t][0-9]+[ \t]times>)/;
function detectRepeatingSymbols(str, pos) {
    let newPos = -1;
    let currPos = pos;
    while (true) {
        if (currPos + 4 >= str.length) break;
        if (str[currPos + 1] !== ',') break;
        if (str[currPos + 3] === "'") {
            const s = str.substring(currPos + 3);
            const m = _reRepeatedChars.exec(s);
            if (m) {
                newPos = currPos + 3 + m[0].length;
                if (newPos + 4 < str.length && str[newPos] === ',' && str[newPos + 2] === '"') {
                    newPos += 3;
                    while (newPos < str.length && str[newPos] !== '"') newPos++;
                    if (newPos + 1 < str.length && str[newPos] === '"') newPos++;
                }
                currPos = newPos;
            } else {
                break;
            }
        } else {
            break;
        }
        currPos--;
    }
    return newPos;
}
function getNextToken(str, pos) {
    const token = new Token(0, 0, Token.Undefined);
    token.hasRepeatedChar = false;
    while (pos < str.length && (str[pos] === ' ' || str[pos] === '\t' || str[pos] === '\n')) {
        pos++;
    }
    if (pos >= str.length) return { success: false, pos, token };
    token.start = -1;
    let inQuote = false;
    let inChar = false;
    let openBraces = 0;
    let braceType = 'None';
    switch (str[pos]) {
        case '=':
            return { success: true, pos: pos + 1, token: new Token(pos, pos + 1, Token.Equal) };
        case ',':
            return { success: true, pos: pos + 1, token: new Token(pos, pos + 1, Token.Comma) };
        case '{':
            return { success: true, pos: pos + 1, token: new Token(pos, pos + 1, Token.OpenBrace) };
        case '}':
            return { success: true, pos: pos + 1, token: new Token(pos, pos + 1, Token.CloseBrace) };
        case '"':
            inQuote = true;
            token.type = Token.String;
            token.start = pos;
            break;
        case "'":
            inChar = true;
            token.type = Token.String;
            token.start = pos;
            break;
        case '<':
            token.type = Token.String;
            token.start = pos;
            openBraces = 1;
            braceType = 'Angle';
            break;
        case '[':
            token.type = Token.String;
            token.start = pos;
            openBraces = 1;
            braceType = 'Square';
            break;
        case '(':
            token.type = Token.String;
            openBraces = 1;
            braceType = 'Normal';
            token.start = pos;
            break;
        default:
            token.type = Token.String;
            token.start = pos;
    }
    pos++;
    let escapeNext = false;
    while (pos < str.length) {
        if (openBraces === 0) {
            if (str[pos] === ',' && !inQuote) {
                token.end = pos;
                return { success: true, pos, token };
            } else if ((str[pos] === '=' || str[pos] === '{' || str[pos] === '}') && !inQuote && !inChar) {
                token.end = pos;
                return { success: true, pos, token };
            } else if (str[pos] === '"') {
                if (inQuote) {
                    if (!escapeNext) {
                        const newPos = detectRepeatingSymbols(str, pos);
                        if (newPos !== -1) {
                            token.hasRepeatedChar = true;
                            token.end = skipShortenedString(str, newPos);
                            return { success: true, pos: token.end, token };
                        } else {
                            token.end = skipShortenedString(str, pos + 1);
                            return { success: true, pos: token.end, token };
                        }
                    } else {
                        escapeNext = false;
                    }
                } else {
                    if (escapeNext) return { success: false, pos, token };
                    inQuote = true;
                }
            } else if (str[pos] === "'") {
                if (!escapeNext) inChar = !inChar;
                escapeNext = false;
            } else if (str[pos] === '\\') {
                escapeNext = true;
            } else {
                escapeNext = false;
            }
            if (braceType === 'Angle' && str[pos] === '<') openBraces++;
            if (braceType === 'Square' && str[pos] === '[') openBraces++;
        } else {
            if (braceType === 'Angle') {
                if (str[pos] === '<') openBraces++;
                else if (str[pos] === '>') openBraces--;
            } else if (braceType === 'Square') {
                if (str[pos] === '[') openBraces++;
                else if (str[pos] === ']') openBraces--;
            } else if (braceType === 'Normal') {
                if (str[pos] === '(') openBraces++;
                else if (str[pos] === ')') openBraces--;
            }
        }
        pos++;
    }
    if (inQuote) {
        token.end = -1;
        return { success: false, pos, token };
    } else {
        token.end = pos;
        return { success: true, pos, token };
    }
}
function isLikelyName(str) {
    if (!str) return false;
    if (str.startsWith('[') && str.endsWith(']')) return true;
    if (str.startsWith('"') && str.endsWith('"')) return true;
    if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(str)) return true;
    return false;
}
function isPointerType(typeStr) {
    if (!typeStr) return false;
    const trimmed = typeStr.trim();
    return trimmed.endsWith('*') || trimmed.endsWith('&');
}
function addChild(watchObj, childName, childValue) {
    let child;
    const existing = (watchObj.children || []).find(c => c.name === childName);
    if (existing) {
        child = existing;
    } else {
        child = { name: childName, value: childValue || '', children: [] };
        if (!watchObj.children) watchObj.children = [];
        watchObj.children.push(child);
    }
    return child;
}
function parseGDBWatchValueRecursive(watchObj, value, start, length) {
    let position = start;
    let tokenName = new Token(0, 0, Token.Undefined);
    let tokenValue = new Token(0, 0, Token.Undefined);
    let addedChildren = 0;
    let skipComma = false;
    let lastWasClosingBrace = false;
    let tokenRealEnd = 0;
    let pythonToStringValue = '';
    while (true) {
        const res = getNextToken(value, position);
        if (!res.success) break;
        const token = res.token;
        position = res.pos;
        tokenRealEnd = token.end;
        token.trim(value);
        const str = token.extractString(value);
        if (str.startsWith('members of ')) {
            const nlPos = str.indexOf('\n');
            if (nlPos === -1) {
                const valPos = value.indexOf('\n', tokenRealEnd);
                if (valPos === -1) return false;
                position = valPos + 1;
                if (length > 0 && position >= start + length) break;
                continue;
            } else {
                const colonPos = str.lastIndexOf(':', nlPos);
                if (colonPos === -1) return false;
                token.start += nlPos + 2;
                token.trim(value);
            }
        }
        const reRepeatedChar = /.+[ \t](<repeats[ \t][0-9]+[ \t]times>)$/;
        if (!token.hasRepeatedChar && reRepeatedChar.test(str)) {
            let expandedToken = new Token(token.start, token.end, token.type);
            while (true) {
                if (value[expandedToken.end] === ',') {
                    position = token.end + 1;
                    tokenRealEnd = position;
                    const commaEnd = expandedToken.end;
                    const nextRes = getNextToken(value, position);
                    if (nextRes.success) {
                        const expandedStr = nextRes.token.extractString(value);
                        if (expandedStr && expandedStr[0] !== '"' && expandedStr[0] !== "'") {
                            token.end = commaEnd;
                            position = commaEnd;
                            tokenRealEnd = commaEnd;
                            break;
                        }
                        expandedToken = nextRes.token;
                        token.end = expandedToken.end;
                        if (reRepeatedChar.test(expandedStr)) continue;
                        tokenRealEnd = expandedToken.end;
                    }
                } else if (expandedToken.end === value.length || value[expandedToken.end] === '}') {
                    token.end = expandedToken.end;
                    tokenRealEnd = expandedToken.end;
                }
                break;
            }
        }
        switch (token.type) {
            case Token.String:
                if (tokenName.type === Token.Undefined) {
                    tokenName = token;
                } else if (tokenValue.type === Token.Undefined) {
                    if (/^\d/.test(str) || str.startsWith("'") || str.startsWith('"') ||
                        str.startsWith('<') || str.startsWith('-') || str.startsWith('L"') || str.startsWith("L'")) {
                        tokenValue = token;
                    } else {
                        let expandedToken = new Token(token.start, token.end, token.type);
                        let firstCloseBrace = -1;
                        for (; expandedToken.end < value.length; expandedToken.end++) {
                            if (value[expandedToken.end] === '=') {
                                let foundBrace = false;
                                for (let ii = expandedToken.end + 1; ii < value.length; ii++) {
                                    if (value[ii] === '{') { foundBrace = true; break; }
                                    else if (value[ii] !== ' ' && value[ii] !== '\t' && value[ii] !== '\n') break;
                                }
                                if (foundBrace) {
                                    token.end = expandedToken.end;
                                    tokenRealEnd = expandedToken.end;
                                    tokenValue = new Token(token.start, token.end - 1, Token.String);
                                    pythonToStringValue = tokenValue.extractString(value);
                                } else {
                                    while (expandedToken.end >= 0) {
                                        if (value[expandedToken.end] === ',') {
                                            token.end = expandedToken.end;
                                            tokenRealEnd = expandedToken.end;
                                            tokenValue = new Token(token.start, expandedToken.end, Token.String);
                                            pythonToStringValue = tokenValue.extractString(value);
                                            break;
                                        }
                                        expandedToken.end--;
                                    }
                                }
                                break;
                            } else if (firstCloseBrace === -1 && value[expandedToken.end] === '}') {
                                firstCloseBrace = expandedToken.end;
                                break;
                            }
                        }
                        if (!pythonToStringValue) {
                            if (firstCloseBrace === -1) return false;
                            token.end = firstCloseBrace;
                            tokenRealEnd = firstCloseBrace;
                            tokenValue = new Token(token.start, firstCloseBrace, Token.String);
                            pythonToStringValue = tokenValue.extractString(value);
                            if (!pythonToStringValue) return false;
                        }
                    }
                } else {
                    return false;
                }
                lastWasClosingBrace = false;
                break;
            case Token.Equal:
                lastWasClosingBrace = false;
                break;
            case Token.Comma:
                pythonToStringValue = '';
                lastWasClosingBrace = false;
                if (skipComma) {
                    skipComma = false;
                } else {
                    if (tokenName.type !== Token.Undefined) {
                        if (tokenValue.type !== Token.Undefined) {
                            const child = addChild(watchObj, tokenName.extractString(value), tokenValue.extractString(value));
                            if (!child.children || child.children.length === 0) {
                                parseGDBWatchValue(child, child.value);
                            }
                        } else {
                            const child = addChild(watchObj, `[${addedChildren}]`, tokenName.extractString(value));
                            if (!child.children || child.children.length === 0) {
                                parseGDBWatchValue(child, child.value);
                            }
                        }
                        tokenName = new Token(0, 0, Token.Undefined);
                        tokenValue = new Token(0, 0, Token.Undefined);
                        addedChildren++;
                    } else {
                        const nextRes = getNextToken(value, position);
                        if (nextRes.success) {
                            nextRes.token.trim(value);
                            const nextStr = nextRes.token.extractString(value);
                            if (!((nextRes.token.type === Token.String && isLikelyName(nextStr)) ||
                                  nextRes.token.type === Token.CloseBrace)) {
                                break;
                            }
                        }
                        if (tokenName.type !== Token.Undefined) {
                            break;
                        }
                    }
                }
                break;
            case Token.OpenBrace:
                {
                    let childName;
                    let val = '';
                    if (tokenName.type === Token.Undefined) {
                        childName = `[${addedChildren}]`;
                    } else {
                        childName = tokenName.extractString(value);
                    }
                    if (tokenValue.type !== Token.Undefined) {
                        val = value.substring(tokenValue.start, token.start).trim();
                        if (val.endsWith('=')) val = val.slice(0, -1).trim();
                    }
                    const child = addChild(watchObj, childName, pythonToStringValue || val);
                    const newPos = parseGDBWatchValueRecursive(child, value, tokenRealEnd, 0);
                    position = newPos;
                    tokenName = new Token(0, 0, Token.Undefined);
                    tokenValue = new Token(0, 0, Token.Undefined);
                    skipComma = true;
                    lastWasClosingBrace = true;
                    addedChildren++;
                }
                break;
            case Token.CloseBrace:
                if (!lastWasClosingBrace) {
                    if (tokenName.type !== Token.Undefined) {
                        if (tokenValue.type !== Token.Undefined) {
                            const child = addChild(watchObj, tokenName.extractString(value), tokenValue.extractString(value));
                            if (!child.children || child.children.length === 0) {
                                parseGDBWatchValue(child, child.value);
                            }
                        } else {
                            const child = addChild(watchObj, `[${addedChildren}]`, tokenName.extractString(value));
                            if (!child.children || child.children.length === 0) {
                                parseGDBWatchValue(child, child.value);
                            }
                        }
                        addedChildren++;
                    } else {
                        watchObj.value = '';
                    }
                }
                return tokenRealEnd;
            case Token.Undefined:
            default:
                return position;
        }
        position = tokenRealEnd;
        if (length > 0 && position >= start + length) break;
    }
    if (tokenName.type !== Token.Undefined) {
        if (tokenValue.type !== Token.Undefined) {
            const child = addChild(watchObj, tokenName.extractString(value), tokenValue.extractString(value));
            if (!child.children || child.children.length === 0) {
                parseGDBWatchValue(child, child.value);
            }
        } else {
            const child = addChild(watchObj, `[${addedChildren}]`, tokenName.extractString(value));
            if (!child.children || child.children.length === 0) {
                parseGDBWatchValue(child, child.value);
            }
        }
    }
    return position;
}
function removeWarnings(input) {
    const lines = input.split('\n');
    const result = [];
    for (const line of lines) {
        if (!line.startsWith('warning:')) {
            result.push(line);
        }
    }
    return result.join('\n');
}
function parseGDBWatchValue(watchObj, inputValue) {
    if (!inputValue) {
        watchObj.value = inputValue || '';
        return true;
    }
    let value = removeWarnings(String(inputValue));
    const start = value.indexOf('{');
    if (start !== -1 && value.trimEnd().endsWith('}')) {
        watchObj.value = '';
        if (start > 0) {
            let refVal = value.substring(0, start).trim();
            if (refVal.endsWith('=')) refVal = refVal.slice(0, -1).trim();
            watchObj.value = refVal;
        }
        const result = parseGDBWatchValueRecursive(watchObj, value, start + 1, 0);
        return !!result;
    } else {
        watchObj.value = value;
        watchObj.children = [];
        return true;
    }
}
function tokenizeGDBLocals(value) {
    const results = [];
    let start = 0;
    let curlyBraces = 0;
    let inString = false;
    let inChar = false;
    let escaped = false;
    for (let ii = 0; ii < value.length; ii++) {
        const ch = value[ii];
        switch (ch) {
            case '\n':
                if (!inString && !inChar && curlyBraces === 0) {
                    const line = value.substring(start, ii);
                    parseLocalLine(results, line);
                    start = ii + 1;
                }
                break;
            case '{':
                if (!inString && !inChar) curlyBraces++;
                break;
            case '}':
                if (!inString && !inChar) curlyBraces--;
                break;
            case '"':
                if (!inChar && !escaped) inString = !inString;
                break;
            case "'":
                if (!inString && !escaped) inChar = !inChar;
                break;
        }
        escaped = (ch === '\\' && !escaped);
    }
    if (start < value.length) {
        const line = value.substring(start);
        parseLocalLine(results, line);
    }
    return results;
}
function parseLocalLine(results, line) {
    const trimmed = line.trim();
    if (!trimmed) return;
    const eqPos = trimmed.indexOf('=');
    if (eqPos !== -1) {
        const name = trimmed.substring(0, eqPos).trim();
        const val = trimmed.substring(eqPos + 1).trim();
        if (name) {
            results.push({ name, value: val });
        }
    } else {
        results.push({ name: trimmed, value: '' });
    }
}
const reBT0 = /^#(\d+)[ \t]+(.+?)[ \t]+at[ \t]+(.+):(\d+)/;
const reBT1 = /^#(\d+)[ \t]+0x([A-Fa-f0-9]+)[ \t]+in[ \t]+(.+?)[ \t]+(\([^)]*\))/;
const reBTX = /^#(\d+)[ \t]+0x([A-Fa-f0-9]+)[ \t]+in[ \t]+([^(]+?)[ \t]*(\([^)]*\)[ \t]*\([^)]*\))/;
const reBT2 = /\)[ \t]+(?:at|from)[ \t]+(.+):(\d+)/;
const reBT3 = /\)[ \t]+(?:at|from)[ \t]+(.+)/;
const reBT4 = /^#(\d+)[ \t]+(.+?)[ \t]+in[ \t]+(.+)/;
function tokenizeBacktrace(output) {
    const frames = [];
    const lines = output.split(/\r?\n/);
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let sf = { level: -1, address: '', function: '', file: '', line: -1 };
        let hasLineInfo = false;
        let m;
        if ((m = reBTX.exec(trimmed))) {
            sf.level = parseInt(m[1], 10);
            sf.address = m[2];
            sf.function = m[3] + m[4];
        } else if ((m = reBT1.exec(trimmed))) {
            sf.level = parseInt(m[1], 10);
            sf.address = m[2];
            sf.function = m[3] + m[4];
        } else if ((m = reBT0.exec(trimmed))) {
            sf.level = parseInt(m[1], 10);
            sf.address = '0x0';
            sf.function = m[2];
            sf.file = m[3];
            sf.line = parseInt(m[4], 10);
            hasLineInfo = true;
        } else if ((m = reBT4.exec(trimmed))) {
            sf.level = parseInt(m[1], 10);
            sf.address = m[2];
            sf.function = m[3];
        } else {
            continue;
        }
        if ((m = reBT2.exec(trimmed))) {
            sf.file = m[1];
            sf.line = parseInt(m[2], 10);
            hasLineInfo = true;
        } else if ((m = reBT3.exec(trimmed))) {
            sf.file = m[1];
        }
        if (sf.level >= 0) {
            frames.push({
                level: sf.level,
                address: sf.address,
                function: sf.function,
                file: sf.file,
                line: sf.line,
                hasLineInfo: hasLineInfo
            });
        }
    }
    return frames;
}
const reExamineMemoryLine = /[ \t]*(0x[0-9a-f]+)[ \t]<.+>:[ \t]+(.+)/;
function parseGDBExamineMemoryLine(outputLine) {
    const result = { addr: '', values: [] };
    if (!outputLine) return result;
    if (outputLine.startsWith('Cannot access memory at address ')) return result;
    let memory;
    const m = reExamineMemoryLine.exec(outputLine);
    if (m) {
        result.addr = m[1];
        memory = m[2];
    } else {
        const colonIdx = outputLine.indexOf(':');
        if (colonIdx === -1) return result;
        result.addr = outputLine.substring(0, colonIdx).trim();
        memory = outputLine.substring(colonIdx + 1);
    }
    let pos = memory.indexOf('x');
    while (pos !== -1 && pos + 2 < memory.length) {
        const hexByte = memory[pos + 1] + memory[pos + 2];
        const value = parseInt(hexByte, 16);
        if (!isNaN(value)) {
            result.values.push(value);
        }
        pos = memory.indexOf('x', pos + 1);
    }
    return result;
}
module.exports = {
    Token,
    getNextToken,
    tokenizeGDBLocals,
    parseGDBWatchValue,
    tokenizeBacktrace,
    parseGDBExamineMemoryLine,
    isPointerType
};
