import * as THREE from 'three/webgpu';
import {positionWorld,normalWorldGeometry,cameraViewMatrix,vec2,vec3,vec4,sin,mix,texture,uniform} from 'three/tsl';

/**
 * Бесшовная верхняя трава. UV и нормали непрерывны в МИРОВЫХ координатах:
 * ни id блока, ни округление координат, ни поворот отдельного куба не участвуют.
 * Два повёрнутых масштаба одной 1K-карты разрушают метровую периодичность.
 */
export function makeGrassMaterial(source) {
  const material=new THREE.MeshStandardNodeMaterial();material.copy(source);
  material.name='verdant-continuous-grass';
  if(!source.map)return material;
  const x=positionWorld.x,z=positionWorld.z;
  const a=vec2(x,z).mul(1/2.4);
  const b=vec2(x.mul(.8).sub(z.mul(.6)),x.mul(.6).add(z.mul(.8))).mul(1/6.7).add(vec2(.371,.619));
  const blend=sin(x.mul(.071).add(z.mul(.053))).mul(sin(z.mul(.041).sub(x.mul(.033)))).mul(.12).add(.28);
  material.colorNode=mix(texture(source.map,a).rgb,texture(source.map,b).rgb,blend);
  if(source.normalMap) {
    const scale=uniform(material.normalScale);
    const na=texture(source.normalMap,a).xyz.mul(2).sub(1);
    const nb=texture(source.normalMap,b).xyz.mul(2).sub(1);
    // Обратный поворот склона второго сэмпла в общий мировой базис.
    const rotated=vec2(nb.x.mul(.8).add(nb.y.mul(.6)),nb.y.mul(.8).sub(nb.x.mul(.6)));
    const slope=mix(na.xy,rotated,blend).mul(scale).mul(.62);
    const normal=normalWorldGeometry.add(vec3(slope.x,0,slope.y)).normalize();
    material.normalNode=cameraViewMatrix.mul(vec4(normal,0)).xyz.normalize();
  }
  return material;
}
