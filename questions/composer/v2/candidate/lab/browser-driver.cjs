const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('../runtime/node_modules/playwright-core');
exports.create=async function(bundle){
 const root=path.resolve(__dirname,'..');
 const server=http.createServer((req,res)=>{
  if(req.url==='/module.js'){res.setHeader('Content-Type','text/javascript');res.end(fs.readFileSync(bundle));}
  else if(req.url==='/host.js'){res.setHeader('Content-Type','text/javascript');res.end(fs.readFileSync(path.join(__dirname,'browser-host.js')));}
  else if(req.url==='/'){res.end('<!doctype html><meta charset="utf-8"><style>body{font-family:sans-serif;margin:24px}.tiptap{min-height:70px;border:1px solid #888;padding:8px}button{min-height:24px}svg{max-width:24px;max-height:24px}</style><div id="root"></div><input id="other-input" aria-label="Other input"><script src="/module.js"></script><script src="/host.js"></script>');}
  else {res.statusCode=404;res.end();}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const origin='http://127.0.0.1:'+server.address().port;
 let browser;
 try{
  browser=await chromium.launch({headless:true,executablePath:path.join(root,'runtime/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell')});
  const page=await browser.newPage({viewport:{width:1100,height:800}}),errors=[];
  page.on('pageerror',e=>errors.push(String(e)));
  await page.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
  await page.goto(origin);await page.evaluate(async()=>{window.h=await window.createLab()});
  const run=async a=>{let result;if(a.type==='buttonClick'){await page.getByRole('button',{name:'Send message',exact:true}).click();await page.waitForTimeout(80);result=await page.evaluate(()=>h.snapshot());}
   else if(a.type==='keyboardType'){await page.keyboard.type(a.text);await page.waitForTimeout(30);result=await page.evaluate(()=>h.snapshot());}
   else if(a.type==='editorClick'){await page.locator('.tiptap').click();result=await page.evaluate(()=>h.snapshot());}
   else result=await page.evaluate(a=>h.run(a),a);
   if(errors.length)throw Error('ENVIRONMENT_UNSUPPORTED '+errors.join('\n'));return result;};
  return {page,run,errors,version:browser.version(),close:async()=>{await browser.close();await new Promise(r=>server.close(r));}};
 }catch(e){if(browser)await browser.close();await new Promise(r=>server.close(r));throw e;}
};
