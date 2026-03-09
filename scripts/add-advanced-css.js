const fs = require('fs');
const path = require('path');
const publicDir = path.join(__dirname, '..', 'public');
const pages = ['dashboard.html', 'jobs.html', 'notifications.html', 'chat.html', 'profile.html', 'wallet.html', 'post-job.html', 'job-detail.html'];
pages.forEach(page => {
    const fp = path.join(publicDir, page);
    if (!fs.existsSync(fp)) { console.log(`SKIP: ${page} (not found)`); return; }
    let html = fs.readFileSync(fp, 'utf8');
    if (html.includes('advanced.css')) { console.log(`OK: ${page}`); return; }
    html = html.replace(/<link rel="stylesheet" href="\/css\/style\.css">/,
        '<link rel="stylesheet" href="/css/style.css">\n    <link rel="stylesheet" href="/css/advanced.css">');
    // Also inject orb-mid if not already present
    if (!html.includes('orb-mid')) {
        html = html.replace(/<div class="toast-container"([^>]*)><\/div>/,
            '<div class="toast-container"$1></div>\n    <div class="orb-mid"></div>');
    }
    fs.writeFileSync(fp, html, 'utf8');
    console.log(`UPDATED: ${page}`);
});
