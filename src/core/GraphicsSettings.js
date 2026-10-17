/** Графические пресеты: дальность до 1 км, дымка по умолчанию 50%. */
export const GRAPHICS_PRESETS = Object.freeze({
  low:    {resolution:0.65,shadows:'low',clouds:'low',viewDistance:100,fog:50,normalStrength:0.8,exposure:1.05,ssgi:false},
  medium: {resolution:0.85,shadows:'medium',clouds:'medium',viewDistance:150,fog:50,normalStrength:1.10,exposure:1.05,ssgi:false},
  high:   {resolution:1.00,shadows:'high',clouds:'high',viewDistance:200,fog:50,normalStrength:1.40,exposure:1.05,ssgi:true},
  ultra:  {resolution:1.25,shadows:'ultra',clouds:'ultra',viewDistance:350,fog:50,normalStrength:1.70,exposure:1.02,ssgi:true}
});
export const GRAPHICS_DEFAULTS = Object.freeze({ ...GRAPHICS_PRESETS.high,preset:'high', fov:78, cloudSpeed:1, waterQuality:'high' });
const SHADOW_OPTIONS=['off','low','medium','high','ultra'];
const CLOUD_OPTIONS=['off','low','medium','high','ultra'];
const clamp=(n,low,high,fallback)=>Number.isFinite(Number(n))?Math.min(high,Math.max(low,Number(n))):fallback;
/** Проверка настроек и совместимость со старыми сохранениями. */
export function sanitizeGraphics(source={}) {
  const s=source && typeof source==='object'?source:{};
  const defaults=GRAPHICS_DEFAULTS;
  return {
    preset:['low','medium','high','ultra','custom'].includes(s.preset)?s.preset:'high',
    resolution:clamp(s.resolution,0.55,1.5,defaults.resolution),
    shadows:SHADOW_OPTIONS.includes(s.shadows)?s.shadows:defaults.shadows,
    clouds:CLOUD_OPTIONS.includes(s.clouds)?s.clouds:defaults.clouds,
    viewDistance:Math.round(clamp(s.viewDistance,50,1000,defaults.viewDistance)),
    fog:Math.round(clamp(s.fog,0,100,defaults.fog)),
    normalStrength:clamp(s.normalStrength,0,2.5,defaults.normalStrength),
    exposure:clamp(s.exposure,0.65,1.45,defaults.exposure),
    fov:Math.round(clamp(s.fov,65,100,defaults.fov)),
    cloudSpeed:clamp(s.cloudSpeed,0,3,defaults.cloudSpeed),
    waterQuality:['low','high'].includes(s.waterQuality)?s.waterQuality:'high',
    ssgi:typeof s.ssgi==='boolean'?s.ssgi:defaults.ssgi
  };
}
export function graphicsPreset(name,previous=GRAPHICS_DEFAULTS) {
  if(!Object.hasOwn(GRAPHICS_PRESETS,name)) return sanitizeGraphics(previous);
  return sanitizeGraphics({...previous,...GRAPHICS_PRESETS[name],waterQuality:name==='low'?'low':'high',preset:name});
}
export function graphicsChange(previous,key,value) {
  if(!Object.hasOwn(GRAPHICS_DEFAULTS,key) || key==='preset') return sanitizeGraphics(previous);
  return sanitizeGraphics({...previous,[key]:value,preset:'custom'});
}
/** Сохраняем осознанно выбранные custom-параметры и выбранный профиль. */
export function migrateGraphicsSettings(savedGraphics, savedVersion=0) {
  if (!savedGraphics) return sanitizeGraphics(GRAPHICS_DEFAULTS);
  const copy={...savedGraphics};
  if(savedVersion<2) {
    if (copy.preset==='high' && copy.viewDistance===100) copy.viewDistance=200;
    if (copy.preset==='ultra' && copy.viewDistance===150) copy.viewDistance=350;
    if (copy.preset==='medium' && copy.viewDistance===68) copy.viewDistance=150;
    if (copy.preset==='low' && copy.viewDistance===42) copy.viewDistance=100;
    if (copy.preset!=='custom' && (copy.fog===75 || copy.fog===80 || copy.fog===65)) copy.fog=50;
  }
  return sanitizeGraphics(copy);
}
