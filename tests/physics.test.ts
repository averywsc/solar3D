import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Vector3 } from 'three';
import { loadPreset, presets, spawnBody } from '../src/data/presets';
import { AU_KM, disrupt, elements, G, Integrator, rocheLimit, type Body } from '../src/physics/dynamics';

function energy(bodies: Body[]) {
  let result=0;
  bodies.forEach((body,i)=>{
    result+=body.mass*body.velocity.lengthSq()/2;
    for(const other of bodies.slice(i+1)) result-=G*body.mass*other.mass/body.position.distanceTo(other.position);
  });
  return result;
}

test('Earth orbit has the expected 21 May 2009 elements',()=>{
  const [sun,,,earth]=loadPreset('solar');
  const orbit=elements(earth,sun)!;
  assert.ok(Math.abs(orbit.a-1)<.001);
  assert.ok(Math.abs(orbit.e-.01643)<.0001);
  assert.ok(Math.abs(orbit.period-365.62)<.1);
  assert.ok(orbit.peri<orbit.distance && orbit.distance<orbit.apo);
});

test('native moons remain intact and the solar system remains stable at maximum warp timestep',()=>{
  const bodies=loadPreset('solar');
  const integrator=new Integrator();
  const before=energy(bodies);
  const phobos=bodies.find(body=>body.id==='phobos')!;
  const mars=bodies.find(body=>body.id==='mars')!;
  assert.ok(phobos.position.distanceTo(mars.position)>rocheLimit(mars,phobos));
  for(let i=0;i<12*365;i++) {
    integrator.step(bodies,1/12);
    assert.equal(integrator.tidalEncounter,false);
  }
  assert.ok(Math.abs((energy(bodies)-before)/before)<.0001);
  assert.ok(phobos.position.distanceTo(mars.position)*AU_KM<9700);
});

test('all presets are centered and retain finite state through warp steps',()=>{
  for(const preset of presets){
    const bodies=loadPreset(preset.id);
    const integrator=new Integrator();
    const momentum=new Vector3();
    for(const body of bodies) momentum.addScaledVector(body.velocity,body.mass);
    assert.ok(momentum.length()<1e-15);
    for(let i=0;i<240;i++) integrator.step(bodies,1/12);
    assert.ok(bodies.every(body=>Number.isFinite(body.position.lengthSq()+body.velocity.lengthSq())));
  }
});

test('signed Verlet steps reverse a quiet two-body trajectory',()=>{
  const bodies=loadPreset('solar').filter(body=>['sun','earth'].includes(body.id));
  const start=bodies.map(body=>body.position.clone());
  const integrator=new Integrator();
  for(let i=0;i<600;i++) integrator.step(bodies,1/12);
  for(let i=0;i<600;i++) integrator.step(bodies,-1/12);
  bodies.forEach((body,i)=>assert.ok(body.position.distanceTo(start[i])<1e-12));
});

test('Roche breakup conserves mass and avoids recursive fragmentation',()=>{
  const [sun]=loadPreset('solar');
  const comet=spawnBody('comet','comet',sun.position.clone().add(new Vector3(.001,0,0)),new Vector3(0,0,1),sun);
  const bodies=[sun,comet];
  let serial=0;
  const next=()=>String(++serial);
  assert.equal(disrupt(bodies,next),'Comet');
  const debris=bodies.slice(1);
  assert.equal(debris.length,4);
  assert.equal(debris.reduce((sum,body)=>sum+body.mass,0),comet.mass);
  assert.equal(disrupt(bodies,next),null);
});