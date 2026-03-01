const fs = require('fs');
const path = require('path');

const base = path.join('C:', 'Users', 'tanju', 'NYhacks', 'chainsentinel', 'apps', 'web', 'src', 'app', 'api');

// Create directories
fs.mkdirSync(path.join(base, 'ctf-claim'), { recursive: true });
fs.mkdirSync(path.join(base, 'ctf-pool'), { recursive: true });

// Read and copy route files
const claimSrc = path.join(__dirname, 'ctf-claim-route.ts');
const poolSrc = path.join(__dirname, 'ctf-pool-route.ts');
const claimDst = path.join(base, 'ctf-claim', 'route.ts');
const poolDst = path.join(base, 'ctf-pool', 'route.ts');

fs.copyFileSync(claimSrc, claimDst);
fs.copyFileSync(poolSrc, poolDst);

console.log('Created: ' + claimDst);
console.log('Created: ' + poolDst);
console.log('Done!');
