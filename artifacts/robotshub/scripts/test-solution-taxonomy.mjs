import assert from 'node:assert/strict';
import { test } from 'node:test';
import catalog from '../src/data/solutions.json' with { type: 'json' };
import { getSolutionTaxonomy, getSimulationProfile } from '../src/lib/solutionTaxonomy.ts';

const solutionById = (id) => {
  const solution = catalog.items.find((item) => item.id === id);
  assert.ok(solution, `Каталожная запись ${id} должна существовать`);
  return solution;
};

const groundCleaningOperations = ['clean_indoor', 'clean_outdoor'];
const aerialFacadeIds = [
  '9a941386-07e2-4350-ae35-f0d37a1d9f3f', // Атлант — мойка фасадов
  '9f06ff5b-0ed4-42e4-9795-b2cf3ac55fbb', // Марк — мойка фасадов
  'a51bb921-1931-474f-974e-7c37f9fd9aa0', // Astramis AeroUnit — мойка окон
];

test('БАС для мойки фасадов и окон не получают операцию уборки помещений', () => {
  for (const id of aerialFacadeIds) {
    const solution = solutionById(id);
    const taxonomy = getSolutionTaxonomy(solution);
    const profile = getSimulationProfile(solution, 'warehouse');

    assert.ok(taxonomy.areaIds.includes('air'), `${solution.name} должен относиться к воздушной среде`);
    assert.equal(taxonomy.areaId, 'air');
    assert.equal(taxonomy.operationId, 'clean_facade', `${solution.name} должен иметь операцию мойки фасадов и окон`);
    assert.deepEqual(taxonomy.operationIds, ['clean_facade']);
    assert.ok(!groundCleaningOperations.some((operation) => taxonomy.operationIds.includes(operation)),
      `${solution.name} не должен получать наземную операцию уборки`);
    assert.notEqual(profile.sceneId, 'indoor-cleaning');
  }
});

test('очистка труб и промышленных ёмкостей отделена от уборки пола', () => {
  const industrialCleaningIds = [
    '5778fa74-615d-4f5e-8660-70d0d7ee4b88', // MARTin — зачистка резервуаров и нефтепромыслового оборудования
    'bec9e863-0c3d-44cc-a656-766a323a9746', // TUBOT — гидродинамическая очистка труб
  ];
  const industrialCleaningSolutions = catalog.items.filter((solution) => industrialCleaningIds.includes(solution.id));
  assert.equal(industrialCleaningSolutions.length, 3, 'Ожидаются карточки MARTin и обе записи TUBOT');

  for (const solution of industrialCleaningSolutions) {
    const taxonomy = getSolutionTaxonomy(solution);
    const profile = getSimulationProfile(solution, 'warehouse');

    assert.equal(taxonomy.operationId, 'clean_industrial', `${solution.name} должен иметь промышленную очистку`);
    assert.ok(taxonomy.operationIds.includes('clean_industrial'));
    assert.ok(!groundCleaningOperations.some((operation) => taxonomy.operationIds.includes(operation)),
      `${solution.name} не должен получать операцию уборки пола`);
    assert.notEqual(profile.sceneId, 'indoor-cleaning');
  }
});

test('водные сценарии не становятся наземной уборкой из-за описания уборки мусора', () => {
  const waterSolutions = catalog.items.filter((solution) => getSolutionTaxonomy(solution).areaIds.includes('water'));
  assert.ok(waterSolutions.length > 0, 'В каталоге должны быть записи водной среды');

  for (const solution of waterSolutions) {
    const taxonomy = getSolutionTaxonomy(solution);
    assert.ok(!groundCleaningOperations.some((operation) => taxonomy.operationIds.includes(operation)),
      `${solution.name} не должен получать наземную операцию уборки`);
  }

  const seaScorpion = solutionById('018cc2dd-3dfe-4bd2-aac6-f54cbebd783e');
  const seaScorpionTaxonomy = getSolutionTaxonomy(seaScorpion);
  const seaScorpionProfile = getSimulationProfile(seaScorpion, 'warehouse');
  assert.equal(seaScorpionTaxonomy.areaId, 'water');
  assert.ok(!groundCleaningOperations.some((operation) => seaScorpionTaxonomy.operationIds.includes(operation)));
  assert.equal(seaScorpionProfile.taxonomy.areaId, 'water');
  assert.notEqual(seaScorpionProfile.sceneId, 'indoor-cleaning');

  const mixedDescription = getSolutionTaxonomy({
    name: 'Морской робот для работ на воде',
    category: 'Морские роботы',
    scenario: 'Проведение работ на воде',
    description: 'Уборка мусора, мойка и очистка оборудования выполняются в акватории.',
  });
  assert.ok(mixedDescription.areaIds.includes('water'));
  assert.ok(!groundCleaningOperations.some((operation) => mixedDescription.operationIds.includes(operation)));
});

