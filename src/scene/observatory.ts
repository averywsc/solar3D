import * as T from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FXAAPass } from 'three/addons/postprocessing/FXAAPass.js';
import { AU_KM, elements, orbitalReference, type Body } from '../physics/dynamics';
import { atmosphere, blackHole, photosphere, planet, rings, texture } from '../shaders/materials';
import { Belt } from './belt';
import { FlightCamera } from './flight';

const sphere=new T.SphereGeometry(1,96,64);
const ringGeo=new T.RingGeometry(1.27,2.43,256,6);
const up=new T.Vector3(0,1,0);
const origin=new T.Vector3();
const scale=12;
const MAX_TRAIL=120;

interface Visual {
  root:T.Group;
  axis:T.Group;
  globe:T.Mesh;
  radius:number;
  halo?:T.Mesh<T.SphereGeometry,T.ShaderMaterial>;
  ring?:T.Mesh<T.RingGeometry,T.ShaderMaterial>;
  tail?:T.Points<T.BufferGeometry,T.ShaderMaterial>;
  cloud?:T.Mesh<T.SphereGeometry,T.MeshStandardMaterial>;
  light?:{value:T.Vector3};
  path:T.Line<T.BufferGeometry,T.LineBasicMaterial>;
  trace:Line2;
  samples:T.Vector3[];
  label:HTMLButtonElement;
  marker:HTMLSpanElement;
}

export class Observatory {
  readonly scene=new T.Scene();
  readonly renderer:T.WebGLRenderer;
  readonly camera=new T.PerspectiveCamera(41,1,0.001,16000);
  readonly controls:OrbitControls;
  readonly flight:FlightCamera;
  readonly composer:EffectComposer;
  readonly visuals=new Map<string,Visual>();
  readonly raycaster=new T.Raycaster();
  readonly light=new T.PointLight('#fff2dc',.0,0,0);
  readonly companion=new T.PointLight('#ffd0a1',0,0,0);
  readonly grid:T.LineSegments<T.BufferGeometry,T.LineBasicMaterial>;
  readonly belt=new Belt();
  readonly aim=new T.ArrowHelper(new T.Vector3(1,0,0),origin,1,0xf6c779);
  readonly aimPath=new T.Line(new T.BufferGeometry(),new T.LineBasicMaterial({color:0xf7c979,transparent:true,opacity:.8}));
  readonly sky=new T.Scene();
  readonly skyTarget=new T.WebGLRenderTarget(1,1,{type:T.HalfFloatType,depthBuffer:false});
  selected:string|null=null;
  follow=false;
  paths=true;
  trails=true;
  labelsEnabled=true;
  trueScale=false;
  showBelt=true;
  private readonly skyGroup:T.Group;
  private readonly skySample:T.Group;
  private overviewFramed=false;
  private flightTarget:string|null=null;
  private readonly flightApproach=new T.Vector3();
  private readonly size=new T.Vector2();
  private readonly projected=new T.Vector3();
  private readonly interpolated=new T.Vector3();
  private readonly cameraRay=new T.Vector3();
  private readonly occlusion=new T.Vector3();
  private readonly look=new T.Vector3();
  private readonly lastFollow=new T.Vector3();
  private readonly home=new T.Vector3(2,78,124).normalize();
  private readonly overviewCenter=new T.Vector3();
  private readonly overviewPosition=new T.Vector3();
  private bodies:Body[]=[];
  private readonly desired=new T.Vector3();
  private transitioning=false;
  private tick=0;
  private lastTrail=NaN;
  private primary:Body|null=null;
  private labels:HTMLElement;

