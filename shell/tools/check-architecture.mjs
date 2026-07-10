import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SRC_DIR = path.join(ROOT, 'src');
const EMULATOR_DIR = path.join(SRC_DIR, 'emulator');

const TSX_EXT = '.tsx';
const importOrExportRe = /(import|export)\s+(?:type\s+)?(?:[\s\S]*?)from\s+['\"]([^'\"]+)['\"]/g;

const violations = [];

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      walk(full);
      continue;
    }
    if (!entry.isFile()) continue;
    if (full.endsWith('.ts') || full.endsWith('.tsx')) {
      checkFile(full);
    }
  }
}

function normalizeImport(spec) {
  return spec.replace(/\\/g, '/');
}

function isInDir(filePath, dirPath) {
  const rel = path.relative(dirPath, filePath);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function importsDomain(spec, domain) {
  const s = normalizeImport(spec);
  return (
    s === `../${domain}` ||
    s.startsWith(`../${domain}/`) ||
    s === `./${domain}` ||
    s.startsWith(`./${domain}/`)
  );
}

function isForbiddenTsxEmulatorImport(spec) {
  const s = normalizeImport(spec);
  if (!s.startsWith('./emulator') && !s.startsWith('../emulator')) return false;

  // Allow only the high-level facade entrypoint.
  if (s === './emulator' || s === '../emulator') return false;

  // Everything else under emulator internals is forbidden from TSX.
  return true;
}

function isDeepEmulatorImport(spec) {
  const s = normalizeImport(spec);
  if (!s.startsWith('./emulator') && !s.startsWith('../emulator')) return false;
  return s !== './emulator' && s !== '../emulator';
}

function checkFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const isTsx = filePath.endsWith(TSX_EXT);
  const inEmulator = isInDir(filePath, EMULATOR_DIR);
  const inCore = isInDir(filePath, path.join(EMULATOR_DIR, 'core'));
  const inAudio = isInDir(filePath, path.join(EMULATOR_DIR, 'audio'));
  const inGraphics = isInDir(filePath, path.join(EMULATOR_DIR, 'graphics'));

  let match;
  while ((match = importOrExportRe.exec(content)) !== null) {
    const spec = match[2];
    const line = content.slice(0, match.index).split('\n').length;

    if (isTsx && isForbiddenTsxEmulatorImport(spec)) {
      violations.push({
        file: path.relative(ROOT, filePath).replace(/\\/g, '/'),
        line,
        spec,
        reason: 'TSX files must import emulator only via facade entrypoint',
      });
    }

    if (!inEmulator && isDeepEmulatorImport(spec)) {
      violations.push({
        file: path.relative(ROOT, filePath).replace(/\\/g, '/'),
        line,
        spec,
        reason: 'app-level source must import emulator only via facade entrypoint',
      });
    }

    if (inCore && (importsDomain(spec, 'audio') || importsDomain(spec, 'graphics'))) {
      violations.push({
        file: path.relative(ROOT, filePath).replace(/\\/g, '/'),
        line,
        spec,
        reason: 'core cannot import audio or graphics implementations',
      });
    }

    if (inAudio && (importsDomain(spec, 'core') || importsDomain(spec, 'graphics'))) {
      violations.push({
        file: path.relative(ROOT, filePath).replace(/\\/g, '/'),
        line,
        spec,
        reason: 'audio cannot import core or graphics',
      });
    }

    if (inGraphics && (importsDomain(spec, 'core') || importsDomain(spec, 'audio'))) {
      violations.push({
        file: path.relative(ROOT, filePath).replace(/\\/g, '/'),
        line,
        spec,
        reason: 'graphics cannot import core or audio',
      });
    }
  }
}

walk(SRC_DIR);

if (violations.length > 0) {
  console.error('Architecture boundary violations found:');
  for (const v of violations) {
    console.error(`- ${v.file}:${v.line} imports "${v.spec}" (${v.reason})`);
  }
  console.error('\nLayering constraints:');
  console.error('- TSX must import emulator only from ./emulator facade.');
  console.error('- Non-emulator app source must not use deep emulator imports.');
  console.error('- core must not import audio/graphics implementations.');
  console.error('- audio must not import core/graphics.');
  console.error('- graphics must not import core/audio.');
  process.exit(1);
}

console.log('Architecture boundary check passed.');
