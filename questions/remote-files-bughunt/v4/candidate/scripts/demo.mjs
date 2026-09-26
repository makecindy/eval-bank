import {createWorkspace} from '../runtime/workspace.mjs';
const workspace=createWorkspace('demo-device','fixtures/site');
console.log('Files:',await workspace.list());const preview=await workspace.preview('index.html');
console.log('Open:',preview.url);console.log('Press Ctrl+C to stop.');
const keepAlive=setInterval(()=>{},1000);process.once('SIGINT',async()=>{clearInterval(keepAlive);await preview.close()});