  constructor(private frame:HTMLElement, private onPick:(id:string)=>void) {
    this.renderer=new T.WebGLRenderer({antialias:false,powerPreference:'high-performance'});
    this.renderer.setClearColor(0x05070d);
    this.renderer.toneMapping=T.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure=1.08;
    this.renderer.shadowMap.enabled=true;
    this.renderer.shadowMap.type=T.PCFShadowMap;
    this.renderer.domElement.setAttribute('aria-label','Interactive 3D orbital viewport');
    this.frame.prepend(this.renderer.domElement);
    this.camera.position.copy(this.home).multiplyScalar(150);
    this.controls=new OrbitControls(this.camera,this.renderer.domElement);
    this.controls.enableDamping=true;
    this.controls.dampingFactor=.084;
    this.controls.minDistance=.002;
    this.controls.maxDistance=4000;
    this.controls.addEventListener('start',()=>{
      this.overviewFramed=false;
      if(!this.follow) this.transitioning=false;
    });
    this.flight=new FlightCamera(this.camera,this.renderer.domElement);
    this.composer=new EffectComposer(this.renderer,new T.WebGLRenderTarget(1,1,{type:T.HalfFloatType}));
    this.composer.addPass(new RenderPass(this.scene,this.camera));
    this.composer.addPass(new UnrealBloomPass(new T.Vector2(1,1),.45,.55,1.08));
    this.composer.addPass(new OutputPass());
    this.composer.addPass(new FXAAPass());
    this.scene.add(new T.AmbientLight('#b2c4e7',.27),this.light,this.companion);
    this.light.color.set('#fff2de');
    this.light.shadow.mapSize.set(384,384);
    this.light.shadow.autoUpdate=false;
    this.light.shadow.camera.near=.02;
    this.light.shadow.camera.far=280;
    this.light.shadow.bias=-.0015;
    this.light.castShadow=true;
    this.skyGroup=this.createSky();
    this.skySample=this.skyGroup.clone();
    this.scene.add(this.skyGroup);
    this.sky.add(this.skySample);
    this.grid=this.createGrid();
    this.scene.add(this.grid,this.belt.mesh,this.aim,this.aimPath);
    this.aim.visible=this.aimPath.visible=false;
    this.labels=document.createElement('div');
    this.labels.className='body-labels';
    frame.append(this.labels);
    new ResizeObserver(()=>this.resize()).observe(frame);
    this.resize();
  }

  private resize() {
    const width=Math.max(1,this.frame.clientWidth),height=Math.max(1,this.frame.clientHeight);
    const dpr=Math.min(window.devicePixelRatio,2,Math.sqrt(3200000/(width*height)));
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(width,height);
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(width,height);
    this.renderer.getDrawingBufferSize(this.size);
    this.skyTarget.setSize(Math.max(1,Math.round(this.size.x/2)),Math.max(1,Math.round(this.size.y/2)));
    this.camera.aspect=width/height;
    this.camera.updateProjectionMatrix();
    if(this.overviewFramed && this.primary && !this.flight.active) this.focus(null,true);
  }

  private createSky() {
    const group=new T.Group();
    const coords:number[]=[],colors:number[]=[],sizes:number[]=[];
    let seed=148;
    const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
    for(let i=0;i<9600;i++){
      const z=random()*2-1, a=random()*Math.PI*2, r=Math.sqrt(1-z*z);
      coords.push(3400*r*Math.cos(a),3400*z,3400*r*Math.sin(a));
      const brightness=.06+random()**2.5*.74;
      sizes.push(1.15+random()**5*2.55);
      colors.push(brightness*(.78+random()*.22),brightness*.87,brightness);
    }
    const geometry=new T.BufferGeometry();
    geometry.setAttribute('position',new T.Float32BufferAttribute(coords,3));
    geometry.setAttribute('color',new T.Float32BufferAttribute(colors,3));
    geometry.setAttribute('size',new T.Float32BufferAttribute(sizes,1));
    const stars=new T.Points(geometry,new T.ShaderMaterial({
      transparent:true,depthWrite:false,blending:T.AdditiveBlending,vertexColors:true,
      vertexShader:`attribute float size; varying vec3 tint;void main(){
        tint=color;gl_PointSize=size;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);
      }`,
      fragmentShader:`varying vec3 tint;void main(){
        float core=1.-smoothstep(.04,.49,length(gl_PointCoord-.5));
        gl_FragColor=vec4(tint,core*.74);
      }`
    }));
    const material=new T.MeshBasicMaterial({color:0,side:T.BackSide,depthWrite:false,fog:false});
    const dome=new T.Mesh(new T.SphereGeometry(4200,48,26),material);
    dome.renderOrder=-20;
    dome.rotation.set(.27,1.4,.75);
    texture('stars_milky_way.jpg',map=>{
      material.map=map;
      material.color.set('#6c7f9c');
      material.needsUpdate=true;
    });
    group.add(dome,stars);
    return group;
  }

