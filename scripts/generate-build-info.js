const fs = require('fs');
const path = require('path');

const packageJson = require('../package.json');

function pad2(n) {
    return String(n).padStart(2, '0');
}

function formatDateTimeInTimeZone(date, timeZone) {
    const d = date instanceof Date ? date : new Date(date);
    try {
        const dtf = new Intl.DateTimeFormat('en-CA', {
            timeZone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        });

        const parts = dtf.formatToParts(d);
        const map = Object.create(null);
        for (const part of parts) {
            if (part && part.type && part.type !== 'literal') {
                map[part.type] = part.value;
            }
        }
        if (map.year && map.month && map.day && map.hour && map.minute && map.second) {
            return `${map.year}-${map.month}-${map.day} ${map.hour}:${map.minute}:${map.second}`;
        }
    } catch (_) {
    }

    // Fallback: assume UTC and shift to UTC+8 (Asia/Shanghai)
    const utcMs = d.getTime() + d.getTimezoneOffset() * 60000;
    const shanghai = new Date(utcMs + 8 * 60 * 60000);
    return [
        shanghai.getFullYear(),
        pad2(shanghai.getMonth() + 1),
        pad2(shanghai.getDate())
    ].join('-') + ' ' + [
        pad2(shanghai.getHours()),
        pad2(shanghai.getMinutes()),
        pad2(shanghai.getSeconds())
    ].join(':');
}

const buildInfo = {
    version: packageJson.version,
    buildTime: formatDateTimeInTimeZone(new Date(), 'Asia/Shanghai'),
    author: packageJson.author.name
};

const outputPath = path.join(__dirname, '../src/build-info.json');
fs.writeFileSync(outputPath, JSON.stringify(buildInfo, null, 2), 'utf8');

console.log(`version: ${buildInfo.version}`);
console.log(`buildTime: ${buildInfo.buildTime}`);

