import { AU_KM, EARTH_MASS, elements, surfaceGravity, type Body } from '../physics/dynamics';
import { presets } from '../data/presets';

const shapes:Record<string,string>={
  orbit:'<circle cx="12" cy="12" r="3"/><ellipse cx="12" cy="12" rx="10" ry="6" transform="rotate(-35 12 12)"/>',
  close:'<path d="m6 6 12 12m0-12L6 18"/>',
  rewind:'<path d="M8 4 3 9l5 5M3 9h10a6 6 0 0 1 0 12h-2"/>',
  restart:'<path d="M3 11a9 9 0 1 1 2 7M3 11V5m0 6h6"/>',
  play:'<path d="m8 5 12 7-12 7z" fill="currentColor" stroke="none"/>', pause:'<path d="M8 5v14m8-14v14" stroke-width="3"/>',
  step:'<path d="m6 6 9 6-9 6zM18 6v12"/>',
};
export function icon(name:string, size=18){
  return '<svg aria-hidden="true" width="'+size+'" height="'+size+'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round">'+(shapes[name]??shapes.orbit)+'</svg>';
}
const btn=(id:string,label:string,glyph:string,active=false)=>
  '<button type="button" class="icon-btn'+(active?' active':'')+'" id="'+id+'" title="'+label+'" aria-label="'+label+'">'+icon(glyph)+'</button>';
const toggle=(id:string,label:string,checked:boolean)=>
  '<label class="toggle-row"><input id="'+id+'" type="checkbox" '+(checked?'checked':'')+'><span>'+label+'</span></label>';
const options=presets.map(p=>'<option value="'+p.id+'">'+p.name+'</option>').join('');
const metrics=[
  ['velocity','Orbital velocity','km/s'],['distance','Distance to primary','AU'],['eccentricity','Eccentricity',''],
  ['gravity','Surface gravity','m/s²'],['peri','Periapsis','AU'],['apo','Apoapsis','AU'],['period','Orbital period','d'],['escape','Escape velocity','km/s'],
];

export function mount(root:HTMLElement){
  root.innerHTML=`
    <header class="topbar">
      <h1>Orbital Lab</h1>
      <select id="preset" aria-label="System preset">${options}</select>
      <nav aria-label="Simulation controls">
        <button type="button" id="reset-view">Reset view</button>
        <button type="button" id="flight-toggle" title="Toggle free flight (F)">Fly</button>
        <details class="menu" id="body-menu">
          <summary>Bodies</summary>
          <div class="panel" id="body-list"></div>
        </details>
        <details class="menu">
          <summary>View</summary>
          <div class="panel settings">
            <div class="camera-options">
              <button type="button" id="overview">Overview</button>
              <button type="button" id="follow">Follow</button>
              <button type="button" id="scale">True scale</button>
            </div>
            ${toggle('paths','Predicted orbits',true)}
            ${toggle('trails','Orbital trails',true)}
            ${toggle('grid','Gravity grid',false)}
            ${toggle('labels','Body labels',true)}
            ${toggle('belt','Asteroid belt',true)}
            <button type="button" id="fullscreen">Fullscreen</button>
            <button type="button" id="help">Controls</button>
          </div>
        </details>
        <details class="menu" id="launch-menu">
          <summary>Add body</summary>
          <div class="panel settings">
            <label for="launch-types">Body type</label>
            <select id="launch-types"><option value="asteroid">Asteroid</option><option value="comet">Comet</option><option value="giant">Gas giant</option><option value="hole">Black hole</option></select>
            <button type="button" id="arm"><span>Arm launch tool</span></button>
          </div>
        </details>
      </nav>
    </header>
    <main class="viewport" id="viewport" aria-label="Simulation viewport">
      <div class="flight-ui" id="flight-ui" hidden>
        <span class="flight-guide">Click a planet to fly to it · Drag to look · WASD to move · Shift to boost</span>
        <span class="flight-crosshair" aria-hidden="true">+</span>
        <div class="flight-pad" aria-label="Flight movement">
          <button type="button" data-fly="left" aria-label="Fly left">←</button>
          <button type="button" data-fly="forward" aria-label="Fly forward">↑</button>
          <button type="button" data-fly="right" aria-label="Fly right">→</button>
          <button type="button" data-fly="down" aria-label="Fly down">−</button>
          <button type="button" data-fly="back" aria-label="Fly backward">↓</button>
          <button type="button" data-fly="up" aria-label="Fly up">+</button>
        </div>
      </div>
      <output id="engine-status" class="sr-only"></output>
      <div id="view-message" role="status" class="view-message" hidden></div>
      <div id="launch-preview" class="launch-preview" hidden></div>
      <button type="button" id="cancel-launch" hidden>Cancel launch</button>
      <details class="inspector" id="inspector">
        <summary id="inspector-label">Body details</summary>
        <div class="panel">
          <div id="body-card" class="body-card"></div>
          <div class="metrics">${metrics.map(([id,label,unit],i)=>'<div class="metric'+(i>3?' advanced':'')+'"><span>'+label+'</span><strong id="metric-'+id+'">N/A</strong><small>'+unit+'</small></div>').join('')}</div>
          <details id="advanced"><summary>Orbital details</summary><div id="advanced-metrics"></div></details>
          <div id="mass-controls"><div class="split"><label for="mass">Mass multiplier</label><output id="mass-value">1.00×</output></div>
            <input id="mass" type="range" min="-2" max="2" step=".005" value="0"></div>
        </div>
      </details>
    </main>
    <footer class="transport">
      <div class="playback">${btn('play','Pause or play (Space)','pause')}${btn('reverse','Reverse time','rewind')}${btn('step','Advance one physics step while paused','step')}${btn('reset','Reset current system','restart')}</div>
      <strong id="epoch" aria-label="Simulation date">2009 MAY 21</strong><span id="epoch-clock" aria-label="Simulation time (UTC)" title="Simulation time (UTC)">00:00:00</span>
      <div class="warp"><label for="warp" class="sr-only">Time warp</label><input id="warp" type="range" min="0" max="8" step="1"><output id="warp-value"></output></div>
      <span id="fps" class="sr-only">FPS pending</span>
    </footer>
    <dialog id="controls-dialog"><form method="dialog"><button aria-label="Close controls" class="icon-btn">${icon('close')}</button><h2>Flight controls</h2><dl><dt>Free flight</dt><dd>Use Fly or F, then drag to look. Move with WASD or the arrow keys, change altitude with Q and E, and hold Shift to boost. Click a planet label for an assisted approach. Choose a planet from Bodies to jump straight to its close-up. Escape returns to orbit controls.</dd><dt>Orbit camera</dt><dd>Drag with the primary button or one finger.</dd><dt>Zoom and pan</dt><dd>Scroll or pinch to zoom. Right-drag or use two fingers to pan.</dd><dt>Track a body</dt><dd>Choose a body from the catalog or click it in the viewport.</dd><dt>Time</dt><dd>Space pauses or resumes. R changes time direction.</dd><dt>Launch body</dt><dd>Arm the tool, then pull back on the ecliptic and release. Escape cancels.</dd></dl><p class="credits">Planetary imagery by <a href="https://www.solarsystemscope.com/textures/" target="_blank" rel="noopener noreferrer">Solar System Scope</a> · CC BY 4.0</p></form></dialog>`;
  const advanced=root.querySelector('#advanced-metrics')!;
  root.querySelectorAll('.metric.advanced').forEach(row=>advanced.append(row));
}
export const byId=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;

