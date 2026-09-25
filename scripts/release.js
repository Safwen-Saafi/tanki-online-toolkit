'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { refusalBox, successBox } = require('./term.js');

const ROOT = path.join(__dirname, '..');
const MANIFEST_PATH = path.join(ROOT, 'manifest.json');
const PACKAGE_PATH = path.join(ROOT, 'package.json');

function usageAndExit() {
    console.error('Usage: npm run release -- <patch|minor|major|x.y.z> [--dry-run]');
    process.exit(1);
}

function parseArgs(argv) {
    const dryRun = argv.includes('--dry-run');
    const bump = argv.find((a) => a !== '--dry-run');
    if (!bump) usageAndExit();
    return { bump, dryRun };
}

function computeNextVersion(currentVersion, bump) {
    if (/^\d+\.\d+\.\d+$/.test(bump)) {
        return bump;
    }
    const parts = currentVersion.split('.').map(Number);
    if (parts.length !== 3 || parts.some(Number.isNaN)) {
        throw new Error(`current version "${currentVersion}" is not a valid x.y.z semver`);
    }
    let [major, minor, patch] = parts;
    if (bump === 'patch') {
        patch += 1;
    } else if (bump === 'minor') {
        minor += 1;
        patch = 0;
    } else if (bump === 'major') {
        major += 1;
        minor = 0;
        patch = 0;
    } else {
        usageAndExit();
    }
    return `${major}.${minor}.${patch}`;
}

function currentBranch() {
    return execSync('git rev-parse --abbrev-ref HEAD', { cwd: ROOT }).toString().trim();
}

function isWorkingTreeClean() {
    return execSync('git status --porcelain', { cwd: ROOT }).toString().trim() === '';
}

function lastReleaseTag() {
    try {
        return execSync('git describe --tags --match "v*.*.*" --abbrev=0', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] })
            .toString()
            .trim();
    } catch (e) {
        return null; // no matching tag yet - this is the first release
    }
}

function hasCommitsSinceTag(tag) {
    const tagCommit = execSync(`git rev-list -n 1 ${tag}`, { cwd: ROOT }).toString().trim();
    const headCommit = execSync('git rev-parse HEAD', { cwd: ROOT }).toString().trim();
    return tagCommit !== headCommit;
}

function runPreflightBuild() {
    execSync('npm run build', { cwd: ROOT, stdio: 'inherit' });
}

function writeJsonVersion(filePath, version) {
    const json = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    json.version = version;
    fs.writeFileSync(filePath, JSON.stringify(json, null, 2) + '\n');
}

function main() {
    const { bump, dryRun } = parseArgs(process.argv.slice(2));

    // Guards run cheapest-first: branch, dirty tree, no-changes-since-last-tag,
    // then a full build (the expensive one) last.
    const branch = currentBranch();
    if (branch !== 'main') {
        refusalBox([`refusing to run: on branch "${branch}", not "main"`]);
        process.exit(1);
    }

    if (!isWorkingTreeClean()) {
        refusalBox(['refusing to run: working tree is not clean', 'commit or stash your changes first']);
        process.exit(1);
    }

    const previousTag = lastReleaseTag();
    if (previousTag && !hasCommitsSinceTag(previousTag)) {
        refusalBox([`refusing to run: no changes since ${previousTag}`]);
        process.exit(1);
    }

    console.log('[release] running build pre-flight check...');
    try {
        runPreflightBuild();
    } catch (e) {
        refusalBox(['refusing to run: "npm run build" failed']);
        process.exit(1);
    }

    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    const currentVersion = manifest.version;
    const nextVersion = computeNextVersion(currentVersion, bump);
    const tagName = `v${nextVersion}`;
    const commitMessage = `chore: release ${tagName}`;

    console.log(`[release] current version: ${currentVersion}`);
    console.log(`[release] next version:    ${nextVersion}`);
    console.log('[release] would update:    manifest.json, package.json');
    console.log(`[release] would commit:    "${commitMessage}"`);
    console.log(`[release] would tag:       ${tagName}`);
    console.log('[release] would push:      main, ' + tagName);

    if (dryRun) {
        console.log('[dry-run] no changes made');
        return;
    }

    writeJsonVersion(MANIFEST_PATH, nextVersion);
    writeJsonVersion(PACKAGE_PATH, nextVersion);

    execSync('git add manifest.json package.json', { cwd: ROOT, stdio: 'inherit' });
    execSync(`git commit -m "${commitMessage}"`, { cwd: ROOT, stdio: 'inherit' });
    execSync(`git tag ${tagName}`, { cwd: ROOT, stdio: 'inherit' });
    execSync('git push', { cwd: ROOT, stdio: 'inherit' });
    execSync(`git push origin ${tagName}`, { cwd: ROOT, stdio: 'inherit' });

    successBox([
        `pushed ${tagName}`,
        `${currentVersion} -> ${nextVersion}`,
        'GitHub Actions will build and publish the release',
    ]);
}

main();
