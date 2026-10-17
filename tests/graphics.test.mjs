import test from 'node:test';
import assert from 'node:assert/strict';
import {GRAPHICS_DEFAULTS,graphicsPreset,graphicsChange,sanitizeGraphics,migrateGraphicsSettings} from '../src/core/GraphicsSettings.js';

test('Графические профили: четыре качества и собственный набор',()=>{
  const low=graphicsPreset('low');
  assert.equal(low.ssgi,false);
  assert.equal(low.shadows,'low');
  assert.ok(low.resolution<GRAPHICS_DEFAULTS.resolution);
  const ultra=graphicsPreset('ultra');
  assert.ok(ultra.viewDistance>low.viewDistance);
  assert.equal(ultra.clouds,'ultra');
  const custom=graphicsChange(ultra,'fog',0);
  assert.equal(custom.preset,'custom');assert.equal(custom.fog,0);
});

test('Сохранение настроек не допускает NaN, Infinity и опасных значений',()=>{
  const broken=sanitizeGraphics({fov:-100,resolution:100,viewDistance:-9,cloudSpeed:Infinity,clouds:'impossible',preset:'bork'});
  assert.equal(broken.fov,65);
  assert.equal(broken.resolution,1.5);
  assert.equal(broken.viewDistance,50);
  assert.equal(broken.cloudSpeed,1);
  assert.equal(broken.clouds,'high');
  assert.equal(broken.preset,'high');
});


test('200 м и 50% — настройки при первом запуске, максимум 1000 м',()=>{
  assert.equal(GRAPHICS_DEFAULTS.viewDistance,200);
  assert.equal(GRAPHICS_DEFAULTS.fog,50);
  assert.equal(sanitizeGraphics({viewDistance:100000}).viewDistance,1000);
  assert.equal(graphicsChange(GRAPHICS_DEFAULTS,'viewDistance',1000).viewDistance,1000);
});

test('Миграция сохраняет пользовательскую дальность, обновляет старый high',()=>{
  const oldHigh=migrateGraphicsSettings({preset:'high',viewDistance:100,fog:75},0);
  assert.equal(oldHigh.viewDistance,200);assert.equal(oldHigh.fog,50);
  const custom=migrateGraphicsSettings({preset:'custom',viewDistance:140,fog:35},0);
  assert.equal(custom.viewDistance,140);assert.equal(custom.fog,35);
  const current=migrateGraphicsSettings({preset:'high',viewDistance:650,fog:70},2);
  assert.equal(current.viewDistance,650);assert.equal(current.fog,70);
});
