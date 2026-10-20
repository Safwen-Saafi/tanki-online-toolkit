import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ZipArchive } from 'archiver';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const EXTENSION_DIR = path.join(ROOT, 'extension');

function fail(error) {
    console.error(`[package] failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
}

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
    output.on('error', fail);
    archive.on('error', fail);

    archive.pipe(output);
    archive.directory(EXTENSION_DIR, false);
    archive.finalize().catch(fail);
}

main();
