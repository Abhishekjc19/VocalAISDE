const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const metadataPath = path.join(__dirname, 'nhost/metadata');
const inputFile = path.join(metadataPath, 'tables.yaml');

// Read monolithic config v1 format
const content = fs.readFileSync(inputFile, 'utf8');
const doc = yaml.load(content);

// Create required directories
const dbsDir = path.join(metadataPath, 'databases');
const defaultDir = path.join(dbsDir, 'default');
const tablesDir = path.join(defaultDir, 'tables');

fs.mkdirSync(tablesDir, { recursive: true });

// 1. version.yaml
fs.writeFileSync(path.join(metadataPath, 'version.yaml'), 'version: 3\n');

// 2. databases.yaml
const databases = [
  {
    name: 'default',
    kind: 'postgres',
    configuration: doc.sources[0].configuration,
    tables: '!include default/tables/tables.yaml'
  }
];

// Special dump to preserve the !include tag instead of quoting it
let dbYaml = yaml.dump(databases);
dbYaml = dbYaml.replace(/'!include default\/tables\/tables\.yaml'/, '!include default/tables/tables.yaml');
fs.writeFileSync(path.join(dbsDir, 'databases.yaml'), dbYaml);

// 3. tables.yaml
const tables = doc.sources[0].tables;
fs.writeFileSync(path.join(tablesDir, 'tables.yaml'), yaml.dump(tables));

// 4. actions.yaml
if (doc.actions) {
  fs.writeFileSync(path.join(metadataPath, 'actions.yaml'), yaml.dump({
    actions: doc.actions,
    custom_types: doc.custom_types
  }));
}

// 5. Cleanup the old monolithic file
fs.unlinkSync(inputFile);

console.log('Successfully upgraded metadata to config v3 structure!');
