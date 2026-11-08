import { createReferencePlayer } from './audio.mjs';
import { RHYTHM_PRESETS, SOUND_LABELS, createLanes } from './patterns.mjs';

const $ = id => document.getElementById(id);
const clone = value => JSON.parse(JSON.stringify(value));
const letters = 'ABCDEFGH';
const STORAGE = 'bass-study-rhythm-reference-r1';
const kits = [
  ['wood','◦','Дерево','Мягкий короткий щелчок'], ['classic','⌁','Классический','Чёткий механический пульс'],
  ['electronic','∿','Электронный','Чистый короткий тон'], ['bell','♧','Колокольчик','Светлый звонкий акцент'],
  ['clave','Ⅱ','Клавес','Сухой деревянный удар'], ['drum','●','Ударные','Бочка и малый'],
];
let mode = 'metronome', scope = 'pattern', bpm = 92, meter = '4/4', division = 1, kit = 'wood';
let accents = [2,1,1,1], playing = false, validTempo = true, selectedBar = 0, selectedStep = 0, selectedLane = 'kick';
let swing = 50, rhythmSwing = 50, active = 0, lastTick = null, taps = [], copiedBar = null, sequence = [0,0,0,1,0,0,1,2];
let channels = createLanes('rock').map(({steps, ...channel}) => channel);
let patterns = [];
let saved = [];
const status = message => $('status').textContent = message;
const current = () => patterns[active];
function seedPattern(id, name, preset = 'rock') {
  const lanes = createLanes(preset).map(lane => ({...lane, velocities: lane.steps.map(s => s === 2 ? 1 : s ? .72 : 0)}));
  return {id, name, bars:1, swing:50, lanes, preset, dirty:false};
}
patterns = [seedPattern('A','Основной грув'), seedPattern('B','Вариация'), seedPattern('C','Сбивка')];
patterns[1].lanes[0].steps[14] = 1; patterns[1].lanes[0].velocities[14] = .72;
patterns[2].lanes[1].steps.splice(12,4,2,1,1,2); patterns[2].lanes[1].velocities.splice(12,4,1,.55,.72,1);

