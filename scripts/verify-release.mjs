import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readZipFile } from './zip-safe.mjs';
import { isAllowedProjectFile, archiveInfo } from './release-manager.mjs';

/** Проверка готовых ZIP ПОСЛЕ упаковки, а не только рабочей папки. */
export async function verifyRelease(projectPath, texturesPath){
  const projectInfo=archiveInfo(path.basename(projectPath));
  const textureInfo=archiveInfo(path.basename(texturesPath));
  if(projectInfo?.kind!=='PROJECT' || textureInfo?.kind!=='TEXTURES_1K' || projectInfo.version!==textureInfo.version){
    throw new Error('Неправильные имена архивов или их версии различаются');
  }
  const version=projectInfo.version;
  const project=await readZipFile(projectPath,{ maxCompressed: 90*1024*1024,maxTotal:100*1024*1024,maxSingle:12*1024*1024});
  const textures=await readZipFile(texturesPath,{ maxCompressed:220*1024*1024,maxTotal:220*1024*1024,maxSingle:48*1024*1024});
  const text=(map,p)=>{
    const b=map.get(p);
    if(!b)throw new Error(`Отсутствует файл ${p}`);
    return b.toString('utf8');
  };
  for(const name of project.keys()){
    if(!isAllowedProjectFile(name))throw new Error(`Лишний / запрещённый файл в проектном ZIP: ${name}`);
  }
  const pkg=JSON.parse(text(project,'package.json'));
  const manifest=JSON.parse(text(project,'scripts/release-files.json'));
  if(pkg.version!==version || manifest.version!==version)throw new Error('Версия package.json или release-files.json не совпадает с ZIP');
  if(pkg.name!=='verdant-voxel')throw new Error('Неверное имя npm-проекта');
  for(const file of manifest.files)if(!project.has(file))throw new Error(`Отсутствует файл из манифеста: ${file}`);
  for(const file of project.keys())if(!manifest.files.includes(file))throw new Error(`Неучтённый файл проекта: ${file}`);
  const html=text(project,'index.html');
  const banners=[/ALPHA\s+(\d+\.\d+\.\d+)/.exec(html)?.[1], /EARLY BUILD\s*·\s*(\d+\.\d+\.\d+)/.exec(html)?.[1]];
  if(banners.some(s=>s!==version))throw new Error(`Неверные версии в index.html (${banners.join(', ')})`);
  const header=text(project,'src/main.js').slice(0,1400);
  if(!header.includes(`VERDANT v${version}`))throw new Error('Неверная версия заголовка src/main.js');
  if(!text(project,'README.md').startsWith(`# VERDANT v${version}`))throw new Error('Неверная версия README проекта');
  if(!text(project,'public/textures/README.md').includes(`VERDANT v${version}`))throw new Error('Неверная версия README текстур внутри проекта');
  if(!text(project,'CHANGELOG.md').includes(`## ${version}`))throw new Error('Версия отсутствует в CHANGELOG');
  const texReadme=text(textures,'README.md');
  if(!texReadme.includes(`VERDANT v${version}`))throw new Error('Неверная версия README внутри текстурного ZIP');
  const source=text(project,'src/main.js');
  const literal=/const files=\[(.*?)\];/.exec(source);
  if(!literal)throw new Error('Не удалось найти список используемых текстур');
  const base=[...literal[1].matchAll(/'([\w-]+\.png)'/g)].map(x=>x[1]);
  if(base.length!==7)throw new Error(`Ожидалось 7 основных материалов, получено ${base.length}`);
  const expected=new Set(base.flatMap(name=>[name,name.replace(/\.png$/,'_normal.png')]));
  const discovered=new Set();
  for(const [name,buffer] of textures){
    if(name==='README.md')continue;
    const relative=name.replace(/^public\/textures\//,'').replace(/^textures\//,'');
    if(!/^[a-z0-9_-]+\.png$/i.test(relative))throw new Error(`Некорректный путь текстуры: ${name}`);
    if(discovered.has(relative))throw new Error(`Дублирование текстуры: ${relative}`);
    discovered.add(relative);
    if(!buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ||
       buffer.readUInt32BE(16)!==1024 || buffer.readUInt32BE(20)!==1024)
       throw new Error(`${name}: ожидалась PNG-карта 1024×1024`);
  }
  for(const name of expected)if(!discovered.has(name))throw new Error(`В текстурном ZIP нет ${name}`);
  if(discovered.size!==expected.size)throw new Error(`Лишние файлы в текстурном ZIP: ${[...discovered].filter(s=>!expected.has(s))}`);
  return { version, projectFiles:project.size, textures:discovered.size };
}

if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [, , projectPath, texturesPath]=process.argv;
  if(!projectPath || !texturesPath){
    console.error('Использование: node scripts/verify-release.mjs VERDANT_v..._PROJECT.zip VERDANT_v..._TEXTURES_1K.zip');
    process.exitCode=2;
  }else{
    try{
      const r=await verifyRelease(projectPath,texturesPath);
      console.log(`[VERDANT RELEASE CHECK] OK: ${r.version}, файлов исходников ${r.projectFiles}, PNG ${r.textures}. Версии UI, манифеста и графики согласованы.`);
    }catch(error){
      console.error('[VERDANT RELEASE CHECK] ОШИБКА:',error.message);
      process.exitCode=1;
    }
  }
}
