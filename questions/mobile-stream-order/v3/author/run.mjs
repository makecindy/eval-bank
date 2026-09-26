import {build} from '../candidate/harness/build.mjs';
import {assess} from './acceptance.mjs';import fs from 'node:fs';import {pathToFileURL} from 'node:url';
const [source,bundle,out]=process.argv.slice(2);await build(source,bundle);
const api=await import(pathToFileURL(bundle));fs.writeFileSync(out,JSON.stringify(await assess(api)));
