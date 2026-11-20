import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PerspectiveCamera, Vector3 } from 'three';
import { FlightCamera } from '../src/scene/flight';

Object.assign(globalThis,{window:new EventTarget(),document:new EventTarget()});

test('free flight moves forward and clears held movement on exit',()=>{
  const camera=new PerspectiveCamera();
  const flight=new FlightCamera(camera,new EventTarget() as HTMLCanvasElement);
  flight.setActive(true);
  assert.equal(flight.key('KeyW',true),true);
  flight.update(.1,[]);
  assert.ok(camera.position.z<0);
  flight.setActive(false);
  flight.setActive(true);
  const previous=camera.position.clone();
  flight.update(.1,[]);
  assert.ok(camera.position.equals(previous));
});

test('boost cannot cross a planetary surface, and the camera can fly away',()=>{
  const camera=new PerspectiveCamera();
  camera.position.z=4;
  const flight=new FlightCamera(camera,new EventTarget() as HTMLCanvasElement);
  const planet={center:new Vector3(),radius:1};
  flight.setActive(true);
  flight.key('KeyW',true);
  flight.key('ShiftLeft',true);
  const near=flight.update(2,[planet]);
  assert.ok(camera.position.z>=1.04);
  assert.ok(Number.isFinite(near));
  const previous=camera.position.z;
  flight.key('KeyW',false);
  flight.key('KeyS',true);
  flight.update(1,[planet]);
  assert.ok(camera.position.z>previous);
});
test('assisted flight approaches a destination and hands control back on steering input',()=>{
  const camera=new PerspectiveCamera();
  camera.position.set(0,0,40);
  const flight=new FlightCamera(camera,new EventTarget() as HTMLCanvasElement);
  const target=new Vector3();
  flight.setActive(true);
  flight.destination={position:new Vector3(0,0,5),target};
  for(let step=0;step<100;step++) flight.update(.02,[{center:target,radius:1}]);
  assert.ok(Math.abs(camera.position.z-5)<.06);
  flight.key('KeyD',true);
  assert.equal(flight.destination,null);
  flight.update(.1,[{center:target,radius:1}]);
  assert.ok(camera.position.x>0);
});
