import fs from 'node:fs/promises';
import path from 'node:path';
import {fetchRemoteFileToCache} from '../src/cache/remote-file-cache.ts';
import {createHtmlPreview,copyPreviewFile} from '../src/preview/html-preview.ts';
import {createFileReadQueue} from '../src/transport/fileAccess.ts';
import {activeOwnerScopeKey} from './platform.ts';
export function createWorkspace(endpointId, directory){
 const base=path.resolve(directory);const queue=createFileReadQueue();
 const locate=rel=>{const p=path.resolve(base,rel);if(!p.startsWith(base+path.sep)||rel.includes('\\'))throw Error('OUTSIDE_WORKDIR');return p};
 const stat=async(_root,rel)=>{const s=await fs.lstat(locate(rel));return {relPath:rel,type:s.isFile()?'file':s.isDirectory()?'directory':'link',size:s.size,mtimeMs:s.mtimeMs}};
 const read=async(_root,entry,signal)=>fetchRemoteFileToCache({scope:activeOwnerScopeKey(),transport:'device',endpointId,workdir:'/workspace',relPath:entry.relPath,size:entry.size,mtimeMs:entry.mtimeMs},async(dest,progress,sharedSignal)=>queue(endpointId,async()=>{if(sharedSignal?.aborted)throw Error('FILE_PEER_CANCELLED');await fs.copyFile(locate(entry.relPath),dest);progress(entry.size,entry.size)},sharedSignal),()=>{},signal);
 return {async list(rel=''){const p=rel?locate(rel):base;return fs.readdir(p,{withFileTypes:true}).then(items=>items.map(i=>({name:i.name,type:i.isDirectory()?'directory':'file'})))},async read(rel,signal){return read(base,await stat(base,rel),signal)},async preview(rel){return createHtmlPreview({origin:{kind:'device',deviceId:endpointId},workdir:base,absPath:locate(rel)},{stat,read,materialize:async(from,to,size)=>{await copyPreviewFile(from,to,size);return to}})}};
}