  private createGrid() {
    const positions:number[]=[];
    const length=122, spacing=6, subdivisions=72;
    for(let axis=0;axis<2;axis++) {
      for(let row=-20;row<=20;row++) {
        for(let i=0;i<subdivisions;i++) {
          for(let end=0;end<2;end++) {
            const q=(i+end)/subdivisions*2*length-length;
            positions.push(axis ? q : row*spacing,-9,axis ? row*spacing : q);
          }
        }
      }
    }
    const geometry=new T.BufferGeometry();
    geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3).setUsage(T.DynamicDrawUsage));
    const grid=new T.LineSegments(geometry,new T.LineBasicMaterial({color:'#577da2',opacity:.22,transparent:true,depthWrite:false}));
    grid.frustumCulled=false;
    grid.visible=false;
    return grid;
  }

  toScene=(position:T.Vector3,target=new T.Vector3())=>{
    if(this.trueScale || !this.primary) return target.copy(position).multiplyScalar(scale);
    const center=this.primary.position;
    const r=target.subVectors(position,center).length();
    const distance=r<1.65 ? r*19 : 31.35+21*Math.log1p((r-1.65)*.56);
    return target.multiplyScalar(r ? distance/r : 19).addScaledVector(center,scale);
  };

  private radius(body:Body) {
    const physicalRadius=body.radius/AU_KM*scale;
    if(this.trueScale) return body.kind==='probe' ? Math.max(4e-7,physicalRadius) : physicalRadius;
    // Cinematic mode compresses distances while keeping major bodies in proportion.
    if(body.kind==='black hole') return 1.75;
    if(body.kind==='comet' || body.kind==='asteroid') return .15;
    if(body.kind==='probe') return .002;
    const radiusPerKm=this.primary?.id==='trappist' ? .12/84200 : 3.5/695700;
    return body.radius*radiusPerKm;
  }

  private createVisual(body:Body):Visual {
    const root=new T.Group(), axis=new T.Group();
    root.add(axis);
    axis.rotation.z=(body.tilt??0)*Math.PI/180;
    const earth=body.id==='earth';
    const lit=planet(body.color,body.kind==='star' ? undefined : body.texture,earth);
    let globe:T.Mesh=new T.Mesh(sphere,lit.material);
    if(body.kind==='star') {
      const material=photosphere(body.color);
      if(body.texture) texture(body.texture+'.jpg', map=>{
        material.uniforms.uMap.value=map;
        material.uniforms.uTextured.value=1;
      });
      globe=new T.Mesh(sphere,material);
    }
    if(body.kind==='black hole') {
      const material=blackHole();
      material.uniforms.uSky.value=this.skyTarget.texture;
      material.uniforms.uViewport.value=this.size;
      material.uniforms.uHasSky.value=1;
      globe=new T.Mesh(new T.PlaneGeometry(7,7),material);
      globe.renderOrder=8;
    }
    if(body.kind==='probe') globe=new T.Mesh(new T.OctahedronGeometry(1),new T.MeshStandardMaterial({
      color:body.color,metalness:.25,roughness:.5,emissive:body.color,emissiveIntensity:.22}));
    globe.userData.id=body.id;
    globe.castShadow=body.kind!=='star'&&body.kind!=='black hole';
    globe.receiveShadow=globe.castShadow;
    axis.add(globe);
    const path=new T.Line(new T.BufferGeometry(),new T.LineBasicMaterial({
      color:body.color,transparent:true,opacity:.29,depthWrite:false}));
    const trailGeometry=new LineGeometry().setPositions(new Float32Array(MAX_TRAIL*3));
    const trace=new Line2(trailGeometry,new LineMaterial({
      color:body.color,linewidth:1.4,transparent:true,opacity:.42,depthWrite:false}));
    trace.visible=false;
    trace.frustumCulled=false;
    this.scene.add(root,path,trace);
    const label=document.createElement('button');
    label.className='body-label';
    label.type='button';
    label.textContent=body.name;
    label.style.setProperty('--body-color',body.color);
    label.addEventListener('click',()=>this.onPick(body.id));
    const marker=document.createElement('span');
    marker.className='body-marker';
    marker.setAttribute('aria-hidden','true');
    marker.hidden=true;
    this.labels.append(marker,label);
    const visual:Visual={root,axis,globe,radius:1,path,trace,samples:[],label,marker,light:lit.illumination};
    if(body.atmosphere || body.kind==='star'){
      visual.halo=new T.Mesh(sphere,atmosphere(body.atmosphere??body.color,body.kind==='star'));
      visual.halo.scale.setScalar(body.kind==='star' ? 1.19 : 1.045);
      axis.add(visual.halo);
    }
    if(earth){
      const material=new T.MeshStandardMaterial({color:'#e1e8f4',transparent:true,opacity:.47,depthWrite:false,
        roughness:.90,alphaTest:.045});
      const cloud=new T.Mesh(sphere,material);
      cloud.scale.setScalar(1.012);
      cloud.visible=false;
      texture('earth_clouds.jpg',map=>{
        material.alphaMap=map;
        material.needsUpdate=true;
        cloud.visible=true;
      },true);
      visual.cloud=cloud;
      axis.add(cloud);
    }
    if(body.ring) {
      visual.ring=new T.Mesh(ringGeo,rings(body.id==='uranus'));
      visual.ring.rotation.x=-Math.PI/2;
      axis.add(visual.ring);
    }
    if(body.kind==='comet') {
      const coordinates:number[]=[], ages:number[]=[];
      for(let i=0;i<340;i++){
        const age=i/340, theta=i*2.399963;
        coordinates.push(age*6,Math.sin(theta)*age*.44,Math.cos(theta)*age*.44);
        ages.push(age);
      }
      const geometry=new T.BufferGeometry();
      geometry.setAttribute('position',new T.Float32BufferAttribute(coordinates,3));
      geometry.setAttribute('age',new T.Float32BufferAttribute(ages,1));
      visual.tail=new T.Points(geometry,new T.ShaderMaterial({
        transparent:true,blending:T.AdditiveBlending,depthWrite:false,
        vertexShader:`attribute float age;varying float a;void main(){a=age;vec4 v=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*v;gl_PointSize=clamp(17./-v.z,1.,7.);}`,
        fragmentShader:`varying float a;void main(){float c=max(0.,1.-2.*length(gl_PointCoord-.5));gl_FragColor=vec4(.28,1.15,2.,c*(1.-a)*.7);}`
      }));
      root.add(visual.tail);
    }
    return visual;
  }

  reset() {
    this.synchronize([]);
    this.primary=null;
    this.lastTrail=NaN;
    this.cancelAim();
  }

  synchronize(bodies:Body[]) {
    this.bodies=bodies;
    const ids=new Set(bodies.map(body=>body.id));
    for(const [id,visual] of this.visuals) {
      if(ids.has(id)) continue;
      this.scene.remove(visual.root,visual.path,visual.trace);
      visual.root.traverse(object=>{
        if(!(object instanceof T.Mesh || object instanceof T.Points)) return;
        if(object.geometry!==sphere && object.geometry!==ringGeo) object.geometry.dispose();
        if(!Array.isArray(object.material)) object.material.dispose();
      });
      for(const line of [visual.path,visual.trace]) {
        line.geometry.dispose();
        line.material.dispose();
      }
      visual.label.remove();
      visual.marker.remove();
      this.visuals.delete(id);
    }
    this.primary=bodies.find(body=>body.kind==='star')??bodies[0]??null;
    bodies.forEach(body=>{ if(!this.visuals.has(body.id)) this.visuals.set(body.id,this.createVisual(body)); });
    this.positionBodies(bodies,0,0);
  }

  private positionBodies(bodies:Body[],days:number,clock:number,offset=0) {
    if(!this.primary) return;
    this.toScene(this.primary.position,this.light.position);
    const companion=bodies.find(body=>body.kind==='star' && body!==this.primary);
    this.companion.intensity=companion ? 1.65 : 0;
    if(companion) this.toScene(companion.position,this.companion.position);
    const focused=bodies.find(body=>body.id===this.selected);
    if(focused && focused.kind!=='star'){
      const distance=this.toScene(focused.position,this.projected).distanceTo(this.light.position);
      const physical=focused.position.distanceTo(this.primary.position);
      this.light.intensity=1.95*Math.min(1.39,Math.max(.65,1.24/(Math.max(1,physical)**.16)));
      this.light.shadow.camera.near=Math.max(.00002,Math.min(.1,distance*.12));
    } else this.light.intensity=2.05;
    for(const body of bodies){
      const visual=this.visuals.get(body.id)!;
      const parent=bodies.find(candidate=>candidate.id===body.parent);
      this.toScene(this.interpolated.copy(body.position).addScaledVector(body.velocity,offset),visual.root.position);
      if(!this.trueScale && (body.kind==='moon'|| body.kind==='probe' && parent?.kind==='planet') && parent){
        const parentPosition=this.toScene(parent.position);
        const offset=visual.root.position.sub(parentPosition);
        const parentRadius=this.radius(parent);
        offset.setLength(parentRadius*(1.36+Math.sqrt(body.position.distanceTo(parent.position)*160)));
        visual.root.position.add(parentPosition);
      }
      const radius=visual.radius=this.radius(body);
      visual.axis.scale.setScalar(radius);
      if(body.kind!=='black hole') visual.globe.rotation.y=body.spin ? (days*24/body.spin)*Math.PI*2 : clock*(body.kind==='star'?.08:.05);
      if(visual.cloud) visual.cloud.rotation.y=visual.globe.rotation.y+days*.18;
      if(visual.halo) {
        visual.halo.material.uniforms.uTime.value=clock;
        visual.halo.material.uniforms.uLight.value.copy(this.light.position);
      }
      if(visual.globe.material instanceof T.ShaderMaterial && visual.globe.material.uniforms.uTime)
        visual.globe.material.uniforms.uTime.value=clock;
      visual.light?.value.copy(this.light.position);
      if(visual.ring) {
        visual.ring.material.uniforms.uLight.value.copy(this.light.position);
        visual.ring.material.uniforms.uCenter.value.copy(visual.root.position);
        visual.ring.material.uniforms.uRadius.value=radius;
      }
      if(visual.tail) {
        const direction=this.projected.copy(body.velocity).negate();
        if(direction.lengthSq()) visual.tail.quaternion.setFromUnitVectors(new T.Vector3(1,0,0),direction.normalize());
        visual.tail.scale.setScalar(this.trueScale ? .002 : .7);
      }
    }
  }

  flyTo(id:string) {
    const visual=this.visuals.get(id);
    if(!this.flight.active || !visual) return;
    this.selected=id;
    this.flightTarget=id;
    const target=visual.root.position;
    const radial=this.flightApproach.subVectors(this.camera.position,target);
    if(!radial.lengthSq()) radial.copy(this.home);
    radial.normalize();
    const sunlight=this.projected.subVectors(this.light.position,target).normalize();
    if(radial.dot(sunlight)<.3) radial.addScaledVector(sunlight,.44).normalize();
    this.flight.destination={position:target.clone(),target};
  }

  startFlight() {
    this.flightTarget=null;
    this.overviewFramed=false;
    this.transitioning=false;
    this.follow=false;
    this.controls.enabled=false;
    this.flight.setActive(true);
  }

  focus(id:string|null,jump=false) {
    if(this.flight.active){
      this.flight.setActive(false);
      this.controls.enabled=true;
      jump=true;
    }
    this.selected=id;
    this.follow=Boolean(id && this.visuals.has(id));
    this.overviewFramed=!this.follow;
    if(this.overviewFramed) this.fitOverview();
    this.transitioning=true;
    this.lastFollow.set(NaN,NaN,NaN);
    if(jump) this.updateCamera(1,true);
  }

  private fitOverview() {
    this.overviewCenter.copy(this.primary ? this.toScene(this.primary.position) : origin);
    const right=new T.Vector3().crossVectors(up,this.home).normalize();
    const vertical=new T.Vector3().crossVectors(this.home,right);
    const tanY=Math.tan(T.MathUtils.degToRad(this.camera.fov/2))*.84;
    const tanX=tanY*this.camera.aspect;
    let distance=.1;
    for(const body of this.bodies){
      if(body.kind==='moon'||body.kind==='probe') continue;
      const visual=this.visuals.get(body.id)!;
      const reference=this.primary && orbitalReference(body,this.bodies,this.primary);
      const apo=reference && reference!==body ? elements(body,reference)?.apo : undefined;
      const points=reference && Number.isFinite(apo) ? this.conic(body,reference,48) : [];
      points.push(visual.root.position.clone());
      const margin=visual.radius*(body.ring ? 2.43 : 1);
      for(const point of points){
        point.sub(this.overviewCenter);
        const spread=Math.max((Math.abs(point.dot(right))+margin)/tanX,(Math.abs(point.dot(vertical))+margin)/tanY);
        distance=Math.max(distance,point.dot(this.home)+margin+spread);
      }
    }
    this.overviewPosition.copy(this.overviewCenter).addScaledVector(this.home,distance);
  }

  private updateCamera(delta:number,instant=false) {
    const visual=this.follow && this.selected ? this.visuals.get(this.selected) : undefined;
    const fraction=instant ? 1 : 1-Math.exp(-delta*5.4);
    if(this.transitioning){
      if(visual){
        const target=visual.root.position;
        const radial=this.desired.subVectors(this.light.position,target);
        radial.y=0;
        if(radial.lengthSq()<1e-12) radial.set(0,0,1);
        radial.normalize().applyAxisAngle(up,-.78);
        radial.y=visual.ring ? .14 : .40;
        const framing=visual.radius*(visual.ring ? 8.2 : 5.8)*Math.max(1,1.05/this.camera.aspect);
        const distance=Math.max(framing,1e-7);
        this.desired.normalize().multiplyScalar(distance).add(target);
        this.look.copy(target);
        this.controls.minDistance=Math.max(1e-7,visual.radius*1.18);
      } else {
        this.desired.copy(this.overviewPosition);
        this.look.copy(this.overviewCenter);
        this.controls.minDistance=.002;
      }
      this.camera.position.lerp(this.desired,fraction);
      this.controls.target.lerp(this.look,fraction);
      if(instant || this.camera.position.distanceTo(this.desired)<Math.max(visual?.radius??1,.001)*.012) this.transitioning=false;
    } else if(visual && Number.isFinite(this.lastFollow.x)){
      const offset=this.desired.subVectors(visual.root.position,this.lastFollow);
      this.camera.position.add(offset);
      this.controls.target.add(offset);
    }
    const near=visual ? Math.max(1e-8,Math.min(.04,visual.radius*.09)) : .035;
    if(this.camera.near!==near){
      this.camera.near=near;
      this.camera.updateProjectionMatrix();
    }
    if(visual) this.lastFollow.copy(visual.root.position);
    this.controls.update();
  }

  setScale(value:boolean,bodies:Body[]) {
    this.trueScale=value;
    for(const visual of this.visuals.values()) visual.samples.length=0;
    this.positionBodies(bodies,0,0);
    this.focus(this.follow ? this.selected : null,true);
  }

  conic(body:Body,primary:Body, count=145, moonVisual=false) {
    const orbit=elements(body,primary);
    if(!orbit || orbit.p<1e-12 || !orbit.normal.lengthSq()) return [];
    const end=orbit.e<1 ? Math.PI : Math.acos(-1/orbit.e)*.91;
    const side=new T.Vector3().crossVectors(orbit.normal,orbit.axis);
    const anchor=this.toScene(primary.position);
    return Array.from({length:count},(_,i)=>{
      const angle=-end+2*end*i/(count-1);
      const radius=orbit.p/(1+orbit.e*Math.cos(angle));
      const point=new T.Vector3().addScaledVector(orbit.axis,radius*Math.cos(angle)).addScaledVector(side,radius*Math.sin(angle));
      if(moonVisual && !this.trueScale)
        return point.setLength(this.radius(primary)*(1.36+Math.sqrt(radius*160))).add(anchor);
      return this.toScene(point.add(primary.position));
    });
  }

  private updateTracks(bodies:Body[],days:number) {
    const sampleTime=!Number.isFinite(this.lastTrail) || Math.abs(days-this.lastTrail)>.09;
    if(sampleTime) this.lastTrail=days;
    for(const body of bodies) {
      const visual=this.visuals.get(body.id)!;
      const parent=this.primary && orbitalReference(body,bodies,this.primary);
      const nearMoon=body.kind!=='moon'|| (this.follow && (body.id===this.selected|| body.parent===this.selected));
      visual.path.visible=this.paths && !this.flight.active && !!parent && parent!==body && nearMoon;
      const canTrail=this.trails && !this.flight.active && body.kind!=='moon' && body!==this.primary;
      if(sampleTime && canTrail){
        visual.samples.push(visual.root.position.clone());
        if(visual.samples.length>MAX_TRAIL) visual.samples.shift();
        if(visual.samples.length>1) {
          const geometry=visual.trace.geometry;
          const start=geometry.attributes.instanceStart as T.InterleavedBufferAttribute;
          const end=geometry.attributes.instanceEnd as T.InterleavedBufferAttribute;
          geometry.instanceCount=visual.samples.length-1;
          for(let i=0;i<geometry.instanceCount;i++){
            const a=visual.samples[i],b=visual.samples[i+1];
            start.setXYZ(i,a.x,a.y,a.z);
            end.setXYZ(i,b.x,b.y,b.z);
          }
          start.data.needsUpdate=true;
        }
      }
      visual.trace.visible=canTrail && visual.samples.length>1;
      if(visual.path.visible && parent){
        visual.path.material.opacity=body.id===this.selected ? .44 : body.kind==='moon' ? .14 : .22;
        const points=this.conic(body,parent,145,body.kind==='moon');
        if(points.length){
          visual.path.geometry.setFromPoints(points);
          visual.path.geometry.setDrawRange(0,points.length);
          visual.path.geometry.computeBoundingSphere();
        } else visual.path.geometry.setDrawRange(0,0);
      }
    }
  }

  private updateGrid(bodies:Body[]) {
    const wells=bodies.map(body=>({
      point:this.visuals.get(body.id)!.root.position,
      weight:98*body.mass,
      softening:Math.max(.4,this.visuals.get(body.id)!.radius),
    }));
    const attr=this.grid.geometry.attributes.position;
    for(let i=0;i<attr.count;i++){
      const x=attr.getX(i), z=attr.getZ(i);
      let potential=0;
      for(const {point,weight,softening} of wells){
        const dx=x-point.x,dz=z-point.z;
        potential+=weight/Math.sqrt(dx*dx+dz*dz+softening*softening);
      }
      attr.setY(i,-8-9*Math.log1p(potential*.4));
    }
    attr.needsUpdate=true;
  }

  private updateForeground() {
    const target=this.follow && this.selected ? this.visuals.get(this.selected) : undefined;
    const distance=target ? this.cameraRay.subVectors(target.root.position,this.camera.position).length() : 0;
    if(distance) this.cameraRay.divideScalar(distance);
    for(const visual of this.visuals.values()){
      visual.root.visible=true;
      if(this.trueScale || !target || visual===target || !distance) continue;
      const offset=this.occlusion.subVectors(visual.root.position,this.camera.position);
      const along=offset.dot(this.cameraRay);
      const clearance=target.radius*.92*along/distance+visual.radius*(visual.ring ? 2 : 1.12);
      if(along>-visual.radius && along<distance*.93 && offset.addScaledVector(this.cameraRay,-along).lengthSq()<clearance**2)
        visual.root.visible=false;
    }
  }

  private updateLabels(bodies:Body[]){
    const height=this.frame.clientHeight,width=this.frame.clientWidth;
    const focused=this.selected ? this.visuals.get(this.selected) : undefined;
    const occupied:{left:number;top:number;right:number;bottom:number}[]=[];
    const ordered=[...bodies].sort((a,b)=>Number(b.id===this.selected)-Number(a.id===this.selected));
    for(const body of ordered){
      const visual=this.visuals.get(body.id)!;
      const isSelected=body.id===this.selected;
      const satellite=body.kind==='moon'||body.kind==='probe';
      const p=this.projected.copy(visual.root.position);
      p.y+=visual.radius*.80;
      p.project(this.camera);
      const x=(p.x+1)*width/2,y=(1-p.y)*height/2;
      let visible=visual.root.visible && this.labelsEnabled && p.z<1 && p.z>-1 && x>12 && x<width-12 && y>18 && y<height-18;
      if(satellite && !isSelected && (!this.follow || (body.parent!==this.selected && focused?.root.position.distanceTo(visual.root.position)!>7))) visible=false;
      if(isSelected && this.follow) visible=false;
      const approximateRadius=visual.radius*height/(.75*Math.max(1e-7,this.camera.position.distanceTo(visual.root.position)));
      if(isSelected && this.flight.active && approximateRadius>24) visible=false;
      visual.marker.hidden=!visible || approximateRadius>=3;
      if(!visual.marker.hidden){
        p.copy(visual.root.position).project(this.camera);
        visual.marker.style.transform='translate('+Math.round((p.x+1)*width/2)+'px,'+Math.round((1-p.y)*height/2)+'px) translate(-50%,-50%)';
      }
      if(visible){
        const labelWidth=body.name.length*6+10;
        const position=[[9,-17],[-labelWidth-9,-17],[9,6],[-labelWidth-9,6]]
          .map(([dx,dy])=>({left:x+dx,top:y+dy,right:x+dx+labelWidth,bottom:y+dy+18}))
          .find(rect=>rect.left>=6 && rect.right<width-6 && rect.top>=6 && rect.bottom<height-6
            && !occupied.some(other=>rect.left<other.right+4 && rect.right>other.left-4 &&
              rect.top<other.bottom+3 && rect.bottom>other.top-3));
        if(position){
          occupied.push(position);
          visual.label.style.transform='translate('+Math.round(position.left)+'px,'+Math.round(position.top)+'px)';
          visual.label.classList.toggle('selected',isSelected);
        }
        visible=Boolean(position);
      }
      visual.label.hidden=!visible;
    }
  }

  draw(bodies:Body[],days:number,clock:number,delta:number,offset:number) {
    this.tick++;
    this.positionBodies(bodies,days,clock,offset);
    if(this.flight.active){
      const destination=this.flight.destination;
      const target=this.flightTarget ? this.visuals.get(this.flightTarget) : undefined;
      if(destination && target){
        const framing=target.radius*(target.ring ? 8.2 : 5.8)*Math.max(1,1.05/this.camera.aspect);
        destination.position.copy(target.root.position).addScaledVector(this.flightApproach,Math.max(1e-7,framing));
      } else this.flight.destination=null;
      const obstacles=[...this.visuals.values()].map(visual=>({center:visual.root.position,radius:visual.radius}));
      const near=this.flight.update(delta,obstacles);
      if(Math.abs(near-this.camera.near)>this.camera.near*.05){
        this.camera.near=near;
        this.camera.updateProjectionMatrix();
      }
    } else this.updateCamera(delta);
    this.skyGroup.position.copy(this.camera.position);
    this.skySample.position.copy(this.camera.position);
    this.camera.updateMatrixWorld();
    if(this.tick%7===1) this.updateTracks(bodies,days);
    this.belt.mesh.visible=this.showBelt;
    if(this.showBelt && this.primary && this.tick%2===0) this.belt.update(days,this.primary.position,this.toScene,this.trueScale);
    if(this.grid.visible && this.tick%5===1) this.updateGrid(bodies);
    if(this.tick%5===1) this.light.shadow.needsUpdate=true;
    this.updateForeground();
    this.updateLabels(bodies);
    const blackHoles=bodies.filter(body=>body.kind==='black hole');
    if(blackHoles.length){
      for(const body of blackHoles) this.visuals.get(body.id)!.globe.quaternion.copy(this.camera.quaternion);
      this.renderer.setRenderTarget(this.skyTarget);
      this.renderer.render(this.sky,this.camera);
      this.renderer.setRenderTarget(null);
    }
    this.composer.render(delta);
  }

  private pointer(event:PointerEvent){
    const rect=this.renderer.domElement.getBoundingClientRect();
    const coords=new T.Vector2((event.clientX-rect.left)/rect.width*2-1,1-(event.clientY-rect.top)/rect.height*2);
    this.raycaster.setFromCamera(coords,this.camera);
  }

  pick(event:PointerEvent){
    this.pointer(event);
    return this.raycaster.intersectObjects([...this.visuals.values()].filter(visual=>visual.root.visible).map(visual=>visual.globe),false)[0]?.object.userData.id as string|undefined;
  }

  plane(event:PointerEvent){
    this.pointer(event);
    const center=this.primary?.position??origin;
    const point=this.raycaster.ray.intersectPlane(new T.Plane(up,-center.y*scale),new T.Vector3());
    if(!point || point.distanceTo(this.camera.position)>15000) return null;
    if(this.trueScale) return point.multiplyScalar(1/scale);
    const offset=point.addScaledVector(center,-scale);
    const r=offset.length();
    const distance=r<31.35 ? r/19 : 1.65+Math.expm1(Math.min(10,(r-31.35)/21))/.56;
    return offset.setLength(distance).add(center);
  }

  showAim(body:Body,primary:Body,drag:T.Vector3){
    const start=this.toScene(body.position);
    const end=this.toScene(body.position.clone().add(drag));
    const direction=end.sub(start);
    this.aim.visible=direction.lengthSq()>1e-10;
    if(this.aim.visible){
      const length=direction.length();
      this.aim.position.copy(start);
      this.aim.setDirection(direction.normalize());
      this.aim.setLength(length,Math.min(length*.3,.45),Math.min(length*.20,.25));
    }
    this.aimPath.geometry.dispose();
    this.aimPath.geometry=new T.BufferGeometry().setFromPoints(this.conic(body,primary));
    this.aimPath.visible=this.aimPath.geometry.attributes.position.count>0;
  }

  cancelAim(){
    this.aim.visible=this.aimPath.visible=false;
  }
}