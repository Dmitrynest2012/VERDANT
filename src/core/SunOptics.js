/** Чистая математика экранной оптики; не зависит от WebGPU или частоты кадров. */
export const FLARE_OPACITIES=Object.freeze([.14,.105,.078]);
export const FLARE_DIAMETERS=Object.freeze([76,130,206]);
export const FLARE_PROGRESS=Object.freeze([.24,.50,.78]);
export function smoothUnit(value) {
  const t=Math.max(0,Math.min(1,value));return t*t*(3-2*t);
}
/** Три независимых пятна идут к правому нижнему углу, не схлопываясь на оси камеры. */
export function flareLayout(sunX,sunY,width,height,strength=1) {
  if(![sunX,sunY,width,height,strength].every(Number.isFinite)||width<=0||height<=0)return [];
  const scale=Math.max(.6,Math.min(1.6,Math.min(width/1440,height/900)));
  const endX=width*.91,endY=height*.88;
  return FLARE_PROGRESS.map((t,i)=>({x:sunX+(endX-sunX)*t,y:sunY+(endY-sunY)*t,
    diameter:FLARE_DIAMETERS[i]*scale,opacity:FLARE_OPACITIES[i]*Math.max(0,Math.min(1,strength))}));
}
/** Проверка NDC выполняется отдельно от глубины: WebGPU и WebGL используют разные диапазоны Z. */
export function sunScreenVisibility(x,y,alignment) {
  if(![x,y,alignment].every(Number.isFinite)||alignment<=0)return 0;
  const edge=1-smoothUnit((Math.max(Math.abs(x),Math.abs(y))-.85)/.23);
  return smoothUnit((alignment-.86)/.14)*edge;
}
