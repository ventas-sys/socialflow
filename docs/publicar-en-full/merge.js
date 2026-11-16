// Mezcla un fragmento JSON (argv[1]) dentro de resultados.json
const fs = require('fs');
const base = '/tmp/claude-0/-home-user-socialflow/1e9a5f94-bef0-5866-89ae-8225e269b676/scratchpad/resultados.json';
const cur = JSON.parse(fs.readFileSync(base, 'utf8'));
const add = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
Object.assign(cur, add);
fs.writeFileSync(base, JSON.stringify(cur, null, 1));
console.log('total con referencia:', Object.keys(cur).length);
