import path from 'node:path';
let owner='demo-owner';let generation=1;
export const app={getPath(name:string){if(name!=='userData')throw Error('unsupported platform path');return path.resolve(process.env.PROJECT_DATA_DIR ?? '.local-data')}};
export function activeOwnerScopeKey(){return `${owner}:${generation}`}
export function dataOwnerStorageKey(id:string){return Buffer.from(id).toString('hex')}
export function selectOwner(id:string){owner=id;generation++}
export function createLogger(_name:string){return {debug(..._args:unknown[]){},info(..._args:unknown[]){},warn(..._args:unknown[]){}}}
