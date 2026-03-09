const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, '..', 'public');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.html'));
let count = 0;
const SEARCH = '<script src="/js/app.js"></script>';
const REPLACE = '<script src="/js/config.js"></script>\n<script src="/js/app.js"></script>';
files.forEach(f => {
    const fp = path.join(dir, f);
    let html = fs.readFileSync(fp, 'utf8');
    if (html.includes('/js/config.js')) {
        console.log('Already has config.js:', f);
        return;
    }
    if (html.includes(SEARCH)) {
        html = html.replace(SEARCH, REPLACE);
        fs.writeFileSync(fp, html, 'utf8');
        count++;
        console.log('Updated:', f);
    } else {
        console.log('No app.js script tag found in:', f);
    }
});
console.log('\nDone:', count, 'files updated.');
