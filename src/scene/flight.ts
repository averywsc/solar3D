import { Euler, Matrix4, PerspectiveCamera, Quaternion, Vector3 } from 'three';

type Destination = { position: Vector3; target: Vector3 };
type Obstacle = { center: Vector3; radius: number };
const actions: Record<string,string> = {
  KeyW:'forward', ArrowUp:'forward', KeyS:'back', ArrowDown:'back',
  KeyA:'left', ArrowLeft:'left', KeyD:'right', ArrowRight:'right',
  KeyE:'up', KeyQ:'down', ShiftLeft:'boost', ShiftRight:'boost',
};

export class FlightCamera {
  active = false;
  destination: Destination | null = null;
  private readonly look=new Matrix4();
  private readonly heading=new Quaternion();
  private readonly held = new Map<string,string>();
  private readonly angles = new Euler(0,0,0,'YXZ');
  private readonly velocity = new Vector3();
  private readonly motion = new Vector3();
  private readonly offset = new Vector3();
  private drag: { id: number; x: number; y: number } | null = null;

  constructor(private readonly camera: PerspectiveCamera, private readonly canvas: HTMLCanvasElement) {
    canvas.addEventListener('pointerdown',event=>{
      if(!this.active || event.button!==0 || this.drag) return;
      this.drag={id:event.pointerId,x:event.clientX,y:event.clientY};
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener('pointermove',event=>{
      if(!this.drag || this.drag.id!==event.pointerId) return;
      this.destination=null;
      this.angles.y-=(event.clientX-this.drag.x)*.0035;
      this.angles.x=Math.max(-1.555,Math.min(1.555,this.angles.x-(event.clientY-this.drag.y)*.0035));
      this.drag.x=event.clientX;
      this.drag.y=event.clientY;
      this.camera.quaternion.setFromEuler(this.angles);
    });
    for(const type of ['pointerup','pointercancel','lostpointercapture']){
      canvas.addEventListener(type,event=>{
        if((event as PointerEvent).pointerId===this.drag?.id) this.drag=null;
      });
    }
    window.addEventListener('blur',()=>this.clearInputs());
    document.addEventListener('visibilitychange',()=>{if(document.hidden) this.clearInputs();});
  }

  setActive(value:boolean) {
    this.clearInputs();
    this.active=value;
    this.destination=null;
    if(value) this.angles.setFromQuaternion(this.camera.quaternion,'YXZ');
  }

  key(code:string, down:boolean) {
    const action=actions[code];
    if(!action || !this.active) return false;
    this.hold(code,action,down);
    return true;
  }

  hold(id:string, action:string, down:boolean) {
    if(down && this.active){
      if(action!=='boost') this.destination=null;
      this.held.set(id,action);
    }
    else this.held.delete(id);
  }

  private clearInputs() {
    this.held.clear();
    if(this.drag && this.canvas.hasPointerCapture(this.drag.id)) this.canvas.releasePointerCapture(this.drag.id);
    this.drag=null;
    this.velocity.set(0,0,0);
  }

  update(delta:number, obstacles:Iterable<Obstacle>) {
    const camera=this.camera;
    let clearance=Infinity;
    let nearbyRadius=0;
    for(const {center,radius} of obstacles){
      const buffer=radius*1.04+1e-7;
      this.offset.subVectors(camera.position,center);
      const distance=this.offset.length();
      if(distance<buffer){
        if(!distance) this.offset.set(0,0,1);
        camera.position.copy(center).add(this.offset.setLength(buffer));
      }
      if(distance-buffer<clearance){
        clearance=Math.max(0,distance-buffer);
        nearbyRadius=radius;
      }
    }
    const held=new Set(this.held.values());
    const direction=(positive:string,negative:string)=>Number(held.has(positive))-Number(held.has(negative));
    const speed=Math.min(65,Math.max(2e-7,nearbyRadius*.018,clearance*.73))*(held.has('boost')?4:1);
    this.motion.set(direction('right','left'),direction('up','down'),direction('back','forward'))
      .normalize().applyQuaternion(camera.quaternion).multiplyScalar(speed);
    this.velocity.lerp(this.motion,1-Math.exp(-delta*14));
    if(this.velocity.length()>speed) this.velocity.setLength(speed);
    if(this.destination){
      this.motion.subVectors(this.destination.position,camera.position).multiplyScalar(1-Math.exp(-delta*3.3));
      this.velocity.set(0,0,0);
    } else this.motion.copy(this.velocity).multiplyScalar(delta);
    const length=this.motion.length();
    let fraction=1;
    if(length>0){
      for(const {center,radius} of obstacles){
        const buffer=radius*1.04+1e-7;
        const offset=this.offset.subVectors(camera.position,center);
        const projection=offset.dot(this.motion)/length;
        if(projection>=0) continue;
        const discriminant=projection**2-offset.lengthSq()+buffer**2;
        if(discriminant<0) continue;
        const hit=-projection-Math.sqrt(discriminant);
        fraction=Math.min(fraction,Math.max(0,(hit-1e-8)/length));
      }
      camera.position.addScaledVector(this.motion,fraction);
    }
    if(this.destination){
      this.look.lookAt(camera.position,this.destination.target,camera.up);
      this.heading.setFromRotationMatrix(this.look);
      camera.quaternion.slerp(this.heading,1-Math.exp(-delta*7));
      this.angles.setFromQuaternion(camera.quaternion,'YXZ');
    }
    return Math.max(1e-8,Math.min(.035,clearance*.15));
  }
}