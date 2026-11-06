const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

// Exercise the actual browser metadata collector with a minimal document.
const source = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');
const start = source.indexOf('function extractPageMetadata() {');
const end = source.indexOf('// --- Extract site name from URL ---', start);
assert(start >= 0 && end > start);

function collect(blocks) {
  const document = {
    documentElement: { getAttribute: () => 'en' },
    querySelector: () => null,
    querySelectorAll: selector => selector === 'script[type="application/ld+json"]'
      ? blocks.map(textContent => ({ textContent })) : [],
  };
  return vm.runInNewContext(`${source.slice(start, end)}; extractPageMetadata()`, { document });
}

const metadata = collect([
  '{"@type":"WebPage","name":"Example"}',
  '[{"@type":"AudioObject"},{"@type":"Thing","nested":{"name":"kept"}}]',
  '[null, 7, "invalid", [{"@type":"Article"}], false]',
  '{malformed json',
  'null',
]);
assert.deepEqual(JSON.parse(JSON.stringify(metadata.schema_org)), [
  { '@type': 'WebPage', name: 'Example' },
  { '@type': 'AudioObject' },
  { '@type': 'Thing', nested: { name: 'kept' } },
  { '@type': 'Article' },
]);
assert.equal(collect([]).schema_org.length, 0);
console.log('Page metadata JSON-LD tests passed');
