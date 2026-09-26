import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import {createDesktop,defaultRoot} from './host.mjs';
const args=process.argv.slice(2);
if(args.includes('--help')){console.log('Usage: ./runtime/node lab/console.mjs [--scene path] [--script path]\nInteractive stdin: one JSON action per line. Types: status, complete/running/error {id}, click {id}, advance {at}, expand, outside, pointer {panel,menuBar}, route {id}, focused {value}, read {id}, reload {readyAt}. Times are virtual milliseconds. Commands logs/quit.\n--script accepts a JSON array of actions. Logs: tests/lab-events.jsonl. Restart console after source edits.');process.exit(0);}
const value=k=>args[args.indexOf(k)+1];
const scene=JSON.parse(fs.readFileSync(args.includes('--scene')?value('--scene'):path.join(defaultRoot,'lab/workspace.json')));
const d=createDesktop({now:scene.now,readyAt:scene.readyAt});
for(const op of scene.events)d.act(op);
const save=()=>fs.writeFileSync(path.join(defaultRoot,'tests/lab-events.jsonl'),d.trace.map(x=>JSON.stringify(x)).join('\n')+'\n');
console.log(JSON.stringify(d.inspect()));save();
const execute=op=>{console.log(JSON.stringify(d.act(op)));save();};
if(args.includes('--script')){for(const op of JSON.parse(fs.readFileSync(value('--script'))))execute(op);}
else {const rl=readline.createInterface({input:process.stdin});for await(const line of rl){if(line==='quit')break;if(line==='logs'){console.log(JSON.stringify(d.trace));continue;}try{execute(JSON.parse(line));}catch(e){console.log(JSON.stringify({error:e.message}));}}}
