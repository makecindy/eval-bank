import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
const sources=JSON.parse(fs.readFileSync(process.argv[3],'utf8'));
const tests=JSON.parse(fs.readFileSync(0,'utf8')).tests;
const results=[];
for(const test of tests){
  const messages=[];let Processor;let operationIndex=-1;
  const ctx=vm.createContext({
    AudioWorkletProcessor:class{constructor(){this.port={postMessage:m=>messages.push({...m,__operation:operationIndex}),onmessage:null};}},
    registerProcessor:(name,C)=>{if(name!=='pcm16k-worklet')throw Error('registration changed');Processor=C;},
    sampleRate:test.rate,currentTime:0,performance:{now:()=>0},
    Date:class extends Date{static now(){return 1000;}},
    window:{clearInterval:()=>{},clearTimeout:()=>{}},console:{log:()=>{},warn:()=>{},error:()=>{}},
  });
  let instance;
  if(test.path==='worklet'){
    vm.runInContext(sources['pcm16k-worklet.js'],ctx,{timeout:1000});
    instance=new Processor();
    if(test.chunkMs!==undefined)instance.port.onmessage({data:{type:'config',targetSampleRate:16000,chunkMs:test.chunkMs,timeOriginMs:0}});
  }else{
    const mods={};
    async function module(name){
      if(mods[name])return mods[name];
      if(!['WebMicAudioEngine.ts','audioContextPool.ts'].includes(name))throw Error('Unknown module');
      const m=new vm.SourceTextModule(stripTypeScriptTypes(sources[name],{mode:'transform'}),{context:ctx,identifier:name,initializeImportMeta:meta=>{meta.env={DEV:false};}});mods[name]=m;
      await m.link(spec=>{if(spec==='./audioContextPool')return module('audioContextPool.ts');throw Error('External import not allowed');});return m;
    }
    const m=await module('WebMicAudioEngine.ts');await m.evaluate({timeout:1000});
    instance=new m.namespace.WebMicAudioEngine({workletUrl:'',...(test.chunkMs===undefined?{}:{chunkMs:test.chunkMs})});
    instance.onPcm16k(m=>messages.push({type:'pcm16k',...m,__operation:operationIndex}));
  }
  for(const op of test.operations){
    operationIndex+=1;
    if(op.type==='input'){
      const a=Float32Array.from(op.samples);
      if(test.path==='worklet')instance.process([[a]]);else instance.handleInputFrame(a,test.rate);
    }else if(op.type==='clearMessages')messages.length=0;
    else if(test.path==='worklet')instance.port.onmessage({data:op});
    else if(op.type==='flush')await instance.drainBufferedAudio();
    else if(op.type==='reset')await instance.stop();
    else throw Error('Unsupported operation');
  }
  results.push(messages.map(m=>m.type==='pcm16k'?{...m,pcm16k:Array.from(new Int16Array(m.pcm16k))}:m));
}
process.stdout.write(JSON.stringify(results));
