import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile, readFile, mkdtemp, realpath, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, basename, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { startServer } from './server.mjs';
import { createLanes, RHYTHM_PRESETS } from './patterns.mjs';
import { normalizeReferenceConfig, referenceStepDuration, createReferencePlayer } from './audio.mjs';
const delay = ms => new Promise(ok=>setTimeout(ok,ms));
const resultDir=resolve('test-results');await mkdir(resultDir,{recursive:true});
const server=await startServer(0),origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({channel:'msedge',headless:true,args:['--mute-audio']});
const report={generatedAt:new Date().toISOString(),scope:'VIS-05 r1 standalone reference; interaction, computed layout and native PCM observation. No product acceptance or physical sound/latency claim.',browser:browser.version(),origin,checks:[]};
const checks=[];
const check=(name,run)=>checks.push({name,run});
async function observe(context) {
  await context.addInitScript(()=>{
    const Original=window.AudioContext;window.__referenceContexts=[];window.__referenceAnalysers=[];
    window.AudioContext=new Proxy(Original,{construct(target,args){const context=Reflect.construct(target,args);window.__referenceContexts.push(context);return context;}});
    const connect=AudioNode.prototype.connect;
    AudioNode.prototype.connect=function(destination,...args){
      if(destination===this.context.destination){const analyser=this.context.createAnalyser();analyser.fftSize=2048;connect.call(this,analyser);window.__referenceAnalysers.push(analyser);}
      return connect.call(this,destination,...args);
    };
    window.__referencePCM=async(milliseconds=550)=>{
      let peak=0,sum=0,samples=0;const end=performance.now()+milliseconds;
      while(performance.now()<end){for(const analyser of window.__referenceAnalysers){const data=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(data);for(const v of data){peak=Math.max(peak,Math.abs(v));sum+=v*v;samples++;}}await new Promise(ok=>setTimeout(ok,16));}
      return {peak,rms:samples?Math.sqrt(sum/samples):0,samples};
    };
  });
  await context.route('**/*',route=>{const url=new URL(route.request().url());return ['127.0.0.1','localhost'].includes(url.hostname)?route.continue():route.abort();});
}
async function pageCase(run) {
  const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});await observe(context);const page=await context.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  try{await page.goto(origin);await page.locator('#beats .beat').first().waitFor();const result=await run(page,context);assert.deepEqual(errors,[]);return result;}
  finally{await context.close();}
}
async function range(page,selector,value) {await page.locator(selector).evaluate((node,value)=>{node.value=String(value);node.dispatchEvent(new Event('input',{bubbles:true}));},value);}
const pcm=page=>page.evaluate(()=>window.__referencePCM());
async function rhythm(page){await page.locator('#tab-rhythm').click();}
const step=(page,lane,i)=>page.locator(`[data-lane="${lane}"] [data-step="${i}"]`);

