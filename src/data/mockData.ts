/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ProductRecipe, Batch, Preventative } from '../types';
import { calculateProductionTimeline } from '../utils/timeline';

export const INITIAL_RECIPES: ProductRecipe[] = [
  {
    id: 'rec-soja',
    name: 'SOJA (Inoculação Curta)',
    color: 'blue',
    yieldPerBatch: 5000,
    steps: [
      { id: 's1', scaleType: 'Erlenmeyer', durationHours: 24 },
      { id: 's2', scaleType: 'Balão', durationHours: 24 },
      { id: 's3', scaleType: '100L', durationHours: 48 },
      { id: 's4', scaleType: '500L', durationHours: 48 },
      { id: 's5', scaleType: '3000_5000L', durationHours: 72 },
      { id: 's6', scaleType: 'Envase', durationHours: 18 }
    ]
  },
  {
    id: 'rec-premier',
    name: 'PREMIER (Alta Densidade)',
    color: 'emerald',
    yieldPerBatch: 3000,
    steps: [
      { id: 'p1', scaleType: 'Erlenmeyer', durationHours: 32 },
      { id: 'p2', scaleType: 'Balão', durationHours: 24 },
      { id: 'p3', scaleType: '100L', durationHours: 36 },
      { id: 'p4', scaleType: '500L', durationHours: 48 },
      { id: 'p5', scaleType: '3000_5000L', durationHours: 96 },
      { id: 'p6', scaleType: 'Envase', durationHours: 24 }
    ]
  },
  {
    id: 'rec-milho',
    name: 'MILHO - POWER DRY',
    color: 'amber',
    yieldPerBatch: 4000,
    steps: [
      { id: 'm1', scaleType: 'Erlenmeyer', durationHours: 24 },
      { id: 'm2', scaleType: 'Balão', durationHours: 18 },
      { id: 'm3', scaleType: '100L', durationHours: 24 },
      { id: 'm4', scaleType: '500L', durationHours: 36 },
      { id: 'm5', scaleType: '3000_5000L', durationHours: 48 },
      { id: 'm6', scaleType: 'Envase', durationHours: 12 }
    ]
  }
];

export const INITIAL_PREVENTATIVES: Preventative[] = [
  {
    id: 'prev-1',
    assetId: 'B01',
    description: 'MANUTENÇÃO PREVENTIVA VÁLVULAS',
    startDateTime: '2026-06-03T08:00:00.000Z',
    endDateTime: '2026-06-05T18:00:00.000Z'
  },
  {
    id: 'prev-2',
    assetId: 'B12',
    description: 'PREVENTIVA CALIBRAÇÃO SENSORES',
    startDateTime: '2026-06-08T06:00:00.000Z',
    endDateTime: '2026-06-10T18:00:00.000Z'
  },
  {
    id: 'prev-3',
    assetId: 'erlen-r3',
    description: 'LIMPEZA E HIGIENIZAÇÃO ROTA',
    startDateTime: '2026-06-02T12:00:00.000Z',
    endDateTime: '2026-06-03T12:00:00.000Z'
  }
];

// Helper to pre-calculate batches so they have consistent allocations
export function getInitialBatches(): Batch[] {
  const batches: Batch[] = [];

  // Batch 1: SOJA starting Week 23 (Monday, June 1, 2026)
  const batch1Id = 'batch-1';
  const recSoja = INITIAL_RECIPES[0];
  const steps1 = calculateProductionTimeline(
    recSoja,
    '2026-06-01T08:00:00.000Z',
    0, // transferInterval
    [], // empty existing
    INITIAL_PREVENTATIVES,
    {
      '0': 'erlen-r0',
      '1': 'balao-r1',
      '2': 'B02', // Avoid B01 since it has prevention
      '3': 'B06',
      '4': 'B11',
      '5': 'quality'
    },
    batch1Id
  );
  batches.push({
    id: batch1Id,
    lotNumber: 'SOJ-1065697',
    productId: recSoja.id,
    startDateTime: '2026-06-01T08:00:00.000Z',
    transferIntervalHours: 0,
    steps: steps1
  });

  // Batch 2: PREMIER starting June 3, 2026
  const batch2Id = 'batch-2';
  const recPremier = INITIAL_RECIPES[1];
  const steps2 = calculateProductionTimeline(
    recPremier,
    '2026-06-03T12:00:00.000Z',
    2, // 2h transfer interval
    batches,
    INITIAL_PREVENTATIVES,
    {}, // auto locate
    batch2Id
  );
  batches.push({
    id: batch2Id,
    lotNumber: 'PRM-1065698',
    productId: recPremier.id,
    startDateTime: '2026-06-03T12:00:00.000Z',
    transferIntervalHours: 2,
    steps: steps2
  });

  return batches;
}
