import { Vector3 } from 'three';

export const G = 0.0002959122082855911; // AU³ / solar mass / day²
export const AU_KM = 149597870.7;
export const EARTH_MASS = 3.00349e-6;

export interface Body {
  id: string;
  name: string;
  kind: 'star' | 'planet' | 'moon' | 'probe' | 'asteroid' | 'comet' | 'black hole';
  mass: number;
  radius: number; // km
  position: Vector3;
  velocity: Vector3;
  color: string;
  parent?: string;
  texture?: string;
  ring?: boolean;
  tilt?: number;
  spin?: number; // hours
  atmosphere?: string;
  fragment?: boolean;
}

export function copyBodies(bodies: Body[]): Body[] {
  return bodies.map(body => ({ ...body, position: body.position.clone(), velocity: body.velocity.clone() }));
}

interface Pair {
  a: Body;
  b: Body;
  softeningSquared: number;
  tidalDistanceSquared: number;
}

export class Integrator {
  private slow: Pair[] = [];
  private fast: Pair[] = [];
  private pairs: Pair[] = [];
  private initialized: Body[] = [];
  private masses: number[] = [];
  tidalEncounter = false;

  private prepare(bodies: Body[]) {
    if (this.initialized.length === bodies.length &&
        bodies.every((body, i) => body === this.initialized[i] && body.mass === this.masses[i])) return;
    this.initialized = [...bodies];
    this.masses = bodies.map(body => body.mass);
    this.pairs = [];
    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        const a = bodies[i], b = bodies[j];
        const weak = a.mass < b.mass ? a : b;
        const strong = weak === a ? b : a;
        const tidal = !weak.fragment && strong.mass > weak.mass * 10 && ['asteroid', 'comet', 'moon'].includes(weak.kind);
        this.pairs.push({ a, b, softeningSquared: Math.max((a.radius+b.radius)/AU_KM*.075,1e-10)**2,
          tidalDistanceSquared:tidal ? rocheLimit(strong,weak)**2 : 0 });
      }
    }
  }

  private kick(pairs: Pair[], dt: number) {
    for (const {a,b,softeningSquared,tidalDistanceSquared} of pairs) {
      const x=b.position.x-a.position.x, y=b.position.y-a.position.y, z=b.position.z-a.position.z;
      const squared=x*x+y*y+z*z;
      this.tidalEncounter ||= squared < tidalDistanceSquared;
      const r = squared + softeningSquared;
      const factor = dt * G / (r * Math.sqrt(r));
      const forward = factor * b.mass, backward = factor * a.mass;
      a.velocity.x += x*forward;
      a.velocity.y += y*forward;
      a.velocity.z += z*forward;
      b.velocity.x -= x*backward;
      b.velocity.y -= y*backward;
      b.velocity.z -= z*backward;
    }
  }

  step(bodies: Body[], dt: number) {
    this.prepare(bodies);
    this.tidalEncounter=false;
    this.slow.length=0;
    this.fast.length=0;
    // Split close pairs into a nested fixed-step Verlet update.
    for (const pair of this.pairs) {
      const {a,b,softeningSquared}=pair;
      const characteristic=G*(a.mass+b.mass)*(Math.abs(dt)*19)**2;
      const close=a.position.distanceToSquared(b.position)+softeningSquared < Math.cbrt(characteristic*characteristic);
      (close ? this.fast : this.slow).push(pair);
    }
    const subdivisions=this.fast.length ? 20 : 1;
    const inner=dt/subdivisions;
    this.kick(this.slow,dt/2);
    this.kick(this.fast,inner/2);
    for(let i=0;i<subdivisions;i++){
      for(const body of bodies) body.position.addScaledVector(body.velocity,inner);
      this.kick(this.fast,i===subdivisions-1 ? inner/2 : inner);
    }
    this.kick(this.slow,dt/2);
  }
}

export function rocheLimit(primary: Body, satellite: Body) {
  if (satellite.mass <= 0 || satellite.radius <= 0 || primary.mass <= satellite.mass) return 0;
  const coefficient = satellite.kind === 'moon' ? 1.26 : 2.44;
  return coefficient * satellite.radius / AU_KM * Math.cbrt(primary.mass / satellite.mass);
}

export function disrupt(bodies: Body[], serial: () => string) {
  const index = bodies.findIndex(body => !body.fragment && ['asteroid', 'comet', 'moon'].includes(body.kind)
    && bodies.some(primary => primary.id !== body.id && primary.mass > body.mass * 10
      && primary.position.distanceTo(body.position) < rocheLimit(primary, body)));
  if (index < 0 || bodies.length + 3 > 80) return null;
  const original = bodies[index];
  const plane = original.velocity.clone().normalize();
  if (!plane.lengthSq()) plane.set(1, 0, 0);
  const side = new Vector3().crossVectors(plane, new Vector3(0, 1, 0)).normalize();
  const fragments = Array.from({ length: 4 }, (_, i): Body => {
    const offset = plane.clone().multiplyScalar(i - 1.5).addScaledVector(side, i % 2 - 0.5);
    return { ...original, fragment: true, id: serial(), kind: 'asteroid', name: original.name + ' fragment ' + (i + 1),
      texture: undefined, mass: original.mass / 4, radius: original.radius * Math.cbrt(0.25),
      position: original.position.clone().addScaledVector(offset, original.radius / AU_KM * 2),
      velocity: original.velocity.clone().addScaledVector(offset, 0.00002), parent: original.parent };
  });
  bodies.splice(index, 1, ...fragments);
  return original.name;
}

export function orbitalReference(body: Body, bodies: Body[], primary: Body): Body {
  if (body.parent !== 'barycenter') return bodies.find(candidate => candidate.id === body.parent) ?? primary;
  const stars = bodies.filter(candidate => candidate.kind === 'star');
  const mass = stars.reduce((total, star) => total + star.mass,0);
  const position = new Vector3(), velocity = new Vector3();
  for (const star of stars) {
    position.addScaledVector(star.position,star.mass/mass);
    velocity.addScaledVector(star.velocity,star.mass/mass);
  }
  return { ...primary, id:'barycenter', name:'Stellar barycenter', mass, position, velocity };
}

export function elements(body: Body, primary: Body) {
  const r = body.position.clone().sub(primary.position);
  const v = body.velocity.clone().sub(primary.velocity);
  const distance = r.length();
  const mu = G * (body.mass + primary.mass);
  if (distance < 1e-12 || mu <= 0) return null;
  const h = r.clone().cross(v);
  const eVector = v.clone().cross(h).divideScalar(mu).sub(r.clone().divideScalar(distance));
  const e = eVector.length();
  const energy = v.lengthSq() / 2 - mu / distance;
  const a = -mu / (2 * energy);
  const p = h.lengthSq() / mu;
  return { distance, speed: v.length() * AU_KM / 86400, e, a, p,
    peri: p / (1 + e), apo: e < 1 ? p / (1 - e) : Infinity,
    period: a > 0 ? 2 * Math.PI * Math.sqrt(a ** 3 / mu) : Infinity,
    escape: Math.sqrt(2 * mu / distance) * AU_KM / 86400,
    axis: e > 1e-8 ? eVector.normalize() : r.normalize(), normal: h.normalize() };
}

export function surfaceGravity(body: Body) {
  return body.radius > 0 ? 6.6743e-11 * body.mass * 1.98847e30 / (body.radius * 1000) ** 2 : 0;
}