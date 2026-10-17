import { MAX_IMPORT_BYTES, MAX_SLOTS, cleanSaveName } from '../storage/SaveSchema.js';

const el=(tag,className,text)=>{const e=document.createElement(tag);e.className=className||'';if(text!=null)e.textContent=text;return e;};
/** Собственные окна вместо window.confirm/prompt: одинаковая работа в Electron и браузере. */
export class SavePanel {
  constructor(repository,hooks) {
    this.repository=repository;this.hooks=hooks;this.busy=false;this.dialogOpen=false;this.isOpen=false;
    this.root=el('div','overlay save-screen hidden');this.root.id='save-screen';
    this.root.innerHTML=`<section class="panel save-panel" role="dialog" aria-modal="true" aria-labelledby="saves-heading">
      <header class="save-header"><div><div class="panel-eyebrow">МИРЫ / VERDANT</div><h1 id="saves-heading">Сохранения</h1></div><button class="close-button" data-action="close" aria-label="Закрыть">×</button></header>
      <p class="save-note">Именованные слоты, предыдущий снимок и перенос в файл. Ваши миры хранятся на этом компьютере.</p>
      <div class="save-toolbar"><button data-action="new" class="primary-btn">Новый мир</button><button data-action="as" class="secondary-btn">Сохранить как…</button><button data-action="import" class="secondary-btn">Импорт файла</button></div>
      <div id="save-list" class="save-list" aria-live="polite"></div><p id="save-status" role="status"></p>
      <footer class="save-note">F5 — сохранить текущий слот · F8 — слоты · Esc — закрыть</footer>
      <input type="file" accept=".json,.verdant" class="hidden" id="save-import">
      <form class="save-dialog hidden"><h2 class="save-dialog-title"></h2><p class="save-dialog-message"></p><label>Название<input class="save-name" maxlength="64" autocomplete="off" required></label><label class="save-seed-label hidden">Seed (необязательно)<input class="save-seed" placeholder="Случайный мир" inputmode="numeric" autocomplete="off"></label><p class="save-dialog-error" role="alert"></p><div class="save-dialog-buttons"><button type="button" data-action="cancel" class="secondary-btn">Отмена</button><button type="submit" class="primary-btn">Подтвердить</button></div></form>
    </section>`;
    document.getElementById('app').append(this.root);
    this.list=this.root.querySelector('#save-list');this.status=this.root.querySelector('#save-status');
    this.form=this.root.querySelector('form');this.name=this.form.querySelector('.save-name');this.seed=this.form.querySelector('.save-seed');
    this.root.addEventListener('click',e=>{
      const button=e.target.closest('[data-action]');if(!button||this.busy)return;
      const a=button.dataset.action;
      if(a==='close')this.close();
      if(a==='new')this.newDialog();
      if(a==='as')this.saveAsDialog();
      if(a==='cancel')this.cancelDialog();
      if(a==='import')this.root.querySelector('#save-import').click();
    });
    this.form.addEventListener('submit',e=>{e.preventDefault();if(!this.busy&&this.submit)void this.run(this.submit,true);});
    this.root.querySelector('#save-import').addEventListener('change',async e=>{
      const f=e.target.files?.[0];e.target.value='';if(!f)return;
      await this.run(async()=>{if(f.size>MAX_IMPORT_BYTES)throw new Error('Максимум 24 МиБ на файл.');await this.repository.importSlot(await f.text());this.status.textContent='Слот импортирован. Для входа нажмите «Загрузить».';});
    });
    this.keyListener=e=>{
      if(!this.isOpen)return;
      e.stopImmediatePropagation();
      if(e.code==='Escape'){e.preventDefault();if(!this.busy){if(this.dialogOpen)this.cancelDialog();else this.close();}}
    };
    document.addEventListener('keydown',this.keyListener,true);
  }
  async open(create=false) {
    this.isOpen=true;this.root.classList.remove('hidden');this.status.textContent='';
    await this.refresh();if(create)this.newDialog();
  }
  close() {if(this.busy)return;this.cancelDialog();this.isOpen=false;this.root.classList.add('hidden');this.hooks.onClose();}
  async refresh() {
    const slots=(await this.repository.list()).sort((a,b)=>b.updatedAt-a.updatedAt);
    const active=this.hooks.getActive();this.list.replaceChildren();
    for(const meta of slots) {
      const card=el('article','save-card'+(meta.id===active?' is-active':''));
      const title=el('h3','',meta.name);card.append(title);
      const date=new Date(meta.updatedAt).toLocaleString('ru-RU');
      card.append(el('p','save-meta',`${meta.id===active?'Текущий мир · ':''}${date} · ${Math.floor((meta.playSeconds||0)/60)} мин · Seed ${meta.seed}`));
      card.append(el('p','save-meta',meta.generatorVersion>=2?'Поверхностные озёра · генератор 2':'Прежний ландшафт сохранён · генератор 1'));
      const buttons=el('div','save-actions');
      const add=(text,fn,disabled=false)=>{const b=el('button','secondary-btn',text);b.type='button';b.disabled=disabled;b.addEventListener('click',()=>{if(!this.busy)fn();});buttons.append(b);};
      add('Загрузить',()=>this.dialog('Загрузить мир?',`Текущий мир будет сохранён перед загрузкой «${meta.name}».`,null,()=>this.hooks.onLoad(meta.id)));
      add('Записать',()=>void this.run(async()=>{await this.hooks.onSave();this.status.textContent='Текущий слот сохранён.';}),meta.id!==active);
      add('Название',()=>this.dialog('Новое название','Содержимое мира не изменится.',meta.name,async()=>{await this.repository.rename(meta.id,cleanSaveName(this.name.value));}));
      add('Экспорт',()=>void this.run(async()=>{
        if(meta.id===active)await this.hooks.onSave();
        const data=await this.repository.exportSlot(meta.id),url=URL.createObjectURL(new Blob([JSON.stringify(data)],{type:'application/json'}));
        const a=el('a');a.href=url;a.download=`${meta.name.replace(/[^\p{L}\p{N} _-]/gu,'_')}.verdant.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
      }));
      add('Из резерва',()=>this.dialog('Открыть предыдущий снимок?','Будет создан отдельный слот. Текущая версия этого сохранения останется без изменений.',null,async()=>{
        const old=await this.repository.load(meta.id,true);await this.repository.create(`${meta.name} — резерв`,old.state,{select:false});this.status.textContent='Предыдущая версия восстановлена в отдельный слот.';
      }));
      add('Удалить',()=>this.dialog('Удалить сохранение?',`«${meta.name}» и его предыдущий снимок будут удалены. Сначала можно экспортировать файл.`,null,()=>this.repository.remove(meta.id)),meta.id===active);
      card.append(buttons);this.list.append(card);
    }
    if(!slots.length)this.list.append(el('p','','Пока нет сохранений. Создайте первый мир.'));
    this.root.querySelector('[data-action="as"]').disabled=!active||slots.length>=MAX_SLOTS;
    this.root.querySelector('[data-action="new"]').disabled=slots.length>=MAX_SLOTS;
  }
  dialog(title,message,name,action,{seed=false}={}) {
    this.dialogOpen=true;this.form.classList.remove('hidden');
    this.form.querySelector('.save-dialog-title').textContent=title;
    this.form.querySelector('.save-dialog-message').textContent=message;
    this.name.value=name??'';this.name.required=name!==null;this.name.parentElement.classList.toggle('hidden',name===null);
    this.form.querySelector('.save-seed-label').classList.toggle('hidden',!seed);this.seed.value='';
    this.form.querySelector('.save-dialog-error').textContent='';this.submit=action;
    this.list.inert=true;this.root.querySelector('.save-toolbar').inert=true;
    queueMicrotask(()=>name!==null?this.name.focus():this.form.querySelector('[type="submit"]').focus());
  }
  newDialog() {this.dialog('Начать новый мир','Будет создан НОВЫЙ слот. Прежние миры не удаляются.','Новый мир',async()=>{
    const s=this.seed.value.trim();if(s && (!/^\d+$/.test(s)||Number(s)>4294967295))throw new Error('Seed должен быть целым числом от 0 до 4294967295.');
    await this.hooks.onNew(cleanSaveName(this.name.value),s?Number(s):undefined);
  },{seed:true});}
  saveAsDialog() {this.dialog('Сохранить как…','Создать отдельный снимок и продолжить играть в нём.','Мой мир — копия',()=>this.hooks.onSaveAs(cleanSaveName(this.name.value)));}
  cancelDialog() {this.dialogOpen=false;this.form.classList.add('hidden');this.submit=null;this.list.inert=false;this.root.querySelector('.save-toolbar').inert=false;}
  async run(action,dialog=false) {
    if(this.busy)return;this.busy=true;this.root.classList.add('is-busy');
    this.form.querySelectorAll('button').forEach(b=>b.disabled=true);
    try{await action();if(dialog)this.cancelDialog();await this.refresh();}
    catch(error){const message=error?.message||'Не удалось выполнить действие.';this.status.textContent=message;this.form.querySelector('.save-dialog-error').textContent=message;console.error('VERDANT SAVES:',error);}
    finally{this.busy=false;this.root.classList.remove('is-busy');this.form.querySelectorAll('button').forEach(b=>b.disabled=false);}
  }
}
