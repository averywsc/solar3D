import * as T from 'three';
import { G } from '../physics/dynamics';

export class Belt {
  readonly mesh: T.InstancedMesh;
  private rocks: { radius: number; phase: number; elevation: number; scale: number; rate: number }[] = [];
  private dummy = new T.Object3D();

  constructor(count = 2450) {
    let seed = 607;
    const random = () => ((seed = (Math.imul(seed,1664525)+1013904223) >>> 0) / 4294967296);
    this.mesh = new T.InstancedMesh(new T.DodecahedronGeometry(1,0),
      new T.MeshStandardMaterial({color:'#8c8075',roughness:1}),count);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
    for (let i=0;i<count;i++) {
      const radius=2.13+random()*1.18;
      this.rocks.push({radius,phase:random()*Math.PI*2,elevation:(random()-.5)*.32,
        scale:.015+random()**2*.038,rate:Math.sqrt(G/radius**3)});
      this.mesh.setColorAt(i,new T.Color().setHSL(.07+random()*.06,.08+random()*.17,.35+random()*.35));
    }
  }

  update(days:number, center:T.Vector3, map:(position:T.Vector3,target:T.Vector3)=>T.Vector3, trueScale:boolean) {
    const dummy=this.dummy;
    this.rocks.forEach((rock,i)=>{
      const angle=rock.phase+rock.rate*days;
      dummy.position.set(Math.cos(angle)*rock.radius,rock.elevation*Math.sin(angle+i),-Math.sin(angle)*rock.radius).add(center);
      map(dummy.position,dummy.position);
      dummy.rotation.set(i+days*.18,i*.54,days*.13);
      dummy.scale.setScalar(trueScale ? rock.scale*.004 : rock.scale);
      dummy.updateMatrix();
      this.mesh.setMatrixAt(i,dummy.matrix);
    });
    this.mesh.instanceMatrix.needsUpdate=true;
  }
}