const bodyType=(body:Body)=>body.ring?'Ringed planet':body.kind==='probe'?'Spacecraft':body.kind.charAt(0).toUpperCase()+body.kind.slice(1);
export function catalog(bodies:Body[],selected:string|null,onPick:(id:string)=>void){
  const list=byId('body-list');
  const scroll=list.scrollTop;
  const oldFocus=(document.activeElement as HTMLElement)?.dataset.body;
  list.replaceChildren();
  function row(body:Body){
    const button=document.createElement('button');
    button.type='button';
    button.className='body-row'+(body.id===selected?' current':'');
    button.dataset.body=body.id;
    button.setAttribute('aria-pressed',String(body.id===selected));
    button.textContent=body.name;
    button.title='Jump to '+body.name;
    button.addEventListener('click',()=>onPick(body.id));
    return button;
  }
  const major=bodies.filter(b=>b.kind!=='moon'&&b.kind!=='probe');
  const satellites=bodies.filter(b=>!major.includes(b));
  major.forEach(body=>list.append(row(body)));
  if(satellites.length){
    const details=document.createElement('details');
    details.open=Boolean(list.dataset.expanded==='true'||satellites.some(body=>body.id===selected));
    details.addEventListener('toggle',()=>{ list.dataset.expanded=String(details.open); });
    const sum=document.createElement('summary');
    sum.textContent='Moons & spacecraft ('+satellites.length+')';
    details.append(sum,...satellites.map(row));
    list.append(details);
  }
  list.scrollTop=scroll;
  if(oldFocus) [...list.querySelectorAll('button')].find(button=>button.dataset.body===oldFocus)?.focus({preventScroll:true});
}

export function card(body:Body|null,baseline:number){
  const card=byId('body-card');
  card.replaceChildren();
  byId('inspector-label').textContent=body?.name??'Body details';
  byId('mass-controls').hidden=!body;
  if(!body)return;
  const type=document.createElement('span');
  type.textContent=bodyType(body)+' · '+Math.round(body.radius).toLocaleString('en-US')+' km radius';
  card.append(type);
  byId<HTMLInputElement>('mass').value=String(Math.log10(body.mass/baseline));
}
const precision=(n:number|undefined, digits:number)=>{
  if(n===undefined || Number.isNaN(n)) return 'N/A';
  if(!Number.isFinite(n)) return '∞';
  if(n!==0 && Math.abs(n)<10**(-digits)) return n.toExponential(2);
  return n.toLocaleString('en-US',{minimumFractionDigits:digits,maximumFractionDigits:digits});
};
export function telemetry(body:Body|null,primary:Body|null,baseline:number){
  const orbit=body && primary && body!==primary ? elements(body,primary) : null;
  const values=[precision(orbit?.speed,2),precision(orbit?.distance,3),precision(orbit?.e,3),
    precision(body && body.kind!=='black hole' ? surfaceGravity(body):undefined,2),precision(orbit?.peri,3),
    precision(orbit?.apo,3),precision(orbit?.period,2),precision(orbit?.escape,2)];
  metrics.forEach(([id],i)=>{byId('metric-'+id).textContent=values[i];});
  byId('mass-value').textContent=body ? precision(body.mass/baseline,2)+'×' : 'N/A';
  if(body) byId('mass').setAttribute('aria-valuetext',precision(body.mass/EARTH_MASS,2)+' Earth masses');
}

export function launchPreview(body:Body,primary:Body){
  const orbit=elements(body,primary);
  const box=byId('launch-preview');
  box.hidden=false;
  if(!orbit){
    box.textContent='Choose a point away from the reference body';
    return;
  }
  const state=orbit.e<1?'BOUND ORBIT':'ESCAPE TRAJECTORY';
  box.textContent=state+'  ·  e '+precision(orbit.e,3)+'  ·  Periapsis '+precision(orbit.peri*AU_KM,0)+' km';
}