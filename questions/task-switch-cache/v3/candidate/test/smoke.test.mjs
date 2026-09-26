import test from 'node:test';import assert from 'node:assert/strict';import * as m from '../src/entry.js';
test('ordinary result',()=>{assert.equal(m.extractGhostCardId('normal text'),null);assert.deepEqual(m.extractToolResultMedia('normal text'),[])});
test('media protocol',()=>{assert.equal(m.extractToolResultMedia('{"xdt_image_url":"cindy-media://a.png"}')[0].url,'cindy-media://a.png')});
test('history projection',()=>{const row={clientId:'a',role:'assistant',content:'hello'};assert.equal(m.buildCachedRenderItems([row]).items[0].message.content,'hello')});
test('owner API',()=>{m.setDataOwnerGeneration('smoke',1);assert.deepEqual(m.getDataOwnerGeneration(),{dataOwnerId:'smoke',generation:1})});
