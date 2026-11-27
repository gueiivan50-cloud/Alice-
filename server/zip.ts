import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[i] = c >>> 0;
}

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const EXCLUDED_TOP_DIRS = new Set([
  'node_modules',
  'dist',
  'data',
  'storage',
  '.git',
  '.aistudio',
  'build',
  'coverage',
]);

function collectSourceFiles(rootDir: string, relDir = ''): Array<{ relPath: string; fullPath: string }> {
  const currentDir = relDir ? path.join(rootDir, relDir) : rootDir;
  const entries = fs.readdirSync(currentDir, { withFileTypes: true });
  const results: Array<{ relPath: string; fullPath: string }> = [];

  for (const entry of entries) {
    if (entry.name.startsWith('.env') && entry.name !== '.env.example') {
      continue;
    }
    if (!relDir && EXCLUDED_TOP_DIRS.has(entry.name)) {
      continue;
    }
    if (entry.name === '.DS_Store' || entry.name.endsWith('.log')) {
      continue;
    }

    const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;
    const fullPath = path.join(currentDir, entry.name);

    if (entry.isDirectory()) {
      results.push(...collectSourceFiles(rootDir, relPath));
    } else if (entry.isFile()) {
      results.push({ relPath, fullPath });
    }
  }
  return results;
}

export function buildSourceCodeZip(rootDir: string): Buffer {
  const files = collectSourceFiles(rootDir);
  const localChunks: Buffer[] = [];
  const centralChunks: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const raw = fs.readFileSync(file.fullPath);
    const compressed = zlib.deflateRawSync(raw);
    const useStore = compressed.length >= raw.length;
    const payload = useStore ? raw : compressed;
    const method = useStore ? 0 : 8;
    const crc = crc32(raw);
    const nameBuf = Buffer.from(file.relPath.replace(/\\/g, '/'), 'utf8');

    // Local File Header (30 bytes + filename)
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4); // version needed
    localHeader.writeUInt16LE(0x0800, 6); // UTF-8 flag
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(payload.length, 18);
    localHeader.writeUInt32LE(raw.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localChunks.push(localHeader, nameBuf, payload);

    // Central Directory Header (46 bytes + filename)
    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(payload.length, 20);
    centralHeader.writeUInt32LE(raw.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralChunks.push(centralHeader, nameBuf);
    offset += localHeader.length + nameBuf.length + payload.length;
  }

  const centralDirSize = centralChunks.reduce((sum, b) => sum + b.length, 0);

  // End of Central Directory (22 bytes)
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralDirSize, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localChunks, ...centralChunks, eocd]);
}