test('реальная уборка помещений сохраняет прежнюю классификацию', () => {
  const cleaner = solutionById('5a5b3599-bd64-4330-9bbb-4f8ce7d780b9');
  const taxonomy = getSolutionTaxonomy(cleaner);
  assert.equal(taxonomy.operationId, 'clean_indoor');
  assert.ok(taxonomy.operationIds.includes('clean_indoor'));
  assert.ok(!taxonomy.operationIds.includes('clean_facade'));
  assert.ok(!taxonomy.operationIds.includes('clean_industrial'));
});

test('явная классификация из каталога переопределяет текстовые эвристики', () => {
  const expectedById = new Map([
    ['80c41c98-283d-4a29-8fce-4b9e6a1afce3', ['public', 'service']],
    ['a9c720bc-e618-4dcc-90e1-990c5a3d1ae2', ['public', 'service']],
    ['c70f67e1-8f70-4dff-a4e2-584f0ebaefa1', ['public', 'service']],
    ['644aaab9-6ce1-4639-a60a-ed753f8bd589', ['roads', 'service']],
    ['79b43d24-a12d-4852-a1b2-db6090f3c824', ['agriculture', 'agriculture']],
    ['f381872e-d6aa-43b6-be2a-ba36cc9eb90a', ['agriculture', 'agriculture']],
    ['f0e502e3-5771-4464-a1df-97110801c7c3', ['roads', 'construction']],
  ]);

  for (const [id, [areaId, operationId]] of expectedById) {
    const solution = solutionById(id);
    const taxonomy = getSolutionTaxonomy(solution);
    assert.equal(taxonomy.areaId, areaId, `${solution.name}: среда`);
    assert.deepEqual(taxonomy.areaIds, solution.taxonomyOverride.areaIds);
    assert.equal(taxonomy.operationId, operationId, `${solution.name}: операция`);
    assert.deepEqual(taxonomy.operationIds, solution.taxonomyOverride.operationIds);
  }

  const conflictingText = getSolutionTaxonomy({
    name: 'Тест явного переопределения',
    scenario: 'Уборка помещений',
    taxonomyOverride: { areaIds: ['water'], operationIds: ['inspection'] },
  });
  assert.deepEqual(conflictingText.areaIds, ['water']);
  assert.deepEqual(conflictingText.operationIds, ['inspection']);
});

test('явные идентификаторы среды и операций проверяются по справочникам', () => {
  assert.throws(
    () => getSolutionTaxonomy({ taxonomyOverride: { areaIds: ['unknown-area'] } }),
    /taxonomyOverride\.areaIds.*unsupported identifier unknown-area/,
  );
  assert.throws(
    () => getSolutionTaxonomy({ taxonomyOverride: { operationIds: ['unknown-operation'] } }),
    /taxonomyOverride\.operationIds.*unsupported identifier unknown-operation/,
  );
});

test('записи без явных полей по-прежнему классифицируются эвристикой', () => {
  const inferred = getSolutionTaxonomy({
    name: 'AMR для сортировки грузов',
    scenario: 'Внутрискладская логистика',
    description: 'Сортировка отправлений и перемещение паллет между зонами склада.',
  });
  assert.equal(inferred.areaId, 'warehouse');
  assert.ok(inferred.operationIds.includes('sorting'));
  assert.ok(inferred.operationIds.includes('handling'));
});
