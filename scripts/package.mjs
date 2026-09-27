import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ZipArchive } from 'archiver';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

// Fixed list, not a glob: keeps blueprint/, scripts/, node_modules/, etc.
// out of the shipped zip no matter what else lands in the repo root.
const RUNTIME_FILES = [
    'manifest.json',
    'injector.js',
    'change_counter.js',
    'garage_skins.js',
    'database/skins.json',
];

function main() {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
    const version = manifest.version;

    for (const file of RUNTIME_FILES) {
        if (!fs.existsSync(path.join(ROOT, file))) {
            console.error(`[package] missing required file: ${file} (did you run "npm run build"?)`);
            process.exit(1);
        }
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
    for (const file of RUNTIME_FILES) {
        archive.file(path.join(ROOT, file), { name: file });
    }
    archive.finalize();
}

main();
