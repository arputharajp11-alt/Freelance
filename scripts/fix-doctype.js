const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, '..', 'public');
const pages = ['dashboard.html', 'jobs.html', 'notifications.html', 'chat.html', 'profile.html', 'wallet.html', 'post-job.html', 'job-detail.html', 'register.html', 'login.html', 'index.html'];

pages.forEach(f => {
    const fp = path.join(dir, f);
    if (!fs.existsSync(fp)) return;
    let h = fs.readFileSync(fp, 'utf8');
    // Remove duplicate doctype/html pairs - keep only the first occurrence
    const fixed = h.replace(/(<!DOCTYPE html>\s*<html[^>]*>\s*)+(<!DOCTYPE html>\s*<html[^>]*>)/gi, '$1').replace(/(<!DOCTYPE html>\s*\n?<html[^>]*>\s*\n?)(<!DOCTYPE html>[\s\S]*?<html[^>]*>)/i, '$1');
    if (fixed !== h) {
        fs.writeFileSync(fp, fixed, 'utf8');
        console.log('FIXED: ' + f);
    } else {
        console.log('OK: ' + f);
    }
});
