/* Lifecycle LCD navigation. No storage or clocks of its own. */
window.createLifecycleUI = function (ui) {
  'use strict';
  const state = ui.state;
  let flow = null, archiveId = null, page = 0, notice = '', noticeUntil = 0, criticalDrawn = false;
  const screens = new Set(['service','life-status','generations','archive','new-collection','reset-confirm','new-mode','classic-confirm','new-backup','new-confirm','pause-confirm','archive-delete']);
  const item = (id,label) => ({id,label,hint:''});
  const labels = {hunger:'Еда',energy:'Сон',clean:'Купание',joy:'Игра',illness:'Лекарство'};
  function enter(menu, selected=0) { state.menu=menu;state.selected=selected;page=0;ui.refresh(); }
  function show(text) { notice=text;noticeUntil=performance.now()+4500;ui.message(text); }
  function pet() { return ui.getPet(); }
  function active() { return screens.has(state.menu); }
  function open() { flow=null;archiveId=null;enter('service');show('Состояние и забота · A/B/C'); }
  function selectedArchive() { return pet().archives.find(a=>a.lifeId===archiveId); }
  function list() {
    const p=pet();
    switch(state.menu) {
      case 'service': return [item('status','Состояние'),item('medicine','Лекарство'),item('pause',p.biology.paused?'Продолжить жизнь':'Пауза жизни'),item('generations','Поколения'),item('back','Назад')];
      case 'life-status': return [item('status-next','Следующая страница'),item('back','Назад')];
      case 'generations': return [item('new','Новое яйцо'),...p.archives.map((a,i)=>item('archive:'+a.lifeId,'Поколение '+(a.biology?.generation||i+1))),item('export','Скачать весь архив'),item('back','Назад')];
      case 'archive': return [item('export','Скачать всё'),item('delete','Удалить запись'),item('back','Назад')];
      case 'new-collection': return [item('cancel','Отмена'),item('keep','Сохранить коллекцию'),item('reset','С чистого листа')];
      case 'reset-confirm': return [item('cancel','Не сбрасывать'),item('reset-yes','Да, начать с нуля')];
      case 'new-mode': return [item('cancel','Отмена'),item('safe','Бережный'),item('classic','Классический')];
      case 'classic-confirm': return [item('cancel','Отмена'),item('classic-yes','Принимаю этот режим')];
      case 'new-backup': return [item('cancel','Отмена'),item('backup','Скачать сохранение')];
      case 'new-confirm': return [item('cancel','Отмена'),item('new-yes','Создать новое яйцо')];
      case 'pause-confirm': return [item('cancel','Отмена'),item('pause-yes','Поставить на паузу')];
      case 'archive-delete': return [item('cancel','Отмена'),item('delete-yes','Удалить эту запись')];
      default:return [];
    }
  }
  function back() {
    if(['new-collection','reset-confirm','new-mode','classic-confirm','new-backup','new-confirm'].includes(state.menu)){flow=null;enter('generations');show('Отмена. Текущая жизнь сохранена.');}
    else if(state.menu==='service')ui.home();
    else if(state.menu==='archive-delete')enter('archive');
    else if(state.menu==='archive')enter('generations');
    else enter('service');
  }
  function command(type,args) { const r=ui.act(type,args);if(!r.ok)show(ui.error(r.code));return r; }
  function select(id) {
    const p=pet();
    if(id==='cancel'||id==='back'){back();return;}
    if(id==='status'){enter('life-status');return;}
    if(id==='status-next'){page=(page+1)%3;ui.refresh();return;}
    if(id==='medicine'){
      const r=command('medicine',{});if(r.ok)show('Лекарство помогло. Проверь еду и сон.');return;
    }
    if(id==='pause'){if(p.biology.paused){if(command('resume',{}).ok){ui.home();show('Жизнь продолжается.');}}else enter('pause-confirm');return;}
    if(id==='pause-yes'){if(command('pause',{confirmed:true}).ok){ui.home();show('Жизнь на паузе. B — продолжить.');}return;}
    if(id==='generations'){enter('generations');return;}
    if(id.startsWith('archive:')){archiveId=id.slice(8);enter('archive');return;}
    if(id==='export'){ui.download('semiira-archive.json');show('Файл архива подготовлен.');return;}
    if(id==='delete'){enter('archive-delete');return;}
    if(id==='delete-yes'){if(command('archive-delete',{lifeId:archiveId,confirmed:true}).ok){enter('generations');show('Запись удалена.');}return;}
    if(id==='new'){
      if(p.archives.length>=20){show('Архив полон. Скачай и удали старую запись.');return;}
      flow={keepCollection:true,mode:'safe',backupExported:false,lifeId:p.biology.lifeId,requestId:window.crypto?.randomUUID?.()||String(Date.now())+'-'+Math.random().toString(36).slice(2)};
      enter('new-collection');return;
    }
    if(!flow){show('Начни создание яйца заново.');enter('generations');return;}
    if(id==='keep'){flow.keepCollection=true;enter('new-mode');return;}
    if(id==='reset'){enter('reset-confirm');return;}
    if(id==='reset-yes'){flow.keepCollection=false;enter('new-mode');return;}
    if(id==='safe'){flow.mode='safe';enter('new-backup');return;}
    if(id==='classic'){enter('classic-confirm');return;}
    if(id==='classic-yes'){flow.mode='classic';enter('new-backup');return;}
    if(id==='backup'){ui.download('semiira-before-new-life.json');flow.backupExported=true;enter('new-confirm');show('Сохранение подготовлено. Проверь загрузку.');return;}
    if(id==='new-yes'){
      if(!flow.backupExported||flow.lifeId!==p.biology.lifeId){show('Сначала сохрани текущую жизнь.');enter('new-backup');return;}
      const r=command('new-life',{...flow,confirmed:true});
      if(r.ok){flow=null;ui.home();show('Новое яйцо. Коллекция — как ты выбрала.');}
    }
  }
  function specialPress(which) {
    const p=pet();
    if(active()){
      const choices=list();if(which===2)back();else if(which===0){state.selected=(state.selected+1)%choices.length;ui.refresh();}else if(choices[state.selected])select(choices[state.selected].id);return true;
    }
    if(state.menu!=='home')return false;
    if(p.biology.lifeState==='grave'){if(which===1)enter('generations');return true;}
    if(p.biology.paused){if(which===1&&command('resume',{}).ok){ui.home();show('Жизнь продолжается.');}return true;}
    if(p.biology.lifeState==='egg'){if(which===1){if(command('hatch',{}).ok){ui.home();show('Йоу. Привет, маленькая Семира.');}}return true;}
    return false;
  }
  function lines(text,max=32) {
    const result=[];let line='';for(const word of String(text).split(/\s+/)){if(line.length+word.length+1>max){result.push(line);line=word;}else line+=(line?' ':'')+word;}if(line)result.push(line);return result;
  }
  function draw(api) {
    const p=pet(),b=p.biology,d=p.lifecycle;
    const {rect,text}=api;
    criticalDrawn=false;
    const special=active()||b.lifeState==='egg'||b.lifeState==='grave'||b.paused;
    if(!special)return false;
    rect(0,0,240,208,'#292334');rect(0,0,240,22,'#201a2c');text('SEMIIRA',8,5,10);text('ПОКОЛЕНИЕ '+b.generation,232,5,9,'#d6bfd7','right');
    const headings={'service':'ЗАБОТА','life-status':'СОСТОЯНИЕ','generations':'ПОКОЛЕНИЯ','archive':'ПАМЯТЬ','new-collection':'КОЛЛЕКЦИЯ','reset-confirm':'НАЧАТЬ С НУЛЯ?','new-mode':'РЕЖИМ НОВОЙ ЖИЗНИ','classic-confirm':'КЛАССИЧЕСКИЙ РЕЖИМ','new-backup':'СОХРАНИ ТЕКУЩУЮ ЖИЗНЬ','new-confirm':'НОВОЕ ЯЙЦО?','pause-confirm':'ПАУЗА ЖИЗНИ?','archive-delete':'УДАЛИТЬ ЗАПИСЬ?'};
    if(active()){
      text(headings[state.menu],120,29,11,'#efb7d8','center');
      let detail='';
      if(state.menu==='life-status'){
        const pages=[
          [d.stageLabel+' · '+d.ageLabel,'Здоровье '+Math.round(b.health)+'/100','Болезнь: '+(d.illnessLabel||'нет'),'Отходы: '+b.waste+'/3'],
          ['Сытость '+Math.round(p.needs.hunger),'Радость '+Math.round(p.needs.joy),'Бодрость '+Math.round(p.needs.energy),'Чистота '+Math.round(p.needs.clean)],
          ['Уход '+d.careQuality+' · счастье '+d.happiness,'Привязанность '+b.bond+'/100','Характер: '+({calm:'спокойная',curious:'любопытная',shy:'застенчивая'}[b.personality]||'—'),(d.attentionCauses||[]).map(c=>labels[c]).join(', ')||'Срочной помощи не нужно']
        ];pages[page].forEach((t,i)=>text(t,12,52+i*19,10));
      }else if(state.menu==='archive'){
        const a=selectedArchive();if(a){text('Поколение '+a.biology.generation,12,50,11);text('Возраст '+Math.floor(a.biology.ageMs/3600000)+' ч',12,68,10);text(a.reason==='death'?'Жизнь стала воспоминанием':'Сохранена перед новой жизнью',12,86,9);}
      }else{
        if(state.menu==='reset-confirm')detail='Монеты, опыт и коллекция будут сброшены. Архив останется.';
        if(state.menu==='classic-confirm')detail='Без ухода эта жизнь может закончиться. Будет время помочь.';
        if(state.menu==='new-backup')detail='Полный JSON сохранит прежнюю жизнь, коллекцию и архив.';
        if(state.menu==='new-confirm')detail=(flow?.mode==='classic'?'Классический':'Бережный')+' · '+(flow?.keepCollection?'коллекция остаётся':'коллекция с нуля');
        if(state.menu==='pause-confirm')detail='Возраст и потребности замрут до твоего возвращения.';
        if(state.menu==='archive-delete')detail='Эта запись исчезнет из архива. Сначала скачай копию.';
        if(detail)lines(detail,34).slice(0,3).forEach((t,i)=>text(t,12,49+i*13,9,'#dfc5d8'));
      }
      const choices=list(),perPage=state.menu==='life-status'||state.menu==='archive'?2:detail?3:5;
      const start=Math.floor(state.selected/perPage)*perPage,y0=state.menu==='life-status'?143:state.menu==='archive'?125:detail?100:52;
      choices.slice(start,start+perPage).forEach((o,i)=>{const y=y0+i*22,on=start+i===state.selected;if(on)rect(8,y-3,224,20,'#69465f');text((on?'› ':'  ')+o.label,12,y,10,on?'#fff0fa':'#cbb5d0');});
      if(choices.length>perPage)text((start+1)+'–'+Math.min(start+perPage,choices.length)+' / '+choices.length,231,177,8,'#cbb5d0','right');
    }else if(b.lifeState==='egg'){
      text('МАЛЕНЬКАЯ НОВАЯ ЖИЗНЬ',120,34,11,'#efb7d8','center');
      api.ctx.fillStyle='#f7e5f2';api.ctx.beginPath();api.ctx.ellipse(120,107,25,33,0,0,Math.PI*2);api.ctx.fill();rect(99,87,42,6,'#ef91bd');text('✦',120,100,17,'#ad598f','center');
      text(b.eggReady?'B — вылупиться':'Греюсь… '+Math.ceil(Math.max(0,900000-b.stageMs)/60000)+' мин',120,153,12,'#f6d88e','center');
      text('Удерживай B — забота и режим',120,175,9,'#d3aec9','center');
    }else if(b.lifeState==='grave'){
      text('ТИХАЯ ПАМЯТЬ',120,44,14,'#d6bfd7','center');text('✦',120,84,38,'#f6d88e','center');text('Эта жизнь останется в архиве.',120,143,10,'#e8c5de','center');text('B — поколения и новое яйцо',120,169,10,'#efb7d8','center');
    }else{
      text('ЖИЗНЬ НА ПАУЗЕ',120,70,16,'#efb7d8','center');text('Время и потребности заморожены.',120,105,10);text('B — продолжить',120,145,12,'#f6d88e','center');
    }
    text('A дальше · B выбрать · C назад',120,193,9,'#d3aec9','center');return true;
  }
  function overlay(api) {
    const p=pet(),b=p.biology,d=p.lifecycle;criticalDrawn=false;
    if(d.warning==='critical'&&!b.paused&&b.lifeState!=='grave'){
      api.rect(0,0,240,24,'#6f203d');api.text('Нужна помощь · лечение, еда, сон',120,5,10,'#fff0f6','center');
      criticalDrawn=true;
    }
    if(notice&&performance.now()<noticeUntil){const ls=lines(notice,35).slice(0,3);api.rect(4,203-ls.length*12,232,ls.length*12+4,'#211a2af5');ls.forEach((t,i)=>api.text(t,9,205-ls.length*12+i*12,9,'#ffdfef'));}
  }
  function acknowledgeCritical() {
    const p=pet();if(criticalDrawn&&p.biology.criticalPending&&!p.biology.criticalSeen&&document.visibilityState==='visible'&&!window.TamaDrawer?.isOpen())ui.act('critical-seen',{visible:true,drawer:false});
  }
  return {active,list,open,back,select,specialPress,draw,overlay,acknowledgeCritical,show};
};
