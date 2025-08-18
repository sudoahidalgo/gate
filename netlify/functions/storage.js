const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..', '..');
const DATA_DIR = process.env.DATA_DIR || '/tmp';

function ensureFile(name, defaultContent = '[]') {
  const dataFile = path.join(DATA_DIR, name);
  if (!fs.existsSync(dataFile)) {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const source = path.join(ROOT_DIR, name);
      const data = fs.existsSync(source) ? fs.readFileSync(source, 'utf8') : defaultContent;
      fs.writeFileSync(dataFile, data);
    } catch (err) {
      console.error('Error ensuring data file', name, err);
    }
  }
  return dataFile;
}

function loadJson(name) {
  const file = ensureFile(name);
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return [];
  }
}

function saveJson(name, data) {
  const file = ensureFile(name);
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

module.exports = {
  loadCodes: () => loadJson('codes.json'),
  saveCodes: (codes) => saveJson('codes.json', codes),
  loadLogs: () => loadJson('logs.json'),
  appendLog: (pin, user) => {
    const logs = loadJson('logs.json');
    logs.push({ timestamp: new Date().toISOString(), pin, user });
    saveJson('logs.json', logs);
  }
};
