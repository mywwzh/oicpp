const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawnSync } = require('child_process');
const { path7za } = require('7zip-bin');
const extractZip = require('extract-zip');

const args = process.argv.slice(2);
const readArg = (name, fallback) => {
    const idx = args.findIndex((value) => value === `--${name}`);
    if (idx >= 0 && idx + 1 < args.length) {
        return args[idx + 1];
    }
    return fallback;
};

const normalizePlatform = (raw) => {
    const value = String(raw || '').toLowerCase();
    if (value === 'win' || value === 'windows') return 'win32';
    if (value === 'mac' || value === 'osx' || value === 'macos') return 'darwin';
    if (value === 'linux') return 'linux';
    return value || process.platform;
};

const version = readArg('version', process.env.CLANGD_VERSION || '22.1.0');
const tag = readArg('tag', process.env.CLANGD_TAG || version);
const repo = readArg('repo', process.env.CLANGD_REPO || 'clangd/clangd');
const platform = normalizePlatform(readArg('platform', process.env.OICPP_CLANGD_PLATFORM || process.platform));
const outputRoot = path.resolve(readArg('output', process.env.CLANGD_OUTPUT || path.join(__dirname, '..', 'build', 'clangd')));
const tempRoot = path.join(outputRoot, '_download');

const platformPatterns = {
    win32: [
        /^clangd-windows-.*\.zip$/i,
        /^clangd-win.*\.zip$/i
    ],
    darwin: [
        /^clangd-mac-.*\.zip$/i,
        /^clangd-macos-.*\.zip$/i
    ],
    linux: [
        /^clangd-linux-.*\.zip$/i
    ]
};

const ensureDir = (dirPath) => {
    fs.mkdirSync(dirPath, { recursive: true });
};

const requestJson = (url, token) => new Promise((resolve, reject) => {
    const opts = new URL(url);
    const headers = {
        'User-Agent': 'oicpp-clangd-downloader',
        'Accept': 'application/vnd.github+json'
    };
    if (token) {
        headers.Authorization = `Bearer ${token}`;
    }
    opts.headers = headers;
    https.get(opts, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
            if (res.statusCode && res.statusCode >= 400) {
                reject(new Error(`GitHub API error ${res.statusCode}: ${data.slice(0, 200)}`));
                return;
            }
            try {
                resolve(JSON.parse(data));
            } catch (err) {
                reject(err);
            }
        });
    }).on('error', reject);
});

const downloadFile = (url, dest, token) => new Promise((resolve, reject) => {
    const opts = new URL(url);
    const headers = { 'User-Agent': 'oicpp-clangd-downloader' };
    if (token) {
        headers.Authorization = `Bearer ${token}`;
    }
    opts.headers = headers;

    const file = fs.createWriteStream(dest);
    https.get(opts, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            file.close(() => {
                downloadFile(res.headers.location, dest, token).then(resolve).catch(reject);
            });
            return;
        }
        if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`Download failed ${res.statusCode}: ${url}`));
            return;
        }
        res.pipe(file);
        file.on('finish', () => file.close(resolve));
    }).on('error', (err) => {
        try { fs.unlinkSync(dest); } catch (_) {}
        reject(err);
    });
});

const run7z = (argsList) => {
    const result = spawnSync(path7za, argsList, { stdio: 'inherit' });
    if (result.status !== 0) {
        throw new Error(`7z failed: ${argsList.join(' ')}`);
    }
};

const extractArchive = async (archivePath, extractTo) => {
    ensureDir(extractTo);
    const lower = archivePath.toLowerCase();
    if (lower.endsWith('.zip')) {
        await extractZip(archivePath, { dir: extractTo });
        return;
    }

    run7z(['x', archivePath, `-o${extractTo}`, '-y']);
    if (lower.endsWith('.tar.xz') || lower.endsWith('.tar.gz')) {
        const tarPath = path.join(extractTo, path.basename(archivePath).replace(/\.(xz|gz)$/i, ''));
        if (fs.existsSync(tarPath)) {
            run7z(['x', tarPath, `-o${extractTo}`, '-y']);
        }
    }
};

const walkForClangdRoot = (baseDir) => {
    const queue = [{ dir: baseDir, depth: 0 }];
    const maxDepth = 6;
    const found = [];

    while (queue.length) {
        const { dir, depth } = queue.shift();
        if (depth > maxDepth) continue;
        let entries = [];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch (_) {
            continue;
        }

        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                queue.push({ dir: full, depth: depth + 1 });
                continue;
            }
            const lower = entry.name.toLowerCase();
            if (lower === 'clangd' || lower === 'clangd.exe') {
                const binDir = path.dirname(full);
                if (path.basename(binDir).toLowerCase() === 'bin') {
                    found.push(path.dirname(binDir));
                }
            }
        }
    }

    if (!found.length) return null;
    found.sort((a, b) => a.length - b.length);
    return found[0];
};

const main = async () => {
    if (!platformPatterns[platform]) {
        throw new Error(`Unsupported platform: ${platform}`);
    }

    const targetRoot = path.join(outputRoot, platform);
    if (fs.existsSync(targetRoot)) {
        console.log(`[clangd] Target exists: ${targetRoot}, skipping`);
        return;
    }

    const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
    const releaseUrl = `https://api.github.com/repos/${repo}/releases/tags/${tag}`;
    console.log(`[clangd] Fetching release ${releaseUrl}`);

    const release = await requestJson(releaseUrl, token || undefined);
    const assets = Array.isArray(release.assets) ? release.assets : [];

    const patterns = platformPatterns[platform] || [];
    let selected = null;
    for (const pattern of patterns) {
        selected = assets.find((asset) => pattern.test(asset.name));
        if (selected) break;
    }

    if (!selected) {
        const names = assets.map((asset) => asset.name).join(', ');
        throw new Error(`clangd asset not found for ${platform}. Assets: ${names}`);
    }

    console.log(`[clangd] Selected asset: ${selected.name}`);
    ensureDir(tempRoot);
    const downloadPath = path.join(tempRoot, selected.name);

    if (!fs.existsSync(downloadPath)) {
        console.log(`[clangd] Downloading to ${downloadPath}`);
        await downloadFile(selected.browser_download_url, downloadPath, token || undefined);
    } else {
        console.log('[clangd] Using cached download');
    }

    const extractRoot = path.join(tempRoot, 'extract');
    fs.rmSync(extractRoot, { recursive: true, force: true });
    ensureDir(extractRoot);

    console.log('[clangd] Extracting...');
    await extractArchive(downloadPath, extractRoot);

    const installRoot = walkForClangdRoot(extractRoot);
    if (!installRoot) {
        throw new Error('Unable to locate clangd root (bin/clangd) after extraction');
    }

    fs.rmSync(targetRoot, { recursive: true, force: true });
    ensureDir(outputRoot);

    console.log(`[clangd] Copying ${installRoot} -> ${targetRoot}`);
    fs.cpSync(installRoot, targetRoot, { recursive: true });

    console.log('[clangd] Done');
};

main().catch((err) => {
    console.error('[clangd] Failed:', err);
    process.exit(1);
});
