import { Vector3 } from 'three';
import { loadPreset, spawnBody, type Preset } from './data/presets';
import { copyBodies, disrupt, G, Integrator, orbitalReference, type Body } from './physics/dynamics';
import { Observatory } from './scene/observatory';
import { byId, card, catalog, icon, launchPreview, mount, telemetry } from './ui/hud';
import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-600.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import './ui/style.css';

const STEPS = [1, 60, 3600, 21600, 86400, 604800, 2592000, 7776000, 31557600];
const WARP_TEXT = ['1 sec/s','1 min/s','1 hr/s','6 hr/s','1 day/s','7 days/s','30 days/s','90 days/s','1 year/s'];
const EPOCH = Date.UTC(2009,4,21);
const DT = 1/12;
const MAX_BATCH = 192;
const MAX_BODIES = 80;
const CLOCK = new Intl.DateTimeFormat('en-GB',{timeZone:'UTC',timeStyle:'medium'});
const DATE = new Intl.DateTimeFormat('en-GB',{timeZone:'UTC',year:'numeric',month:'short',day:'2-digit'});

function start() {
  const root=document.querySelector<HTMLElement>('#app')!;
  mount(root);
  const frame=byId('viewport');
  const integrator=new Integrator();
  const scene=new Observatory(frame,selectBody);
  const canvas=scene.renderer.domElement;
  const warp=byId<HTMLInputElement>('warp');
  const mass=byId<HTMLInputElement>('mass');
  const baseline=new Map<string,number>();
  const disruptions=new Map<number,Body[]>();

  let preset:Preset='solar';
  let bodies:Body[]=[];
  let selected:string|null=null;
  let steps=0, remainder=0, previous=performance.now(), serial=0;
  let paused=false, reversed=false, speedIndex=0, speed=STEPS[speedIndex], arm=false, launchKind='asteroid';
  let pointer:{id:number; x:number; y:number; start:Vector3|null; end:Vector3|null}|null=null;
  let messageUntil=0, lastHUD=0, fpsStart=previous, frames=0;

  const find=(id:string|null)=>bodies.find(body=>body.id===id)??null;
  const primary=()=>bodies.find(body=>body.kind==='star')??bodies[0];
  const serialId=()=> 'object-'+(++serial);
  const press=(id:string,value:boolean)=>{
    byId(id).classList.toggle('active',value);
    byId(id).setAttribute('aria-pressed',String(value));
  };
  const range=(input:HTMLInputElement)=>{
    const min=Number(input.min), max=Number(input.max);
    input.style.setProperty('--fill',(100*(Number(input.value)-min)/(max-min))+'%');
  };

  function notice(message:string,seconds=3.5){
    const box=byId('view-message');
    box.hidden=false;
    box.textContent=message;
    messageUntil=performance.now()+seconds*1000;
  }

  function updateCameraHUD(){
    press('follow',scene.follow);
    const flying=scene.flight.active;
    press('overview',!scene.follow && !flying);
    press('flight-toggle',flying);
    byId('flight-toggle').textContent=flying?'Exit flight':'Fly';
    byId('flight-ui').hidden=!flying;
    frame.classList.toggle('flying',flying);
    byId('follow').toggleAttribute('disabled',!selected);
  }

  let flightReturn:string|null=null;
  function toggleFlight(){
    if(scene.flight.active) scene.focus(find(flightReturn)?.id??null);
    else {
      setArm(false);
      flightReturn=scene.follow ? selected : null;
      scene.startFlight();
      (document.activeElement as HTMLElement | null)?.blur();
    }
    updateCameraHUD();
  }

  function showSelection(){
    const target=find(selected);
    const reference=target ? orbitalReference(target,bodies,primary()) : null;
    const base=target ? baseline.get(target.id)??target.mass : 1;
    card(target,base);
    range(mass);
    telemetry(target,reference,base);
    updateCameraHUD();
  }

  function selectBody(id:string,jump=false){
    if(arm || !find(id)) return;
    selected=id;
    const menu=byId<HTMLDetailsElement>('body-menu');
    if(menu.open){
      menu.open=false;
      menu.querySelector('summary')?.focus({preventScroll:true});
    }
    if(scene.flight.active && !jump) scene.flyTo(id);
    else scene.focus(id,true);
    refreshCatalog();
  }

  function refreshCatalog(){
    catalog(bodies,selected,id=>selectBody(id,true));
    showSelection();
  }

  function playbackHUD(){
    byId('play').innerHTML=icon(paused?'play':'pause',21);
    byId('play').setAttribute('aria-label',paused?'Play simulation':'Pause simulation');
    byId('play').setAttribute('aria-pressed',String(paused));
    byId('step').toggleAttribute('disabled',!paused);
    press('reverse',reversed);
    byId('engine-status').textContent=paused?'SIMULATION PAUSED':reversed?'REVERSE TIME':'SIMULATION LIVE';
    byId('warp-value').textContent=paused?'Paused':(reversed?'−':'')+WARP_TEXT[speedIndex];
    warp.setAttribute('aria-valuetext',WARP_TEXT[speedIndex]);
    range(warp);
  }

  function reset(id:Preset){
    setArm(false);
    preset=id;
    const previousSelection=selected;
    bodies=loadPreset(id);
    steps=0;
    remainder=0;
    disruptions.clear();
    serial=0;
    baseline.clear();
    for(const body of bodies) baseline.set(body.id,body.mass);
    scene.reset();
    scene.synchronize(bodies);
    const beltToggle=byId<HTMLInputElement>('belt');
    beltToggle.disabled=id!=='solar' && id!=='rogue';
    scene.showBelt=!beltToggle.disabled && beltToggle.checked;
    selected=find(previousSelection)?.id??primary().id;
    scene.focus(null,true);
    refreshCatalog();
    lastHUD=0;
  }

  function reconcile(){
    for(const body of bodies) if(!baseline.has(body.id)) baseline.set(body.id,body.mass);
    scene.synchronize(bodies);
    if(selected&&!find(selected)){
      selected=primary().id;
      if(scene.follow) scene.focus(selected);
    }
    refreshCatalog();
  }

  function physicsStep(direction:number){
    const restored=direction<0 ? disruptions.get(steps) : undefined;
    if(restored){
      bodies=copyBodies(restored);
      disruptions.delete(steps);
      reconcile();
    }
    integrator.step(bodies,DT*direction);
    steps+=direction;
    if(direction<0) return;
    if(!integrator.tidalEncounter) return;
    const before=copyBodies(bodies);
    const name=disrupt(bodies,serialId);
    if(name){
      disruptions.set(steps,before);
      if(disruptions.size>80) disruptions.delete(disruptions.keys().next().value!);
      reconcile();
      notice(name+' broke up inside its Roche limit');
    }
  }

  function setArm(value:boolean){
    if(value && scene.flight.active) scene.focus(null,true);
    arm=value;
    if(pointer && canvas.hasPointerCapture(pointer.id)) canvas.releasePointerCapture(pointer.id);
    pointer=null;
    scene.controls.enabled=!arm && !scene.flight.active;
    scene.cancelAim();
    frame.classList.toggle('armed',arm);
    byId('cancel-launch').hidden=!arm;
    byId('arm').setAttribute('aria-pressed',String(arm));
    byId('arm').querySelector('span')!.textContent=arm?'Cancel launch':'Arm launch tool';
    byId('launch-preview').hidden=true;
    byId('view-message').hidden=true;
    updateCameraHUD();
    if(arm){
      byId<HTMLDetailsElement>('launch-menu').open=false;
      notice('Drag on the ecliptic to set launch velocity',4.5);
    }
  }

  function candidate(start:Vector3,end:Vector3,id:string){
    const reference=primary();
    const drag=start.clone().sub(end);
    const distance=start.distanceTo(reference.position);
    const circular=Math.sqrt(G*reference.mass/Math.max(.000001,distance));
    const velocity=reference.velocity.clone();
    if(drag.lengthSq()>1e-18){
      const relative=Math.min(8,drag.length()/Math.max(.00015,distance*.16));
      velocity.addScaledVector(drag.clone().normalize(),circular*relative);
    } else {
      const tangent=new Vector3(-start.z+reference.position.z,0,start.x-reference.position.x).normalize().negate();
      velocity.addScaledVector(tangent,circular);
    }
    return { body:spawnBody(launchKind,id,start,velocity,reference),reference,drag:drag.multiplyScalar(2) };
  }

  function updateAim(){
    if(!pointer?.start || !pointer.end) return;
    const launch=candidate(pointer.start,pointer.end,'preview');
    scene.showAim(launch.body,launch.reference,launch.drag);
    launchPreview(launch.body,launch.reference);
  }

  canvas.addEventListener('pointerdown',event=>{
    if(event.button!==0 || pointer || scene.flight.active) return;
    const position=arm?scene.plane(event):null;
    if(arm && (!position || position.distanceTo(primary().position)<1e-6)){
      notice('Choose a point on the visible ecliptic');
      return;
    }
    pointer={id:event.pointerId,x:event.clientX,y:event.clientY,start:position,end:position};
    if(arm){
      canvas.setPointerCapture(event.pointerId);
      updateAim();
    }
  });
  canvas.addEventListener('pointermove',event=>{
    if(!arm || pointer?.id!==event.pointerId) return;
    pointer.end=scene.plane(event)??pointer.end;
    updateAim();
  });
  canvas.addEventListener('pointerup',event=>{
    if(pointer?.id!==event.pointerId) return;
    const {x,y,start,end}=pointer;
    pointer=null;
    if(arm && start && end){
      if(bodies.length>=MAX_BODIES){
        setArm(false);
        notice('Body limit reached. Reset or switch presets to add more.');
        return;
      }
      const launch=candidate(start,scene.plane(event)??end,serialId());
      bodies.push(launch.body);
      disruptions.clear();
      reconcile();
      setArm(false);
      notice(launch.body.name+' launched · Select it in the catalog to track');
    } else if(!arm && Math.hypot(event.clientX-x,event.clientY-y)<6){
      const id=scene.pick(event);
      if(id) selectBody(id);
    }
  });
  for(const type of ['pointercancel','lostpointercapture'])
    canvas.addEventListener(type,()=>{
      pointer=null;
      scene.cancelAim();
      byId('launch-preview').hidden=true;
    });

  byId<HTMLSelectElement>('preset').addEventListener('change',event=>reset((event.target as HTMLSelectElement).value as Preset));
  byId('reset').addEventListener('click',()=>{reset(preset);notice('System reset to its initial state');});
  byId('play').addEventListener('click',()=>{paused=!paused;playbackHUD();});
  byId('step').addEventListener('click',()=>{if(paused){physicsStep(reversed?-1:1);lastHUD=0;}});
  byId('reverse').addEventListener('click',()=>{reversed=!reversed;remainder=0;playbackHUD();});
  byId('follow').addEventListener('click',()=>{if(selected) scene.focus(selected);updateCameraHUD();});
  byId('reset-view').addEventListener('click',()=>{
    if(arm) setArm(false);
    scene.focus(null,true);
    updateCameraHUD();
  });
  byId('overview').addEventListener('click',()=>{scene.focus(null);updateCameraHUD();});
  byId('scale').addEventListener('click',()=>{
    scene.setScale(!scene.trueScale,bodies);
    byId('scale').textContent=scene.trueScale?'Cinematic scale':'True scale';
    press('scale',scene.trueScale);
    updateCameraHUD();
  });
  byId('fullscreen').addEventListener('click',async ()=>{
    try {
      if(document.fullscreenElement) await document.exitFullscreen();
      else await root.requestFullscreen();
    } catch {notice('Fullscreen is unavailable in this browser');}
  });
  byId('help').addEventListener('click',()=>byId<HTMLDialogElement>('controls-dialog').showModal());
  byId('flight-toggle').addEventListener('click',toggleFlight);
  for(const button of root.querySelectorAll<HTMLButtonElement>('[data-fly]')){
    const release=(event:PointerEvent)=>scene.flight.hold('pointer-'+event.pointerId,button.dataset.fly!,false);
    button.addEventListener('pointerdown',event=>{
      event.preventDefault();
      button.setPointerCapture(event.pointerId);
      scene.flight.hold('pointer-'+event.pointerId,button.dataset.fly!,true);
    });
    button.addEventListener('pointerup',release);
    button.addEventListener('pointercancel',release);
    button.addEventListener('lostpointercapture',release);
  }
  byId('arm').addEventListener('click',()=>setArm(!arm));
  byId('cancel-launch').addEventListener('click',()=>setArm(false));
  byId<HTMLSelectElement>('launch-types').addEventListener('change',event=>{
    launchKind=(event.target as HTMLSelectElement).value;
    updateAim();
  });
  const menus=[...root.querySelectorAll<HTMLDetailsElement>('.menu')];
  for(const menu of menus) menu.addEventListener('toggle',()=>{
    if(menu.open) menus.filter(other=>other!==menu).forEach(other=>other.open=false);
  });
  document.addEventListener('pointerdown',event=>{
    for(const menu of menus) if(!menu.contains(event.target as Node)) menu.open=false;
  });
  const layers:Record<string,(enabled:boolean)=>void>={
    paths:value=>scene.paths=value,trails:value=>scene.trails=value,
    grid:value=>scene.grid.visible=value,labels:value=>scene.labelsEnabled=value,
    belt:value=>scene.showBelt=value && (preset==='solar'||preset==='rogue'),
  };
  for(const [id,apply] of Object.entries(layers)){
    byId<HTMLInputElement>(id).addEventListener('change',event=>apply((event.target as HTMLInputElement).checked));
  }
  warp.addEventListener('input',()=>{speedIndex=Number(warp.value);playbackHUD();});
  mass.addEventListener('input',()=>{
    const body=find(selected);
    if(!body) return;
    body.mass=baseline.get(body.id)!*10**Number(mass.value);
    disruptions.clear();
    range(mass);
    telemetry(body,orbitalReference(body,bodies,primary()),baseline.get(body.id)!);
  });
  window.addEventListener('keydown',event=>{
    const dialogOpen=byId<HTMLDialogElement>('controls-dialog').open;
    if(event.key==='Escape' && arm){setArm(false);return;}
    if(event.key==='Escape' && scene.flight.active && !dialogOpen){toggleFlight();return;}
    if(dialogOpen || (event.target instanceof HTMLElement && event.target.closest('input,select,textarea,[contenteditable]'))) return;
    if(scene.flight.key(event.code,true)){
      event.preventDefault();
      return;
    }
    if(event.repeat) return;
    if(event.code==='KeyF'){event.preventDefault();toggleFlight();return;}
    if(event.target instanceof HTMLElement && event.target.closest('button,summary')) return;
    if(event.code==='Space'){event.preventDefault();byId('play').click();}
    if(event.code==='KeyR') byId('reverse').click();
  });
  window.addEventListener('keyup',event=>scene.flight.key(event.code,false));

  let contextLost=false;
  canvas.addEventListener('webglcontextlost',event=>{
    event.preventDefault();
    contextLost=true;
    notice('Graphics interrupted. Waiting for the browser to restore rendering.',Infinity);
  });
  canvas.addEventListener('webglcontextrestored',()=>{
    contextLost=false;
    notice('Rendering restored');
  });

  warp.value=String(speedIndex);
  reset(preset);
  playbackHUD();
  scene.renderer.setAnimationLoop(now=>{
    const elapsed=Math.min(.08,Math.max(0,(now-previous)/1000));
    previous=now;
    speed+=(STEPS[speedIndex]-speed)*(1-Math.exp(-elapsed*8));
    if(contextLost) return;
    if(!paused){
      remainder+=elapsed*speed/86400;
      let batch=0;
      while(remainder>=DT && batch<MAX_BATCH){
        physicsStep(reversed?-1:1);
        remainder-=DT;
        batch++;
      }
      if(batch===MAX_BATCH) remainder=Math.min(remainder,DT*4);
    }
    // At slow warp, interpolate over one fixed step so the view still advances each frame.
    const days=steps*DT, displayDays=days+(reversed?-1:1)*remainder;
    scene.draw(bodies,displayDays,now/1000,elapsed,displayDays-days);
    if(now-lastHUD>120){
      const body=find(selected);
      telemetry(body,body ? orbitalReference(body,bodies,primary()) : null,body?baseline.get(body.id)!:1);
      const simulatedDate=new Date(EPOCH+displayDays*86400000);
      const parts=DATE.formatToParts(simulatedDate);
      byId('epoch-clock').textContent=CLOCK.format(simulatedDate);
      byId('epoch').textContent=['year','month','day'].map(key=>parts.find(part=>part.type===key)?.value??'').join(' ').toUpperCase();
      lastHUD=now;
    }
    frames++;
    if(now-fpsStart>=800){
      byId('fps').textContent=Math.round(frames*1000/(now-fpsStart))+' FPS';
      frames=0;
      fpsStart=now;
    }
    if(now>messageUntil) byId('view-message').hidden=true;
  });
}

try { start(); }
catch(error){
  console.error(error);
  const viewport=byId('viewport');
  viewport.innerHTML='<div class="view-message">The 3D renderer could not start. Check that WebGL 2 and hardware acceleration are available, then reload.</div>';
  byId('engine-status').textContent='RENDERER UNAVAILABLE';
}