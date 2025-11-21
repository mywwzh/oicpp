
class Token {
    constructor(start, end, type) {
        this.start = start;
        this.end = end;
        this.type = type;
        this.hasRepeatedChar = false;
    }

    static get Undefined() { return 0; }
    static get OpenBrace() { return 1; }
    static get CloseBrace() { return 2; }
    static get Equal() { return 3; }
    static get String() { return 4; }
    static get Comma() { return 5; }

    extractString(s) {
        return s.substring(this.start, this.end);
    }

    trim(s) {
        while (this.start < s.length && (s[this.start] === ' ' || s[this.start] === '\t' || s[this.start] === '\n')) {
            this.start++;
        }
        while (this.end > 0 && (s[this.end - 1] === ' ' || s[this.end - 1] === '\t' || s[this.end - 1] === '\n')) {
            this.end--;
        }
    }
}

function skipShortenedString(str, pos) {
    while (pos < str.length && str[pos] === '.') {
        pos++;
    }
    return pos;
}

function getNextToken(str, pos) {
    let token = new Token(0, 0, Token.Undefined);
    
    while (pos < str.length && (str[pos] === ' ' || str[pos] === '\t' || str[pos] === '\n')) {
        pos++;
    }

    if (pos >= str.length) return { success: false, pos, token };

    token.start = -1;
    let in_quote = false;
    let in_char = false;
    let open_braces = 0;
    let brace_type = 'None';

    switch (str[pos]) {
        case '=': token = new Token(pos, pos + 1, Token.Equal); return { success: true, pos: pos + 1, token };
        case ',': token = new Token(pos, pos + 1, Token.Comma); return { success: true, pos: pos + 1, token };
        case '{': token = new Token(pos, pos + 1, Token.OpenBrace); return { success: true, pos: pos + 1, token };
        case '}': token = new Token(pos, pos + 1, Token.CloseBrace); return { success: true, pos: pos + 1, token };
        case '"':
            in_quote = true;
            token.type = Token.String;
            token.start = pos;
            break;
        case '\'':
            in_char = true;
            token.type = Token.String;
            token.start = pos;
            break;
        case '<':
            token.type = Token.String;
            token.start = pos;
            open_braces = 1;
            brace_type = 'Angle';
            break;
        case '[':
            token.type = Token.String;
            token.start = pos;
            open_braces = 1;
            brace_type = 'Square';
            break;
        case '(':
            token.type = Token.String;
            open_braces = 1;
            brace_type = 'Normal';
            token.start = pos;
            break;
        default:
            token.type = Token.String;
            token.start = pos;
    }
    pos++;

    let escape_next = false;
    while (pos < str.length) {
        if (open_braces === 0) {
            if (str[pos] === ',' && !in_quote) {
                token.end = pos;
                return { success: true, pos, token };
            } else if ((str[pos] === '=' || str[pos] === '{' || str[pos] === '}') && !in_quote && !in_char) {
                token.end = pos;
                return { success: true, pos, token };
            } else if (str[pos] === '"') {
                if (in_quote) {
                    if (!escape_next) {
                        token.end = skipShortenedString(str, pos + 1);
                        return { success: true, pos: token.end, token };
                    } else {
                        escape_next = false;
                    }
                } else {
                    if (escape_next) return { success: false, pos, token };
                    in_quote = true;
                }
            } else if (str[pos] === '\'') {
                if (!escape_next) in_char = !in_char;
                escape_next = false;
            } else if (str[pos] === '\\') {
                escape_next = true;
            } else {
                escape_next = false;
            }

            switch (brace_type) {
                case 'Angle': if (str[pos] === '<') open_braces++; break;
                case 'Square': if (str[pos] === '[') open_braces++; break;
                default: break;
            }
        } else {
            switch (brace_type) {
                case 'Angle':
                    if (str[pos] === '<') open_braces++;
                    else if (str[pos] === '>') open_braces--;
                    break;
                case 'Square':
                    if (str[pos] === '[') open_braces++;
                    else if (str[pos] === ']') open_braces--;
                    break;
                case 'Normal':
                    if (str[pos] === '(') open_braces++;
                    else if (str[pos] === ')') open_braces--;
                    break;
                default: break;
            }
        }
        pos++;
    }

    if (in_quote) {
        token.end = -1;
        return { success: false, pos, token };
    } else {
        token.end = pos;
        return { success: true, pos, token };
    }
}

