import { Vector3 } from 'three';
import { EARTH_MASS, G, orbitalReference, type Body } from '../physics/dynamics';
import { ephemeris } from './ephemeris';

const radians = Math.PI / 180;
export const presets = [
  { id: 'solar', name: 'Solar System', description: 'Eight planets, major moons and deep-space probes' },
  { id: 'binary', name: 'Binary Stars', description: 'Two suns with a circumbinary planet' },
  { id: 'rogue', name: 'Black Hole Flyby', description: 'A stellar-mass black hole crosses the outer system' },
  { id: 'trappist', name: 'TRAPPIST-1', description: 'Seven compact terrestrial exoplanets' },
] as const;
export type Preset = typeof presets[number]['id'];

function body(id: string, name: string, kind: Body['kind'], mass: number, radius: number, color: string, texture?: string): Body {
  return { id, name, kind, mass, radius, color, texture, position: new Vector3(), velocity: new Vector3() };
}

function orbit(child: Body, primary: Body, a: number, e: number, inclination: number, angle: number, apsis = 0, node = 0) {
  const anomaly = angle * radians;
  const p = a * (1 - e * e);
  const distance = p / (1 + e * Math.cos(anomaly));
  const v = Math.sqrt(G * (primary.mass + child.mass) / p);
  const vertical = new Vector3(0, 1, 0), horizontal = new Vector3(1, 0, 0);
  const orient = (vector: Vector3) => vector.applyAxisAngle(vertical, apsis * radians)
    .applyAxisAngle(horizontal, inclination * radians).applyAxisAngle(vertical, node * radians);
  child.position.copy(orient(new Vector3(distance * Math.cos(anomaly), 0, -distance * Math.sin(anomaly)))).add(primary.position);
  child.velocity.copy(orient(new Vector3(-v * Math.sin(anomaly), 0, -v * (e + Math.cos(anomaly))))).add(primary.velocity);
  child.parent = primary.id;
  return child;
}

function setState(child:Body,primary:Body) {
  const [x,y,z,vx,vy,vz]=ephemeris[child.id as keyof typeof ephemeris];
  child.position.set(x,y,z).add(primary.position);
  child.velocity.set(vx,vy,vz).add(primary.velocity);
  child.parent=primary.id;
  return child;
}

function solar() {
  const sun = body('sun', 'Sun', 'star', 1, 695700, '#ffab45', 'sun');
  const catalog = [
    ['mercury','Mercury',0.0553,2439.7,'#a49589','mercury',0.034,1407.6,''],
    ['venus','Venus',0.815,6051.8,'#e2b477','venus_surface',177.4,-5832.5,'#ffc58b'],
    ['earth','Earth',1,6371,'#72a6e6','earth_daymap',23.44,23.93,'#5d9dff'],
    ['mars','Mars',0.10745,3389.5,'#cf7558','mars',25.19,24.62,'#f49671'],
    ['jupiter','Jupiter',317.83,69911,'#dcb899','jupiter',3.13,9.93,''],
    ['saturn','Saturn',95.16,58232,'#e4c18d','saturn',26.73,10.7,''],
    ['uranus','Uranus',14.536,25362,'#8ad3dc','uranus',97.77,-17.24,'#9edee8'],
    ['neptune','Neptune',17.147,24622,'#567fd5','neptune',28.32,16.11,'#628afa'],
  ] as const;
  const planets = catalog.map(([id,name,mass,radius,color,texture,tilt,spin,atmosphere])=>
    setState({ ...body(id,name,'planet',mass*EARTH_MASS,radius,color,texture),
      tilt,spin,atmosphere,ring:id==='saturn'||id==='uranus' },sun));
  const moons = [
    ['moon','Moon','earth',0.01230,1737.4,'moon'],
    ['phobos','Phobos','mars',1.78e-9,11.27,''],
    ['deimos','Deimos','mars',2.47e-10,6.2,''],
    ['io','Io','jupiter',0.01495,1821.6,''],
    ['europa','Europa','jupiter',0.00804,1560.8,''],
    ['ganymede','Ganymede','jupiter',0.0248,2634.1,''],
    ['callisto','Callisto','jupiter',0.0180,2410.3,''],
    ['enceladus','Enceladus','saturn',0.000018,252.1,''],
    ['titan','Titan','saturn',0.0225,2574.7,''],
    ['titania','Titania','uranus',0.00059,788.9,''],
    ['triton','Triton','neptune',0.00358,1353.4,''],
  ] as const;
  const satellites = moons.map(([id,name,parent,mass,radius,texture]) => {
    const satellite=body(id,name,'moon',mass*EARTH_MASS,radius,'#b5a79a',texture||undefined);
    return setState(satellite,planets.find(planet=>planet.id===parent)!);
  });
  const voyager=setState(body('voyager','Voyager 1','probe',3.6e-28,0.002,'#7ae3dc'),sun);
  const earth=planets.find(planet=>planet.id==='earth')!;
  const webb=body('webb','James Webb','probe',3.1e-27,0.010,'#f8dc8f');
  webb.parent=sun.id;
  webb.position.copy(earth.position).multiplyScalar(1.01);
  webb.velocity.copy(earth.velocity).multiplyScalar(1.01);
  return [sun,...planets,...satellites,voyager,webb];
}

