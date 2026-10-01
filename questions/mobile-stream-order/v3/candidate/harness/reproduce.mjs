import {build} from './build.mjs';import {pathToFileURL} from 'node:url';
const api=await import(pathToFileURL(await build()));
const rows=[{clientId:'u',id:'u',sessionId:'example',role:'user',content:'Hello',createdAt:'2026-01-01T00:00:01Z'}, {clientId:'a',id:'a',sessionId:'example',role:'assistant',content:'Welcome',createdAt:'2026-01-01T00:00:02Z'}];
console.log(JSON.stringify(api.buildMobileMessageRenderItems(rows),null,2));
