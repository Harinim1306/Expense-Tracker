const fs = require('fs');

let html = fs.readFileSync('index.html', 'utf8');
const css = fs.readFileSync('style.css', 'utf8');
const cloudSyncJs = fs.readFileSync('cloudSync.js', 'utf8');
const js = fs.readFileSync('app.js', 'utf8');

// Replace external css with inline style
html = html.replace('<link rel="stylesheet" href="style.css">', `<style>\n${css}\n</style>`);
// Replace cloudSync.js script with inline
html = html.replace('<script src="cloudSync.js"></script>', `<script>\n${cloudSyncJs}\n</script>`);
// Replace external js with inline script
html = html.replace('<script src="app.js"></script>', `<script>\n${js}\n</script>`);

fs.writeFileSync('standalone.html', html, 'utf8');
console.log('standalone.html generated successfully!');