function ensureChannels() {
  for (const pattern of patterns) {
    for (const lane of pattern.lanes) if (!channels.some(c => c.id === lane.id)) {
      const {steps,velocities,...channel} = lane; channels.push(channel);
    }
  }
  for (const pattern of patterns) for (const channel of channels) if (!pattern.lanes.some(l=>l.id===channel.id)) {
    pattern.lanes.push({...channel,steps:Array(pattern.bars*16).fill(0),velocities:Array(pattern.bars*16).fill(0)});
  }
}
function laneOf(id) { return current().lanes.find(lane => lane.id === id); }
function displayName(value) { return typeof value === 'string' ? value.slice(0,50) : 'Свой рисунок'; }
function config() {
  const [beats, denominator] = mode === 'rhythm' ? [4,4] : meter.split('/').map(Number);
  const order = mode === 'rhythm' && scope === 'chain' ? sequence.map(i=>patterns[i]) : [current()];
  const bars = order.reduce((n,p)=>n+p.bars,0);
  const lanes = channels.map(channel => ({...channel,
    steps:order.flatMap(pattern=>pattern.lanes.find(l=>l.id===channel.id).steps),
    velocities:order.flatMap(pattern=>pattern.lanes.find(l=>l.id===channel.id).velocities),
  }));
  return {mode,bpm,beats,denominator,division,swing:mode==='rhythm'?rhythmSwing:swing,kit,
    accents:mode==='rhythm'?[2,1,1,1]:accents,master:Number($('master').value),
    clickVolume:Number($('click-volume').value),subdivisionVolume:Number($('sub-volume').value),bars,lanes,
    rhythmClick:$('rhythm-click').checked,training:{
      silentEnabled:mode==='metronome'&&$('silent-enabled').checked,soundBars:Number($('sound-bars').value),silentBars:Number($('silent-bars').value),
      rampEnabled:mode==='metronome'&&$('ramp-enabled').checked,stepBpm:Number($('ramp-step').value),everyBars:Number($('ramp-every').value),targetBpm:Number($('ramp-target').value),
    }};
}
function syncAudio() {
  if (!validTempo) return false;
  try { player.configure(config()); return true; }
  catch(error) { player.stop(); status(error.message); return false; }
}
function clearPlayback() { document.querySelectorAll('.playing').forEach(el=>el.classList.remove('playing')); }
function tick(event) {
  lastTick = event; clearPlayback();
  $('position').textContent = `${event.silent?'Тихий такт · ':''}Такт ${event.bar} · доля ${event.beat}${event.bpm!==bpm?` · ${event.bpm} BPM`:''}`;
  if (mode === 'metronome') $('beats').children[event.beat-1]?.classList.add('playing');
  else {
    let bar = event.bar-1, patternIndex = active;
    if(scope==='chain') {
      for(let i=0;i<sequence.length;i++) {
        const p=patterns[sequence[i]];
        if(bar<p.bars){patternIndex=sequence[i];$('chain').children[i]?.classList.add('playing');break;}
        bar-=p.bars;
      }
    }
    if(patternIndex===active&&bar===selectedBar) $('rack').querySelectorAll(`[data-step="${event.step%16}"]`).forEach(el=>el.classList.add('playing'));
  }
}
const player = createReferencePlayer({onTick:tick,onState(value){
  playing=value.playing; $('start').textContent=playing?'▶ Играет':'▶ Старт'; $('start').setAttribute('aria-pressed',String(playing));
  if(!playing){clearPlayback();$('position').textContent='Остановлено';}
  if(value.reason==='interrupted'||value.reason==='timing') status('Воспроизведение остановлено. Продолжи кнопкой «Старт».');
}});
function stop(message) { player.stop(); if(message)status(message); }
function setTempo(value) {
  const number=Number(value); validTempo=Number.isInteger(number)&&number>=30&&number<=240;
  $('tempo-error').hidden=validTempo; $('bpm').setAttribute('aria-invalid',String(!validTempo));$('start').disabled=!validTempo;
  if(!validTempo){stop('Исправь темп перед запуском.');return;}
  bpm=number;$('bpm').value=String(bpm);$('bpm-range').value=String(bpm);syncAudio();
}
async function start() {
  if(!validTempo) return;
  try { if(!syncAudio())return;await player.start();status(mode==='metronome'?'Метроном звучит. Пробуй менять акценты и характер пульса.':scope==='chain'?'Играет цепочка паттернов по кругу.':'Играет выбранный паттерн по кругу.'); }
  catch(error){stop(error.message);}
}
function button(text, attrs={}) {
  const b=document.createElement('button');b.type='button';b.textContent=text;
  for(const [key,value] of Object.entries(attrs))b.setAttribute(key,String(value));return b;
}
function switchMode(next) {
  if(next===mode)return;stop();mode=next;
  document.querySelectorAll('[data-mode]').forEach(b=>{const on=b.dataset.mode===mode;b.setAttribute('aria-selected',String(on));b.tabIndex=on?0:-1;});
  $('metronome-panel').hidden=mode!=='metronome';$('rhythm-panel').hidden=mode!=='rhythm';
  $('meter').disabled=mode==='rhythm';$('meter').value=mode==='rhythm'?'4/4':meter;
  status(mode==='rhythm'?'Выбери готовую основу или собери свой паттерн.':'Выбери параметры и нажми «Старт».');syncAudio();
}
function renderBeats() {
  const [beats,denominator]=meter.split('/').map(Number);$('beats').replaceChildren();
  accents.forEach((level,i)=>{
    const b=button(String(i+1),{'class':'beat','data-level':level,'aria-label':`Доля ${i+1}: ${['тишина','обычная','акцент'][level]}`});
    const label=document.createElement('small');label.textContent=['Тишина','Доля','Акцент'][level];b.append(label);
    b.addEventListener('click',()=>{accents[i]=(accents[i]+1)%3;renderBeats();syncAudio();});$('beats').append(b);
  });
  $('meter-label').textContent=`${beats} ${beats>=2&&beats<=4?'доли':'долей'} · ${denominator===8?'восьмые':'четверти'}`;
}
function dirty() {current().dirty=true;current().preset=null;$('dirty').textContent='Свой рисунок';renderPresetSelection();syncAudio();}
function renderKits() {
  $('kits').replaceChildren();
  for(const [id,symbol,name,description] of kits) {
    const b=button('',{'class':'kit','data-kit':id,'aria-pressed':id===kit});
    const icon=document.createElement('span');icon.className='kit-symbol';icon.textContent=symbol;icon.setAttribute('aria-hidden','true');
    const copy=document.createElement('span'),title=document.createElement('b'),hint=document.createElement('small');title.textContent=name;hint.textContent=description;copy.append(title,hint);b.append(icon,copy);
    b.addEventListener('click',()=>{kit=id;renderKits();syncAudio();status(`Звук метронома: ${name}.`);});$('kits').append(b);
  }
}
function renderPresetSelection() {document.querySelectorAll('[data-preset]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.preset===current().preset&&!current().dirty)));}
function loadPreset(id) {
  stop();const preset=RHYTHM_PRESETS.find(p=>p.id===id), p=current();p.lanes=createLanes(id,p.bars).map(l=>({...l,velocities:l.steps.map(s=>s===2?1:s?.72:0)}));
  p.name=preset.name;p.preset=id;p.dirty=false;p.swing=preset.swing;rhythmSwing=preset.swing;selectedLane=p.lanes[0].id;ensureChannels();setTempo(preset.bpm);renderConstructor();syncAudio();status(`Основа «${preset.name}» загружена в паттерн ${p.id}. Её можно менять.`);
}
function renderLibrary() {
  for(const preset of RHYTHM_PRESETS) {
    const b=button('',{'class':'preset','data-preset':preset.id,'aria-pressed':preset.id==='rock'}), title=document.createElement('b'),hint=document.createElement('small');
    title.textContent=preset.name;hint.textContent=preset.id==='blank'?'Собрать с нуля':`${preset.bpm} BPM · 4/4${preset.swing>50?' · свинг':''}`;b.append(title,hint);b.addEventListener('click',()=>loadPreset(preset.id));$('presets').append(b);
  }
}
function choosePattern(index) {stop();active=index;selectedBar=0;selectedStep=0;selectedLane=channels[0].id;renderConstructor();syncAudio();status(`Открыт паттерн ${current().id} · ${current().name}.`);}
function renderPatternTabs() {
  $('patterns').replaceChildren();patterns.forEach((p,i)=>{const b=button(p.id,{'class':'pattern-tab','data-pattern':p.id,'aria-pressed':i===active,'aria-label':`Паттерн ${p.id}: ${p.name}`});b.addEventListener('click',()=>choosePattern(i));$('patterns').append(b);});
  $('add-pattern').disabled=$('duplicate-pattern').disabled=patterns.length>=8;
}
function stepUpdate(lane,index,value,velocity) {
  lane.steps[index]=value;lane.velocities[index]=value?(velocity??(value===2?1:.72)):0;dirty();renderRack();
}
function renderRack() {
  const p=current();$('rack').replaceChildren();const ruler=document.createElement('div');ruler.className='rack-ruler';
  const label=document.createElement('span');label.textContent='Каналы · общий микшер';ruler.append(label);
  for(let i=0;i<16;i++){const span=document.createElement('span');span.textContent=i%4===0?String(i/4+1):i%4===2?'и':'·';ruler.append(span);}$('rack').append(ruler);
  channels.forEach(channel=>{
    const lane=laneOf(channel.id),row=document.createElement('div');row.className=`rack-row${channel.muted?' muted':''}`;row.dataset.lane=channel.id;
    const controls=document.createElement('div');controls.className='lane-controls';
    const enabled=document.createElement('input');enabled.type='checkbox';enabled.checked=!channel.muted;enabled.setAttribute('aria-label',`${channel.name}: звучит`);enabled.addEventListener('change',()=>{channel.muted=!enabled.checked;syncAudio();row.classList.toggle('muted',channel.muted);});
    const name=button(channel.name,{'class':'lane-name','aria-pressed':selectedLane===channel.id,'aria-label':`Выбрать канал ${channel.name}`});name.addEventListener('click',()=>{selectedLane=channel.id;renderRack();});name.addEventListener('dblclick',()=>player.preview(channel.sound,kit).catch(e=>status(e.message)));
    const solo=button('S',{'class':'solo','aria-label':`${channel.name}: solo`,'aria-pressed':channel.solo});solo.addEventListener('click',()=>{channel.solo=!channel.solo;solo.setAttribute('aria-pressed',String(channel.solo));syncAudio();});
    const volume=document.createElement('input');volume.type='range';volume.min='0';volume.max='1.5';volume.step='.05';volume.value=channel.volume;volume.className='lane-volume';volume.setAttribute('aria-label',`${channel.name}: громкость`);volume.addEventListener('input',()=>{channel.volume=Number(volume.value);syncAudio();});controls.append(enabled,name,solo,volume);row.append(controls);
    for(let i=0;i<16;i++) {
      const index=selectedBar*16+i,value=lane.steps[index], selected=channel.id===selectedLane&&i===selectedStep;
      const cell=button('',{'class':`step${value?' on':''}${value===2?' accent':''}${selected?' selected':''}`,'data-step':i,'aria-pressed':value>0,'aria-label':`${channel.name}, такт ${selectedBar+1}, шаг ${i+1}: ${value===0?'пусто':value===2?'акцент':'удар'}`});
      cell.addEventListener('click',()=>{selectedLane=channel.id;selectedStep=i;stepUpdate(lane,index,value?0:1);$('rack').querySelector(`[data-lane="${channel.id}"] [data-step="${i}"]`)?.focus({preventScroll:true});});
      cell.addEventListener('contextmenu',event=>{event.preventDefault();selectedLane=channel.id;selectedStep=i;stepUpdate(lane,index,0);});
      row.append(cell);
    }
    $('rack').append(row);
  });
  renderVelocity();renderNewSounds();
}
function renderVelocity() {
  const lane=laneOf(selectedLane);$('velocity').replaceChildren();const row=document.createElement('div');row.className='velocity-grid';
  const label=document.createElement('span');label.className='velocity-label';const name=document.createElement('b');name.textContent=`Сила удара · ${SOUND_LABELS[lane.sound]}`;const hint=document.createElement('span');hint.textContent='Velocity · 0–100%';label.append(name,hint);row.append(label);
  for(let i=0;i<16;i++) {
    const index=selectedBar*16+i, cell=document.createElement('div');cell.className='velocity-cell';
    const slider=document.createElement('input');slider.type='range';slider.min='0';slider.max='1';slider.step='.01';slider.value=lane.velocities[index];slider.setAttribute('aria-label',`Сила удара ${SOUND_LABELS[lane.sound]}, шаг ${i+1}`);
    slider.addEventListener('input',()=>{const v=Number(slider.value);lane.velocities[index]=v;lane.steps[index]=v===0?0:v>=.95?2:1;selectedStep=i;dirty();const cell=$('rack').querySelector(`[data-lane="${lane.id}"] [data-step="${i}"]`);cell.classList.toggle('on',v>0);cell.classList.toggle('accent',v>=.95);cell.setAttribute('aria-pressed',String(v>0));cell.setAttribute('aria-label',`${SOUND_LABELS[lane.sound]}, такт ${selectedBar+1}, шаг ${i+1}: ${v===0?'пусто':v>=.95?'акцент':'удар'}`);});cell.append(slider);row.append(cell);
  }
  $('velocity').append(row);
}
function renderNewSounds() {
  const select=$('new-sound');select.replaceChildren();
  for(const [id,name] of Object.entries(SOUND_LABELS))if(!channels.some(c=>c.id===id)){const option=new Option(name,id);select.append(option);}
  $('add-lane').disabled=!select.options.length;select.disabled=!select.options.length;
}
function renderChain() {
  $('chain').replaceChildren();let bars=0;
  sequence.forEach((index,i)=>{
    const clip=document.createElement('label');clip.className='clip';const label=document.createElement('span');label.className='clip-number';label.textContent=`Такт ${bars+1}${patterns[index].bars>1?'–'+(bars+patterns[index].bars):''}`;bars+=patterns[index].bars;
    const select=document.createElement('select');select.setAttribute('aria-label',`Блок ${i+1} цепочки`);patterns.forEach((p,n)=>select.append(new Option(`${p.id} · ${p.name}`,String(n))));select.value=String(index);select.addEventListener('change',()=>{sequence[i]=Number(select.value);stop();renderChain();syncAudio();});clip.append(label,select);$('chain').append(clip);
  });
  $('chain-length').textContent=`${bars} тактов · по кругу`;$('add-clip').disabled=sequence.length>=8;$('remove-clip').disabled=sequence.length<=1;
}
function renderConstructor() {
  ensureChannels();selectedBar=Math.min(selectedBar,current().bars-1);$('pattern-name').value=current().name;$('bars').value=String(current().bars);$('dirty').textContent=current().dirty?'Свой рисунок':'Готовая основа';
  $('rhythm-swing').value=rhythmSwing;$('rhythm-swing-value').textContent=`${rhythmSwing}%`;renderPatternTabs();
  $('bar-tabs').replaceChildren();for(let i=0;i<current().bars;i++){const b=button(`Такт ${i+1}`,{'class':'bar-tab','aria-pressed':i===selectedBar});b.addEventListener('click',()=>{selectedBar=i;renderConstructor();});$('bar-tabs').append(b);}
  $('copy-bar').textContent=copiedBar?'Вставить такт':'Копировать такт';renderRack();renderChain();renderPresetSelection();
}
function resizePattern(bars) {
  stop();const p=current(),old=p.bars;
  for(const lane of p.lanes){const steps=[...lane.steps],velocities=[...lane.velocities];lane.steps=Array.from({length:bars*16},(_,i)=>steps[i%(old*16)]);lane.velocities=Array.from({length:bars*16},(_,i)=>velocities[i%(old*16)]);}
  p.bars=bars;selectedBar=Math.min(selectedBar,bars-1);dirty();renderConstructor();syncAudio();
}
function readSaved() {
  try {
    const list=JSON.parse(localStorage.getItem(STORAGE)||'[]');if(!Array.isArray(list)||list.length>20)throw new Error('Saved patterns');
    saved=list.filter(p=>p&&typeof p.name==='string'&&p.name.length<=50&&[1,2,4].includes(p.bars)&&Number.isInteger(p.swing)&&p.swing>=50&&p.swing<=70&&Array.isArray(p.lanes)&&p.lanes.length<=8&&p.lanes.every(l=>Object.hasOwn(SOUND_LABELS,l.sound)&&l.id===l.sound&&Array.isArray(l.steps)&&l.steps.length===p.bars*16&&l.steps.every(s=>[0,1,2].includes(s))&&Array.isArray(l.velocities)&&l.velocities.length===l.steps.length&&l.velocities.every(v=>typeof v==='number'&&v>=0&&v<=1)));
  } catch{saved=[];}
}
function renderSaved() {
  $('saved-count').textContent=String(saved.length);$('saved-patterns').replaceChildren();
  if(!saved.length){const p=document.createElement('p');p.className='muted';p.textContent='Здесь появятся твои грувы.';$('saved-patterns').append(p);}
  saved.forEach((p,i)=>{
    const row=document.createElement('div'),load=button(displayName(p.name),{'class':'text-button'}),remove=button('×',{'class':'text-button','aria-label':`Удалить сохранённый вариант ${displayName(p.name)}`});
    load.addEventListener('click',()=>{stop();patterns[active]={...clone(p),id:current().id,preset:null,dirty:true};ensureChannels();rhythmSwing=p.swing;for(const lane of p.lanes){const channel=channels.find(c=>c.id===lane.id);Object.assign(channel,{volume:lane.volume,muted:lane.muted,solo:lane.solo});}selectedBar=0;selectedLane=channels[0].id;renderConstructor();syncAudio();status(`Открыт свой вариант «${p.name}».`);});
    remove.addEventListener('click',()=>{const next=saved.filter((_,n)=>n!==i);try{localStorage.setItem(STORAGE,JSON.stringify(next));saved=next;renderSaved();}catch{status('Не удалось удалить сохранённый вариант.');}});row.append(load,remove);$('saved-patterns').append(row);
  });
}

document.querySelectorAll('[data-theme]').forEach(b=>{if(b.tagName!=='BUTTON')return;b.addEventListener('click',()=>{document.documentElement.dataset.theme=b.dataset.theme;document.querySelectorAll('button[data-theme]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));});});
document.querySelectorAll('[data-mode]').forEach(b=>b.addEventListener('click',()=>switchMode(b.dataset.mode)));
document.querySelector('.tabs').addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();switchMode(event.key==='Home'?'metronome':event.key==='End'?'rhythm':mode==='metronome'?'rhythm':'metronome');$(`tab-${mode}`).focus();});
$('start').addEventListener('click',start);$('stop').addEventListener('click',()=>stop('Остановлено. Настройки и рисунки сохранены в текущем сеансе.'));
$('bpm').addEventListener('input',()=>setTempo($('bpm').value));$('bpm-range').addEventListener('input',()=>setTempo($('bpm-range').value));
$('bpm-minus').addEventListener('click',()=>setTempo(Math.max(30,bpm-1)));$('bpm-plus').addEventListener('click',()=>setTempo(Math.min(240,bpm+1)));
$('tap').addEventListener('click',()=>{const time=performance.now();if(taps.length&&time-taps.at(-1)>2500)taps=[];taps.push(time);if(taps.length>6)taps.shift();if(taps.length>1){const tempo=Math.round(60000/((taps.at(-1)-taps[0])/(taps.length-1)));setTempo(Math.max(30,Math.min(240,tempo)));}status(taps.length===1?'Настучи ещё несколько долей.':`Темп по нажатиям: ${bpm} BPM.`);});
$('meter').addEventListener('change',()=>{stop();meter=$('meter').value;const beats=Number(meter.split('/')[0]);accents=Array.from({length:beats},(_,i)=>i===0||meter==='6/8'&&i===3?2:1);renderBeats();syncAudio();});
document.querySelectorAll('[data-division]').forEach(b=>b.addEventListener('click',()=>{division=Number(b.dataset.division);document.querySelectorAll('[data-division]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));syncAudio();}));
$('swing').addEventListener('input',()=>{swing=Number($('swing').value);$('swing-value').textContent=`${swing}%${swing===50?' · ровно':''}`;syncAudio();});
for(const id of ['master','click-volume','sub-volume','silent-enabled','sound-bars','silent-bars','ramp-enabled','ramp-step','ramp-every','ramp-target','rhythm-click'])$(id).addEventListener('input',syncAudio);
$('preview-kit').addEventListener('click',()=>{syncAudio();player.preview('accent',kit).then(()=>status(`Прослушивание: ${kits.find(k=>k[0]===kit)[2]}.`)).catch(error=>status(error.message));});
document.querySelectorAll('[data-scope]').forEach(b=>b.addEventListener('click',()=>{stop();scope=b.dataset.scope;document.querySelectorAll('[data-scope]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));syncAudio();status(scope==='chain'?'Выбран повтор цепочки.':'Выбран повтор открытого паттерна.');}));
$('pattern-name').addEventListener('input',()=>{current().name=displayName($('pattern-name').value);dirty();renderPatternTabs();renderChain();});
$('bars').addEventListener('change',()=>resizePattern(Number($('bars').value)));
$('add-pattern').addEventListener('click',()=>{if(patterns.length>=8)return;stop();const p=seedPattern(letters[patterns.length],'Новый паттерн','blank');p.dirty=true;patterns.push(p);choosePattern(patterns.length-1);});
$('duplicate-pattern').addEventListener('click',()=>{if(patterns.length>=8)return;stop();patterns.push({...clone(current()),id:letters[patterns.length],name:`${current().name.slice(0,42)} · копия`,dirty:true,preset:null});choosePattern(patterns.length-1);});
$('copy-bar').addEventListener('click',()=>{if(!copiedBar){copiedBar=current().lanes.map(l=>({id:l.id,steps:l.steps.slice(selectedBar*16,(selectedBar+1)*16),velocities:l.velocities.slice(selectedBar*16,(selectedBar+1)*16)}));$('copy-bar').textContent='Вставить такт';status('Такт скопирован. Выбери место и нажми «Вставить такт».');}else{for(const lane of current().lanes){const data=copiedBar.find(l=>l.id===lane.id);if(data){lane.steps.splice(selectedBar*16,16,...data.steps);lane.velocities.splice(selectedBar*16,16,...data.velocities);}}copiedBar=null;dirty();renderConstructor();status('Такт вставлен.');}});
$('clear-bar').addEventListener('click',()=>{for(const lane of current().lanes){lane.steps.fill(0,selectedBar*16,(selectedBar+1)*16);lane.velocities.fill(0,selectedBar*16,(selectedBar+1)*16);}dirty();renderRack();status(`Такт ${selectedBar+1} очищен.`);});
$('accent-step').addEventListener('click',()=>{const lane=laneOf(selectedLane),index=selectedBar*16+selectedStep;stepUpdate(lane,index,lane.steps[index]===2?1:2);});
$('add-lane').addEventListener('click',()=>{const sound=$('new-sound').value;if(!sound||channels.length>=8)return;channels.push({id:sound,sound,name:SOUND_LABELS[sound],volume:.65,muted:false,solo:false});ensureChannels();selectedLane=sound;dirty();renderRack();status(`Добавлен инструмент: ${SOUND_LABELS[sound]}.`);});
$('rhythm-swing').addEventListener('input',()=>{rhythmSwing=Number($('rhythm-swing').value);current().swing=rhythmSwing;$('rhythm-swing-value').textContent=`${rhythmSwing}%`;dirty();});
$('save-pattern').addEventListener('click',()=>{const p=clone(current());p.swing=rhythmSwing;p.lanes=p.lanes.map(lane=>({...lane,...channels.find(c=>c.id===lane.id)}));p.name=displayName(p.name.trim()||'Мой грув');const next=[p,...saved.filter(x=>x.name!==p.name)].slice(0,20);try{localStorage.setItem(STORAGE,JSON.stringify(next));saved=next;renderSaved();status(`«${p.name}» сохранён в этом референсе.`);}catch{status('Не удалось сохранить вариант. Он остаётся в текущем сеансе.');}});
$('add-clip').addEventListener('click',()=>{if(sequence.length>=8)return;stop();sequence.push(active);renderChain();syncAudio();});
$('remove-clip').addEventListener('click',()=>{if(sequence.length<=1)return;stop();sequence.pop();renderChain();syncAudio();});
document.addEventListener('visibilitychange',()=>{if(document.hidden)stop('Вкладка скрыта. Для продолжения нажми «Старт».');});
window.addEventListener('pagehide',()=>player.dispose(),{once:true});
document.addEventListener('keydown',event=>{if(event.code!=='Space'||event.repeat||event.altKey||event.ctrlKey||event.metaKey||/^(INPUT|SELECT|TEXTAREA|BUTTON|A|SUMMARY)$/.test(event.target.tagName))return;event.preventDefault();if(playing)stop();else start();});
readSaved();renderBeats();renderKits();renderLibrary();renderConstructor();renderSaved();syncAudio();
const params=new URLSearchParams(location.search);if(params.get('theme')==='dark')document.querySelector('button[data-theme=dark]').click();if(params.get('view')==='rhythm')switchMode('rhythm');
