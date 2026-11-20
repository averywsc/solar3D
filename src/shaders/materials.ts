import * as T from 'three';

const loader = new T.TextureLoader();
const cache = new Map<string,T.Texture>();
const base = import.meta.env.BASE_URL + 'textures/';
export function texture(name: string, onLoad?: (texture: T.Texture) => void, linear = false) {
  const existing = cache.get(name);
  if (existing) {
    if (existing.image) onLoad?.(existing);
    else if (onLoad) existing.addEventListener('ready' as never, () => onLoad(existing));
    return existing;
  }
  const result = loader.load(base + name, value => {
    onLoad?.(value);
    value.dispatchEvent({ type: 'ready' } as never);
  }, undefined, () => cache.delete(name));
  result.colorSpace = linear ? T.NoColorSpace : T.SRGBColorSpace;
  result.anisotropy = 4;
  cache.set(name,result);
  return result;
}

const sphereVertex = /* glsl */`
varying vec3 vNormal, vWorld, vModel;
varying vec2 vUv;
void main(){
  vUv=uv; vModel=position;
  vNormal=normalize(mat3(modelMatrix)*normal);
  vWorld=(modelMatrix*vec4(position,1.)).xyz;
  gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);
}`;

const noise = /* glsl */`
float hash(vec3 p){p=fract(p*.3183099+.13);p*=17.;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
float noise3(vec3 p){
  vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
    mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);
}
float fbm(vec3 p){float a=.5, s=0.;for(int i=0;i<5;i++){s+=a*noise3(p);p=p*2.06+3.71;a*=.5;}return s;}
`;

const output = `#include <tonemapping_fragment>
#include <colorspace_fragment>`;

export function photosphere(color: string) {
  return new T.ShaderMaterial({
    vertexShader:sphereVertex,
    uniforms:{ uTime:{value:0}, uColor:{value:new T.Color(color)}, uMap:{value:null}, uTextured:{value:0} },
    fragmentShader:/* glsl */`
      varying vec3 vNormal,vWorld,vModel; varying vec2 vUv;
      uniform float uTime,uTextured; uniform vec3 uColor; uniform sampler2D uMap;
      ${noise}
      void main(){
        vec3 p=normalize(vModel);
        float flow=fbm(p*7.+vec3(uTime*.045,0.,0.));
        float cells=fbm(p*42.+flow*2.+uTime*.025);
        float flare=pow(max(0.,fbm(p*9.+vec3(0,uTime*.095,0))-.44)*2.,4.);
        float limb=.42+.58*sqrt(max(0.,dot(normalize(vNormal),normalize(cameraPosition-vWorld))));
        vec3 detail=mix(vec3(1.),texture2D(uMap,vUv).rgb*1.4,uTextured*.48);
        vec3 hot=mix(uColor*.52,vec3(1.4,1.06,.66),smoothstep(.18,.79,cells+flare));
        gl_FragColor=vec4(hot*detail*limb*(2.1+flare*6.),1.);
        ${output}
      }`
  });
}

export function atmosphere(color: string, corona = false) {
  return new T.ShaderMaterial({
    vertexShader:sphereVertex, transparent:true, blending:T.AdditiveBlending,
    depthWrite:false, side:T.BackSide,
    uniforms:{ uColor:{value:new T.Color(color)}, uLight:{value:new T.Vector3()}, uTime:{value:0}, uCorona:{value:Number(corona)} },
    fragmentShader:/* glsl */`
      varying vec3 vNormal,vWorld,vModel; uniform vec3 uColor,uLight; uniform float uTime,uCorona;
      ${noise}
      void main(){
        vec3 n=normalize(vNormal), view=normalize(cameraPosition-vWorld), sun=normalize(uLight-vWorld);
        float rim=pow(1.-abs(dot(n,view)),3.2);
        float day=smoothstep(-.25,.48,dot(n,sun));
        float mie=pow(max(0.,dot(sun,view)),8.);
        float flicker=.72+fbm(normalize(vModel)*12.+uTime*.12)*1.9;
        float alpha=mix(rim*(day*.44+mie*.19),rim*flicker*.65,uCorona);
        gl_FragColor=vec4(uColor*(.9+uCorona*.8),alpha);
        ${output}
      }`
  });
}

