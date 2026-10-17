import * as THREE from 'three/webgpu';
import { pass, mrt, output, normalView, diffuseColor, vec4, add, packNormalToRGB, unpackRGBToNormal, sample } from 'three/tsl';
import { ssgi } from 'three/addons/tsl/display/SSGINode.js';

/**
 * SSGI = отражённый свет и AO в экранном пространстве (не трассировка всей сцены).
 * В WebGL2 игра использует солнечный свет + hemispheric bounce + voxel AO.
 */
export class Lighting {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.isWebGPU = renderer.backend?.isWebGPUBackend === true;
    this.enabled = false;
    this.pipeline = null;
    this.faulted = false;
  }

  setEnabled(enabled) {
    if (!this.isWebGPU || this.faulted) {
      this.enabled = false;
      return false;
    }
    if (!enabled) {
      this.enabled = false;
      return true;
    }
    try {
      if (!this.pipeline) {
        const pipeline = new THREE.RenderPipeline(this.renderer);
        const scenePass = pass(this.scene, this.camera);
        scenePass.setMRT(mrt({
          output,
          diffuseColor,
          normal: packNormalToRGB(normalView)
        }));
        const scenePassColor = scenePass.getTextureNode('output');
        const scenePassDepth = scenePass.getTextureNode('depth');
        const packedNormal = scenePass.getTextureNode('normal');
        const normal = sample((uv) => unpackRGBToNormal(packedNormal.sample(uv)));
        const gi = ssgi(scenePassColor, scenePassDepth, normal, this.camera);
        // Умеренный пресет для плавного исследования. Переключается в меню паузы.
        gi.sliceCount.value = 2;
        gi.stepCount.value = 6;
        gi.radius.value = 6;
        gi.aoIntensity.value = 0.65;
        gi.giIntensity.value = 1.0;
        gi.useTemporalFiltering = false;
        pipeline.outputNode = vec4(add(scenePassColor.rgb.mul(gi.getAONode()),
          scenePass.getTextureNode('diffuseColor').rgb.mul(gi.getGINode().rgb)), scenePassColor.a);
        this.pipeline = pipeline;
      }
      this.enabled = true;
      return true;
    } catch (error) {
      console.warn('SSGI не удалось настроить; базовый свет сохранён:', error);
      this.enabled = false;
      this.faulted = true;
      return false;
    }
  }

  render() {
    if (this.enabled && this.pipeline) {
      try {
        this.pipeline.render();
        return;
      } catch (error) {
        console.warn('SSGI: ошибка выполнения, переключаемся на обычный рендер:', error);
        this.enabled = false;
        this.faulted = true;
      }
    }
    this.renderer.render(this.scene, this.camera);
  }
}