check('pure-patterns-grid-swing-duration-and-lazy-audio',async()=>{
  for(const preset of RHYTHM_PRESETS)for(const bars of [1,2,4]){const lanes=createLanes(preset.id,bars);assert.ok(lanes.length>=4);for(const lane of lanes)assert.equal(lane.steps.length,bars*16);const other=createLanes(preset.id,bars);lanes[0].steps[0]=99;assert.notEqual(other[0].steps[0],99);}
  const timings=[];
  for(const swing of [50,54,66,70]){const config=normalizeReferenceConfig({mode:'rhythm',bpm:120,swing,lanes:createLanes('rock')});const duration=Array.from({length:16},(_,i)=>referenceStepDuration(config,i)).reduce((a,b)=>a+b);assert.ok(Math.abs(duration-2)<1e-12);timings.push({swing,seconds:duration});}
  for(const denominator of [4,8])for(const division of [1,2,3,4]){const config=normalizeReferenceConfig({bpm:120,beats:3,denominator,division,accents:[2,1,1]});const seconds=Array.from({length:3*division},(_,i)=>referenceStepDuration(config,i)).reduce((a,b)=>a+b);assert.ok(Math.abs(seconds-1.5*4/denominator)<1e-12);}
  const old=globalThis.AudioContext;let contexts=0;globalThis.AudioContext=class{constructor(){contexts++;}};try{const player=createReferencePlayer();player.configure({bpm:100});player.stop();player.dispose();assert.equal(contexts,0);}finally{globalThis.AudioContext=old;}
  return {presets:RHYTHM_PRESETS.length,lengths:[1,2,4],timings,lazyContexts:contexts};
});
check('metronome-controls-tempo-meter-accents-subdivision-and-six-real-sound-previews',()=>pageCase(async page=>{
  assert.equal(await page.evaluate(()=>window.__referenceContexts.length),0);
  await page.locator('#bpm').fill('120');assert.equal(await page.locator('#bpm-range').inputValue(),'120');
  await page.locator('#meter').selectOption('6/8');assert.equal(await page.locator('#beats .beat').count(),6);
  const beat=page.locator('#beats .beat').first();await beat.click();assert.equal(await page.locator('#beats .beat').first().getAttribute('data-level'),'0');
  await page.locator('[data-division="3"]').click();assert.equal(await page.locator('[data-division="3"]').getAttribute('aria-pressed'),'true');
  const signals=[];
  for(const kit of ['wood','classic','electronic','bell','clave','drum']){await page.locator(`[data-kit="${kit}"]`).click();await page.locator('#preview-kit').click();const signal=await pcm(page);assert.ok(signal.peak>1e-4,JSON.stringify({kit,signal}));signals.push({kit,...signal});}
  await page.locator('#stop').click();await delay(160);assert.ok((await pcm(page)).peak<1e-6);
  return {initialContexts:0,soundPreviews:signals,contexts:await page.evaluate(()=>window.__referenceContexts.length)};
}));
check('native-metronome-live-stop-invalid-context-and-training-pulse',()=>pageCase(async page=>{
  await page.locator('#bpm').fill('240');await page.locator('#start').click();assert.ok((await pcm(page)).peak>.001);
  await page.locator('#bpm').fill('0');assert.equal(await page.locator('#start').isDisabled(),true);await delay(150);assert.ok((await pcm(page)).peak<1e-6);
  await page.locator('#bpm').fill('240');await page.locator('.training-panel').evaluate(el=>el.open=true);await page.locator('#sound-bars').fill('1');await page.locator('#silent-bars').fill('1');await page.locator('#silent-enabled').check();await page.locator('#start').click();
  await page.waitForFunction(()=>document.querySelector('#position').textContent.includes('Тихий такт'));const silent=await page.evaluate(()=>window.__referencePCM(180));assert.ok(silent.peak<1e-6,JSON.stringify(silent));
  await page.locator('#stop').click();await page.locator('#sound-bars').fill('0');await page.locator('#start').click();assert.equal(await page.locator('#start').getAttribute('aria-pressed'),'false');
  return {nativeSignal:true,invalidTempoStops:true,invalidTrainingCannotStartOldContext:true,silent};
}));
check('channel-rack-steps-velocity-accent-global-mix-and-pattern-independence',()=>pageCase(async page=>{
  await rhythm(page);assert.equal(await page.locator('.rack-row').count(),4);const original=await step(page,'kick',1).getAttribute('aria-pressed');assert.equal(original,'false');
  await step(page,'kick',1).click();assert.equal(await step(page,'kick',1).getAttribute('aria-pressed'),'true');assert.equal(await step(page,'kick',1).evaluate(el=>el===document.activeElement),true);
  await page.locator('#accent-step').click();assert.equal(await step(page,'kick',1).getAttribute('class').then(v=>v.includes('accent')),true);
  await range(page,'#velocity input[aria-label="Сила удара Бочка, шаг 2"]',.32);assert.match(await step(page,'kick',1).getAttribute('aria-label'),/удар$/);
  const kick=page.locator('[data-lane=kick]');await kick.getByRole('checkbox').uncheck();await page.locator('[data-pattern=B]').click();assert.equal(await step(page,'kick',1).getAttribute('aria-pressed'),'false');assert.equal(await page.locator('[data-lane=kick]').getByRole('checkbox').isChecked(),false);
  await page.locator('[data-pattern=A]').click();assert.equal(await step(page,'kick',1).getAttribute('aria-pressed'),'true');await page.locator('#duplicate-pattern').click();assert.equal(await page.locator('.pattern-tab').count(),4);assert.equal(await step(page,'kick',1).getAttribute('aria-pressed'),'true');
  await page.locator('#new-sound').selectOption('shaker');await page.locator('#add-lane').click();assert.equal(await page.locator('.rack-row').count(),5);
  return {stepToggle:true,keyboardFocus:true,velocity:.32,globalChannelMute:true,independentPatterns:true,duplicate:true,addInstrument:true};
}));
check('pattern-bars-copy-paste-clear-and-preset-library',()=>pageCase(async page=>{
  await rhythm(page);await page.locator('#bars').selectOption('2');await page.locator('#copy-bar').click();await page.locator('#bar-tabs').getByRole('button',{name:'Такт 2',exact:true}).click();await page.locator('#clear-bar').click();assert.equal(await page.locator('#rack .step.on').count(),0);await page.locator('#copy-bar').click();assert.ok(await page.locator('#rack .step.on').count()>0);
  const results=[];for(const preset of RHYTHM_PRESETS){await page.locator(`[data-preset="${preset.id}"]`).click();const hits=await page.locator('#rack .step.on').count();assert.ok(preset.id==='blank'?hits===0:hits>0);results.push({id:preset.id,hits});}
  return {copyPaste:true,clear:true,presets:results};
}));
check('real-rhythm-PCM-channel-mute-solo-and-compiled-chain-clips',()=>pageCase(async page=>{
  await rhythm(page);await page.locator('#bpm').fill('240');await page.locator('#start').click();const full=await pcm(page);assert.ok(full.peak>.001);
  for(const checkbox of await page.locator('.lane-controls input[type=checkbox]').all())await checkbox.uncheck();await delay(150);const muted=await pcm(page);assert.ok(muted.peak<1e-6,JSON.stringify(muted));
  await page.locator('[data-lane=kick]').getByRole('checkbox').check();await page.locator('[data-lane=kick] .solo').click();assert.ok((await pcm(page)).peak>.001);
  await page.locator('[data-scope=chain]').click();await page.locator('#chain select').first().selectOption('2');await page.locator('#start').click();await page.waitForFunction(()=>document.querySelector('#chain .clip').classList.contains('playing'));await delay(1100);assert.ok(await page.locator('#chain .clip.playing').count()===1);
  await page.locator('#stop').click();await delay(150);assert.ok((await pcm(page)).peak<1e-6);
  return {full,allMuted:muted,independentKick:true,chainClips:8,nativePCM:true};
}));
check('save-custom-variant-reload-and-restore-steps-velocity-and-mixer-in-reference-origin',()=>pageCase(async page=>{
  await rhythm(page);await page.locator('#pattern-name').fill('Мой тестовый грув');await step(page,'kick',1).click();await range(page,'[data-lane=kick] .lane-volume',.3);await page.locator('#save-pattern').click();assert.equal(await page.locator('#saved-count').textContent(),'1');await page.reload();await rhythm(page);assert.equal(await step(page,'kick',1).getAttribute('aria-pressed'),'false');await page.locator('#saved-patterns button').first().click();assert.equal(await step(page,'kick',1).getAttribute('aria-pressed'),'true');assert.equal(await page.locator('[data-lane=kick] .lane-volume').inputValue(),'0.3');
  const result=await page.evaluate(()=>({origin:location.origin,keys:Object.keys(localStorage),databases:typeof indexedDB.databases==='function'?indexedDB.databases():[]}));assert.notEqual(new URL(result.origin).port,'4173');return {sourceFileNotRequired:true,localOnly:true,restoredVolume:.3};
}));
check('computed-light-dark-layout-five-viewports-local-rack-scroll-and-fixed-transport',()=>pageCase(async page=>{
  const layouts=[];
  for(const theme of ['light','dark'])for(const [width,height] of [[1440,1000],[1366,768],[1024,768],[736,900],[520,900]]) {
    await page.setViewportSize({width,height});await page.locator(`button[data-theme=${theme}]`).click();
    for(const view of ['metronome','rhythm']){await page.locator(`#tab-${view}`).click();await delay(50);const layout=await page.evaluate(()=>({width:innerWidth,bodyWidth:document.documentElement.scrollWidth,transport:document.querySelector('.transport').getBoundingClientRect().toJSON(),bg:getComputedStyle(document.body).backgroundColor,text:getComputedStyle(document.documentElement).color}));assert.ok(layout.bodyWidth<=width+1,JSON.stringify({theme,view,...layout}));layouts.push({theme,view,width,height,bodyWidth:layout.bodyWidth});}
  }
  await page.setViewportSize({width:1440,height:1000});await page.locator('#tab-rhythm').click();await page.locator('.app-content').evaluate(el=>el.scrollTop=700);await delay(60);const rect=await page.locator('#start').boundingBox();assert.ok(rect.y>=24&&rect.y+rect.height<1000,JSON.stringify(rect));
  const screenshots=[];
  for(const [view,theme,name] of [['metronome','light','metronome-light'],['rhythm','light','constructor-light'],['rhythm','dark','constructor-dark']]){const height=view==='rhythm'?1220:1000;await page.setViewportSize({width:1440,height});await page.locator(`#tab-${view}`).click();await page.locator(`button[data-theme=${theme}]`).click();await page.locator('.app-content').evaluate(el=>el.scrollTop=0);await delay(80);await page.screenshot({path:join(resultDir,`rhythm-r1-${name}.png`)});screenshots.push({file:`rhythm-r1-${name}.png`,width:1440,height});}
  return {layouts,stickyStart:rect,screenshots};
}));
check('native-edge-CDP-real-hidden-tab-stops-and-return-needs-explicit-start',async()=>{
  const edge=[join(process.env['PROGRAMFILES(X86)']||'C:/Program Files (x86)','Microsoft/Edge/Application/msedge.exe'),join(process.env.PROGRAMFILES||'C:/Program Files','Microsoft/Edge/Application/msedge.exe')].find(existsSync);assert.ok(edge);
  const profile=await mkdtemp(join(tmpdir(),'bass-rhythm-reference-'));let native,nativeProcess;
  try {
    nativeProcess=spawn(edge,['--headless=new','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--mute-audio','about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
    const endpoint=await new Promise((ok,fail)=>{const timeout=setTimeout(()=>fail(new Error('CDP startup timed out')),15000);let output='';nativeProcess.stderr.on('data',chunk=>{output+=chunk;const found=output.match(/DevTools listening on (ws:\/\/\S+)/);if(found){clearTimeout(timeout);ok(found[1]);}});nativeProcess.once('error',e=>{clearTimeout(timeout);fail(e);});});
    native=await chromium.connectOverCDP(endpoint,{noDefaults:true});const context=native.contexts()[0];await observe(context);const page=await context.newPage();await page.goto(origin);await page.bringToFront();await page.locator('#bpm').fill('240');await page.locator('#start').click();assert.ok((await pcm(page)).peak>.001);
    const second=await context.newPage();await second.goto(`${origin}/theme.css`);await second.bringToFront();await page.waitForFunction(()=>document.hidden);await page.waitForFunction(()=>document.querySelector('#start').getAttribute('aria-pressed')==='false');await page.bringToFront();await page.waitForFunction(()=>!document.hidden);assert.equal(await page.locator('#start').getAttribute('aria-pressed'),'false');assert.ok((await pcm(page)).peak<1e-6);return {realDocumentHidden:true,noAutomaticResume:true};
  } finally {
    if(native){try{await(await native.newBrowserCDPSession()).send('Browser.close');}catch{}await native.close();}
    if(nativeProcess&&nativeProcess.exitCode===null){nativeProcess.kill();await delay(300);}
    const absolute=await realpath(profile),parent=await realpath(tmpdir());assert.equal(dirname(absolute),parent);assert.ok(basename(absolute).startsWith('bass-rhythm-reference-'));await rm(absolute,{recursive:true,force:true,maxRetries:8,retryDelay:250});
  }
});

const only=process.argv.find(s=>s.startsWith('--case='))?.slice(7);
try {
  for(const {name,run} of checks.filter(c=>!only||c.name.includes(only))) {
    const start=performance.now();try{const evidence=await run();report.checks.push({name,status:'passed',durationMs:Math.round(performance.now()-start),evidence});console.log(`PASS ${name}`);}catch(error){report.checks.push({name,status:'failed',error:error.stack});console.error(`FAIL ${name}: ${error.stack}`);}
  }
} finally {
  await browser.close();await new Promise(ok=>server.close(ok));report.passed=report.checks.filter(c=>c.status==='passed').length;report.failed=report.checks.filter(c=>c.status==='failed').length;report.completedAt=new Date().toISOString();
  report.sources=[];for(const name of ['index.html','style.css','app.mjs','audio.mjs','patterns.mjs','server.mjs','check.mjs']){const path=`experiments/rhythm-reference/${name}`;report.sources.push({path,sha256:createHash('sha256').update(await readFile(path)).digest('hex')});}
  const output=join(resultDir,only?'rhythm-r1-case.json':'rhythm-r1.json');await writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(`${report.passed} passed, ${report.failed} failed: ${output}`);if(report.failed)process.exitCode=1;
}