export function planet(color: string, map?: string, earth = false) {
  const material = new T.MeshStandardMaterial({ color, roughness:earth ? .82 : .94, metalness:0 });
  const illumination = { value:new T.Vector3() };
  if (map) texture(map+'.jpg', value => {
    material.map=value;
    material.color.set('#ffffff');
    material.needsUpdate=true;
  });

  if (earth) {
    texture('earth_normal_map.jpg', value => {
      material.normalMap=value;
      material.normalScale.set(.42,.42);
      material.needsUpdate=true;
    },true);
  }
  const specular = { value:earth ? texture('earth_specular_map.jpg',undefined,true) : null };
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vPlanetModel;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPlanetModel=normalize(position);');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vPlanetModel;\n'+noise)
      .replace('#include <map_fragment>', `#include <map_fragment>
        #ifndef USE_MAP
          float terrain=fbm(normalize(vPlanetModel)*18.);
          diffuseColor.rgb*=mix(.33,1.42,smoothstep(.2,.75,terrain));
        #endif`);
    if (!earth) return;
    shader.uniforms.uSun=illumination;
    shader.uniforms.uSurfaceReflectance=specular;
    shader.uniforms.uNight={value:texture('earth_nightmap.jpg')};
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>',
      '#include <common>\nuniform vec3 uSun; uniform sampler2D uNight; uniform sampler2D uSurfaceReflectance;')
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        #ifdef USE_MAP
          roughnessFactor=clamp(roughnessFactor-texture2D(uSurfaceReflectance,vMapUv).g*.55,.19,1.);
        #endif`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        #ifdef USE_MAP
          vec3 sunView=(viewMatrix*vec4(uSun,1.)).xyz;
          float night=1.-smoothstep(-.28,.14,dot(normalize(normal),normalize(sunView+vViewPosition)));
          totalEmissiveRadiance+=texture2D(uNight,vMapUv).rgb*night*1.15;
        #endif`);
  };
  material.customProgramCacheKey=()=>earth ? 'terrain-night' : 'terrain';
  return { material, illumination };
}

export function rings(uranus: boolean) {
  const material=new T.ShaderMaterial({
    side:T.DoubleSide, transparent:true, depthWrite:false,
    uniforms:{ uLight:{value:new T.Vector3()}, uCenter:{value:new T.Vector3()}, uRadius:{value:1},
      uUranus:{value:Number(uranus)}, uMap:{value:null}, uTextured:{value:0} },
    vertexShader:sphereVertex,
    fragmentShader:/* glsl */`
      varying vec3 vWorld,vModel;
      uniform vec3 uLight,uCenter; uniform float uRadius,uUranus,uTextured; uniform sampler2D uMap;
      void main(){
        float r=length(vModel.xy);
        float t=clamp((r-1.27)/1.16,0.,1.);
        float bands=.53+.23*sin(t*91.)+.12*sin(t*244.)+.07*sin(t*657.);
        float gap=1.-.94*exp(-pow((t-.69)/.022,2.))-.58*exp(-pow((t-.86)/.009,2.));
        float mask=smoothstep(0.,.06,t)*(1.-smoothstep(.94,1.,t));
        float profile=texture2D(uMap,vec2(t,.5)).a;
        float thin=.65*exp(-pow((t-.77)/.025,2.))+.32*exp(-pow((t-.56)/.012,2.))+.75*exp(-pow((t-.89)/.017,2.));
        vec3 ray=normalize(uLight-vWorld), offset=uCenter-vWorld;
        float along=dot(offset,ray);
        float penumbra=smoothstep(uRadius*.90,uRadius*1.03,length(offset-ray*max(0.,along)));
        float light=along>0. ? mix(.10,1.,penumbra) : 1.;
        vec3 warm=mix(vec3(.39,.21,.115),vec3(.97,.80,.61),bands);
        vec3 color=mix(warm,vec3(.38,.57,.61),uUranus);
        gl_FragColor=vec4(color*light*1.25, mask*mix(bands*gap*mix(1.,max(.12,profile),.43*uTextured),mix(thin,profile,uTextured),uUranus)*.90);
        ${output}
      }`
  });
  texture(uranus ? 'uranus_ring_alpha.png' : 'saturn_ring_alpha.png', map => {
    material.uniforms.uMap.value=map;
    material.uniforms.uTextured.value=1;
  }, true);
  return material;
}

export function blackHole() {
  return new T.ShaderMaterial({
    vertexShader: `varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    uniforms:{uTime:{value:0},uSky:{value:null},uHasSky:{value:0},uViewport:{value:new T.Vector2(1,1)}},
    transparent:true,depthWrite:false,
    fragmentShader:/* glsl */`
      varying vec2 vUv; uniform float uTime,uHasSky; uniform sampler2D uSky; uniform vec2 uViewport;
      ${noise}
      void main(){
        vec2 p=vUv*2.-1.; float r=length(p), angle=atan(p.y,p.x);
        if(r>.98) discard;
        float disk=abs(p.y+.11*sin(p.x*3.3))+.22*abs(p.x);
        float flow=fbm(vec3(p*27.,uTime*.22)+vec3(cos(angle-uTime*.2),sin(angle-uTime*.2),0.)*3.);
        float band=exp(-disk*19.)*smoothstep(.24,.37,r)*(1.-smoothstep(.53,.96,r));
        float photon=exp(-pow((r-.347)/.021,2.));
        float arc=exp(-pow((length(vec2(p.x,p.y*1.28))-.49)/.034,2.))*smoothstep(-.18,.24,p.y)*.42;
        vec2 bend=gl_FragCoord.xy/uViewport+normalize(p+1e-6)*.031/max(r,.21);
        vec3 lensed=texture2D(uSky,bend).rgb;
        float horizon=1.-smoothstep(.31,.345,r);
        float rim=(1.-smoothstep(.55,.96,r))*.8;
        vec3 color=lensed*uHasSky*.72*(1.-horizon)+vec3(2.9,.96,.26)*(photon*.88+arc+band*(.4+flow));
        gl_FragColor=vec4(color,max(horizon,max(rim,max(photon,band))));
        ${output}
      }`
  });
}