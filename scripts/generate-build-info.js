const fs = require('fs');
const path = require('path');

const packageJson = require('../package.json');

const buildInfo = {
    version: packageJson.version,
    buildTime: new Date().toISOString().replace('T', ' ').substring(0, 19),
    author: packageJson.author.name
};

const outputPath = path.join(__dirname, '../src/build-info.json');
fs.writeFileSync(outputPath, JSON.stringify(buildInfo, null, 2), 'utf8');


console.log(`版本: ${buildInfo.version}`);
console.log(`构建时间: ${buildInfo.buildTime}`);

