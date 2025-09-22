#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const distDir = path.join(__dirname, '..', 'dist');
const srcDir = path.join(__dirname, '..', 'src');

// Create dist/data directory if it doesn't exist
const dataDir = path.join(distDir, 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
    console.log('Created dist/data directory');
}

// Copy requirements.txt to dist/data
const requirementsSrc = path.join(srcDir, 'data', 'requirements.txt');
const requirementsDest = path.join(dataDir, 'requirements.txt');
if (fs.existsSync(requirementsSrc)) {
    fs.copyFileSync(requirementsSrc, requirementsDest);
    console.log('Copied requirements.txt to dist/data');
}

// Create dist/bin directory if it doesn't exist
const binDir = path.join(distDir, 'bin');
if (!fs.existsSync(binDir)) {
    fs.mkdirSync(binDir, { recursive: true });
    console.log('Created dist/bin directory');
}

// Copy all .mjs files from src/bin to dist/bin
const srcBinDir = path.join(srcDir, 'bin');
if (fs.existsSync(srcBinDir)) {
    const mjsFiles = fs.readdirSync(srcBinDir).filter(file => file.endsWith('.mjs'));
    mjsFiles.forEach(file => {
        const src = path.join(srcBinDir, file);
        const dest = path.join(binDir, file);
        fs.copyFileSync(src, dest);
        console.log(`Copied ${file} to dist/bin`);
    });
}

console.log('Post-build script completed successfully');