export function loadPreset(id: Preset) {
  let bodies: Body[];
  if (id === 'trappist') {
    const star = body('trappist','TRAPPIST-1','star',0.0898,84200,'#ff6844','sun');
    const rows = [
      ['b',0.01154,1.374,1.116],['c',0.01580,1.308,1.097],['d',0.02227,0.388,0.788],
      ['e',0.02925,0.692,0.920],['f',0.03849,1.039,1.045],['g',0.04683,1.321,1.129],['h',0.06189,0.326,0.755],
    ] as const;
    bodies = [star,...rows.map(([letter,a,mass,r],i) => orbit(body(letter,'TRAPPIST-1 '+letter,'planet',mass * EARTH_MASS,r * 6371,
      ['#c58766','#ba9b86','#94a9bf','#73aa93','#a2aaca','#7e9ba6','#9295a2'][i]), star,a,0.004,0.05,i*91))];
  } else if (id === 'binary') {
    const a = body('alpha','Helios A','star',1.05,720000,'#ffc464','sun');
    const b = orbit(body('beta','Helios B','star',0.72,505000,'#ff8659','sun'),a,0.42,0.12,0,40);
    const center = orbitalReference({ ...a, parent:'barycenter' },[a,b],a);
    bodies = [a,b,orbit(body('haven','Haven','planet',1.15*EARTH_MASS,6900,'#75a5d9','earth_daymap'),center,2.1,0.07,3,150),
      orbit({ ...body('atlas','Atlas','planet',87*EARTH_MASS,52210,'#d8b086','saturn'), ring:true, tilt:23 },center,4.8,0.12,7,300)];
  } else {
    bodies = solar();
    if (id === 'rogue') {
      const rogue = body('rogue','Rogue Black Hole','black hole',8,23.6,'#ff995b');
      rogue.position.set(-36,3,12);
      rogue.velocity.set(0.031,-0.002,-0.007);
      rogue.parent = 'sun';
      bodies.push(rogue);
    }
  }
  const total = bodies.reduce((sum,b) => sum + b.mass,0);
  const center = new Vector3(), momentum = new Vector3();
  bodies.forEach(b => { center.addScaledVector(b.position,b.mass/total); momentum.addScaledVector(b.velocity,b.mass/total); });
  bodies.forEach(b => { b.position.sub(center); b.velocity.sub(momentum); });
  return bodies;
}

export function spawnBody(kind: string, id: string, position: Vector3, velocity: Vector3, parent: Body): Body {
  const values: Record<string, [Body['kind'], number, number, string]> = {
    asteroid:['asteroid',4.7e-10,470,'#b2967d'],
    comet:['comet',1e-15,11,'#9cecff'],
    giant:['planet',0.000954,69911,'#e0b48e'],
    hole:['black hole',3,8.86,'#ff985a'],
  };
  const [type,mass,radius,color] = values[kind] ?? values.asteroid;
  return { ...body(id, {asteroid:'Asteroid',comet:'Comet',giant:'Gas Giant',hole:'Black Hole'}[kind] ?? 'Asteroid',
    type,mass,radius,color,kind === 'giant' ? 'jupiter' : undefined), position:position.clone(), velocity:velocity.clone(), parent:parent.id };
}