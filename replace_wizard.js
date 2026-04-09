const fs = require('fs');
const path = './src/pages/ClassIdCardsWizard.jsx';
let content = fs.readFileSync(path, 'utf8');

// 1. Add basePath prop
content = content.replace('export default function ClassIdCardsWizard() {', 'export default function ClassIdCardsWizard({ basePath = \'/class-id-cards\' }) {');

// 2. Replace backtick strings with template var
// Examples: `/class-id-cards/school/...` => `${basePath}/school/...`
content = content.replace(/`\/class-id-cards\//g, '`${basePath}/');

// 3. Replace single quote strings
// Example: '/class-id-cards' => basePath
content = content.replace(/'\/class-id-cards'/g, 'basePath');

// 4. Replace double quote props
// Example: backTo="/class-id-cards" => backTo={basePath}
content = content.replace(/backTo="\/class-id-cards"/g, 'backTo={basePath}');

// Clean up any double slash `//` might have been created
content = content.replace(/\$\{basePath\}\/\//g, '${basePath}/');

fs.writeFileSync(path, content, 'utf8');
console.log('done');
