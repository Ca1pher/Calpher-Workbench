import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const appSource = await readFile(new URL('../static/app.js', import.meta.url), 'utf8');
const htmlSource = await readFile(new URL('../static/index.html', import.meta.url), 'utf8');
const cssSource = await readFile(new URL('../design-system/styles.css', import.meta.url), 'utf8');

test('preloaded embed frames stay mounted in the visible frame host', () => {
  assert.match(appSource, /function mountFrame\(frame\)/);
  assert.match(appSource, /frame\.parentElement !== frameHost\(\)/);
  assert.doesNotMatch(appSource, /moveFrameToPool|embedPreloadPool/);
  assert.doesNotMatch(htmlSource, /id="embedPreloadPool"/);
});

test('embed switching changes visibility without moving mounted frames', () => {
  assert.match(appSource, /classList\.toggle\('is-active', item === frame\)/);
  assert.match(cssSource, /\.embed-iframe\.is-active\s*\{/);
  assert.match(cssSource, /\.embed-iframe\s*\{[^}]*visibility:\s*hidden/);
});

test('reactivating a preloaded frame refreshes business data without reloading it', () => {
  assert.match(appSource, /function requestFrameDataRefresh\(frame, target, entry\)/);
  assert.match(appSource, /type:\s*'refresh'/);
  assert.match(appSource, /reason:\s*'activate'/);
  assert.match(appSource, /if \(preload\) preload\.refreshRequested = true/);
  assert.match(appSource, /if \(entry\?\.refreshRequested\) requestFrameDataRefresh\(frame, app, entry\)/);
  assert.doesNotMatch(appSource, /contentWindow\.location\.reload|frame\.contentWindow\.location/);
});
