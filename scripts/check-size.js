// Release size check: warn above 500 KB, fail above 1 MB (decided in the GraphQL plan).
const fs = require('fs');
const path = require('path');

const WARN = 500 * 1024;
const LIMIT = 1024 * 1024;

const root = path.join(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));
const file = process.argv[2] || path.join(root, `${pkg.name}-${pkg.version}.vsix`);

if (!fs.existsSync(file)) {
  console.error(`check-size: ${path.basename(file)} not found. Run "npx vsce package" first.`);
  process.exit(1);
}
const size = fs.statSync(file).size;
const kb = (size / 1024).toFixed(0);
if (size > LIMIT) {
  console.error(`✗ ${path.basename(file)} is ${kb} KB, over the 1 MB limit. Find what grew before releasing.`);
  process.exit(1);
} else if (size > WARN) {
  console.warn(`! ${path.basename(file)} is ${kb} KB, over the 500 KB target (limit 1 MB).`);
} else {
  console.log(`✓ ${path.basename(file)} is ${kb} KB (target under 500 KB, limit 1 MB).`);
}
