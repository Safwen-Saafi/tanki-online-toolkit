import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ZipArchive } from 'archiver';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const EXTENSION_DIR = path.join(ROOT, 'extension');

function main() {
    const manifest = JSON.parse(fs.readFileSync(path.join(EXTENSION_DIR, 'manifest.json'), 'utf8'));
    const version = manifest.version;

    if (!fs.existsSync(path.join(EXTENSION_DIR, 'js'))) {
        console.error('[package] extension/js is missing (did you run "npm run build"?)');
        process.exit(1);
    }

    const releaseDir = path.join(ROOT, 'release');
    fs.mkdirSync(releaseDir, { recursive: true });

    const zipName = `tanki-online-toolkit-v${version}.zip`;
    const zipPath = path.join(releaseDir, zipName);
    const output = fs.createWriteStream(zipPath);
    const archive = new ZipArchive({ zlib: { level: 9 } });

    output.on('close', () => {
        console.log(`[package] wrote release/${zipName} (${archive.pointer()} bytes)`);
    });
    archive.on('error', (err) => {
        throw err;
    });

    archive.pipe(output);
    archive.directory(EXTENSION_DIR, false);
    archive.finalize();
}

main();