function tokenizeGDBLocals(value) {
    const results = [];
    let start = 0;
    let curlyBraces = 0;
    let inString = false;
    let inChar = false;
    let escaped = false;

    for (let ii = 0; ii < value.length; ++ii) {
        const ch = value[ii];
        switch (ch) {
            case '\n':
                if (!inString && !inChar && curlyBraces === 0) {
                    results.push(value.substring(start, ii));
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
            case '\'':
                if (!inString && !escaped) inChar = !inChar;
                break;
        }
        escaped = (ch === '\\' && !escaped);
    }
    if (start < value.length) {
        results.push(value.substring(start));
    }
    
    const parsed = [];
    for (const line of results) {
        const eqPos = line.indexOf('=');
        if (eqPos !== -1) {
            const name = line.substring(0, eqPos).trim();
            const val = line.substring(eqPos + 1).trim();
            if (name) {
                parsed.push({ name, value: val });
            }
        }
    }
    return parsed;
}

function parseGDBWatchValue(watchObj, inputValue) {   
    if (!inputValue) {
        watchObj.value = inputValue;
        return;
    }

    let value = inputValue;
    const start = value.indexOf('{');
    if (start !== -1 && value.trim().endsWith('}')) {
        watchObj.value = "";
        if (start > 0) {
             let refVal = value.substring(0, start).trim();
             if (refVal.endsWith('=')) refVal = refVal.slice(0, -1).trim();
             watchObj.value = refVal;
        }

        parseGDBWatchValueRecursive(watchObj, value, start + 1, 0);
    } else {
        watchObj.value = value;
        watchObj.children = [];
    }
}

function isLikelyName(str) {
    if (!str) return false;
    if (str.startsWith('[') && str.endsWith(']')) return true;
    if (str.startsWith('"') && str.endsWith('"')) return true;
    if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(str)) return true;
    return false;
}

function parseGDBWatchValueRecursive(watchObj, value, start, length) {
    let position = start;
    let token = new Token();
    let token_name = new Token(0,0,Token.Undefined);
    let token_value = new Token(0,0,Token.Undefined);
    let added_children = 0;
    let skip_comma = false;
    let last_was_closing_brace = false;
    let token_real_end = 0;

    while (true) {
        const res = getNextToken(value, position);
        if (!res.success) break;
        token = res.token;
        position = res.pos;
        token_real_end = token.end;
        token.trim(value);
        
            
        switch (token.type) {
            case Token.String:
                if (token_name.type === Token.Undefined) {
                    token_name = token;
                } else if (token_value.type === Token.Undefined) {
                    token_value = token;
                }
                last_was_closing_brace = false;
                break;
            case Token.Equal:
                last_was_closing_brace = false;
                break;
            case Token.Comma:
                last_was_closing_brace = false;
                if (skip_comma) {
                    skip_comma = false;
                } else {

                    let isNextName = false;
                    const nextRes = getNextToken(value, position);
                    if (nextRes.success) {
                        nextRes.token.trim(value);
                        const nextStr = nextRes.token.extractString(value);
                        if (nextRes.token.type === Token.String && isLikelyName(nextStr)) {
                            isNextName = true;
                        } else if (nextRes.token.type === Token.CloseBrace) {
                            isNextName = true;
                        }
                    }

                    if (!isNextName && token_value.type !== Token.Undefined) {
                        break; 
                    }

                    if (token_name.type !== Token.Undefined) {
                        let childName, childValue;
                        if (token_value.type !== Token.Undefined) {
                            childName = token_name.extractString(value);
                            childValue = value.substring(token_value.start, token.start).trim();
                        } else {
                            // Array element
                            childName = `[${added_children}]`;
                            childValue = token_name.extractString(value);
                        }
                        
                        const child = { name: childName, value: childValue, children: [] };
                        watchObj.children.push(child);
                        
                        token_name = new Token(0,0,Token.Undefined);
                        token_value = new Token(0,0,Token.Undefined);
                        added_children++;
                    }
                }
                break;
            case Token.OpenBrace:
                {
                    let childName;
                    let val = "";
                    if (token_name.type === Token.Undefined) {
                        childName = `[${added_children}]`;
                    } else {
                        childName = token_name.extractString(value);
                    }

                    if (token_value.type !== Token.Undefined) {
                        val = value.substring(token_value.start, token.start).trim();
                        if (val.endsWith('=')) val = val.slice(0, -1).trim();
                    }
                    
                    const child = { name: childName, value: val, children: [] };
                    watchObj.children.push(child);
                    
                    const newPos = parseGDBWatchValueRecursive(child, value, token_real_end, 0);
                    position = newPos;
                    
                    token_name = new Token(0,0,Token.Undefined);
                    token_value = new Token(0,0,Token.Undefined);
                    skip_comma = true;
                    last_was_closing_brace = true;
                    added_children++;
                }
                break;
            case Token.CloseBrace:
                if (!last_was_closing_brace) {
                    if (token_name.type !== Token.Undefined) {
                        let childName, childValue;
                        if (token_value.type !== Token.Undefined) {
                            childName = token_name.extractString(value);
                            // Capture until brace
                            childValue = value.substring(token_value.start, token.start).trim();
                        } else {
                            childName = `[${added_children}]`;
                            childValue = token_name.extractString(value);
                        }
                        const child = { name: childName, value: childValue, children: [] };
                        watchObj.children.push(child);
                        added_children++;
                    }
                }
                return token_real_end; // Return new position
            case Token.Undefined:
            default:
                return position;
        }
        
        if (length > 0 && position >= start + length) break;
    }
    return position;
}

module.exports = {
    tokenizeGDBLocals,
    parseGDBWatchValue
};
