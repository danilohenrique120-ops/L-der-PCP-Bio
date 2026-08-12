/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type ScaleType = 'Erlenmeyer' | 'Balão' | '100L' | '500L' | '3000L' | '5000L' | '3000_5000L' | 'Envase' | string;

export interface StepDefinition {
  id: string;
  scaleType: ScaleType;
  durationHours: number;
}

export interface ProductRecipe {
  id: string;
  name: string;
  color: string; // Tailwind color name like 'blue', 'emerald', 'amber', 'purple', 'rose', etc.
  yieldPerBatch: number; // Standard / 5kL Volume yielded per batch in liters
  yield3kL?: number;     // Custom volume yielded when fermented in a 3kL reactor
  yield500L?: number;    // Custom volume yielded when fermented in a 500L reactor
  yield100L?: number;    // Custom volume yielded when fermented in a 100L reactor
  finalStepIndex?: number; // Index of step that marks final line completion and yields volume
  steps: StepDefinition[];
  fermentationTimeHours?: number;
  cipSipTimeHours?: number;
  chargeDischargeTimeHours?: number;
  batchVolume?: number;
}

export interface Shift {
  id: string;
  name: string;
  startHour: string;
  endHour: string;
  workDays: number[];
}

export interface ShiftConfig {
  shifts: Shift[];
}

export interface PlanningErrorLog {
  id: string;
  lotNumber: string;
  productName: string;
  timestamp: string;
  reason: string;
  productId?: string;
  startDateTime?: string;
  canBypass?: boolean;
}

export interface Asset {
  id: string;
  name: string;
  scaleType: ScaleType;
  categoryLabel: string;
  capacityLiters?: number;
}

export interface ScheduledStep {
  scaleType: ScaleType;
  durationHours: number;
  startDateTime: string; // ISO String
  endDateTime: string;   // ISO String
  assetId: string;       // Assigned asset ID (e.g. 'B01', 'Rota 0')
  opNumber?: string;       // Dedicated OP for this scale/step
  parentOpNumber?: string; // Consumed/Empenhada OP from previous scale
}

export interface Batch {
  id: string;
  lotNumber: string;
  productId: string;
  startDateTime: string; // ISO String for inoculação
  transferIntervalHours: number; // Configurable interval between steps
  steps: ScheduledStep[];
  isContaminated?: boolean;
  contaminatedStepIndex?: number;
  contaminationReason?: string;
  contaminationNotes?: string;
}

export interface DeviationLog {
  id: string;
  timestamp: string; // ISO String
  type: 'CONTAMINATION' | 'DELAY' | 'ROUTE_CHANGE';
  lotNumber: string;
  productId: string;
  productName: string;
  stepScaleType: ScaleType;
  reason: string;
  category?: string;
  notes: string;
  details: string;
}

export interface Preventative {
  id: string;
  assetId: string;
  description: string;
  startDateTime: string; // ISO String
  endDateTime: string;   // ISO String
}

export interface FactoryScaleCounts {
  erlenmeyerCount: number; // Rotas 0 a N-1
  balaoCount: number;      // Rotas 1 a N
  b100LCount: number;      // Biorreatores 100L
  b500LCount: number;      // Biorreatores 500L
  b5kLCount: number;       // Biorreatores 3000L/5000L
  envaseCount: number;     // Máquinas de Envase
}

export const DEFAULT_SCALE_COUNTS: FactoryScaleCounts = {
  erlenmeyerCount: 9,
  balaoCount: 6,
  b100LCount: 5,
  b500LCount: 5,
  b5kLCount: 6,
  envaseCount: 3
};

// Configurable industrial process assets mapping
export function getAssetsPool(counts?: Partial<FactoryScaleCounts> | number): Asset[] {
  const c = typeof counts === 'number' 
    ? { ...DEFAULT_SCALE_COUNTS, envaseCount: counts } 
    : { ...DEFAULT_SCALE_COUNTS, ...(counts || {}) };

  const erlenCount = Math.max(0, c.erlenmeyerCount);
  const balaoCount = Math.max(0, c.balaoCount);
  const b100Count = Math.max(0, c.b100LCount);
  const b500Count = Math.max(0, c.b500LCount);
  const b5kCount = Math.max(0, c.b5kLCount);
  const envaseCount = Math.max(1, c.envaseCount);

  return [
    // Erlenmeyer (Rota 0 a N-1)
    ...Array.from({ length: erlenCount }, (_, i) => ({
      id: `erlen-r${i}`,
      name: `Erlen - Rota ${i}`,
      scaleType: 'Erlenmeyer' as const,
      categoryLabel: `Erlenmeyer (Rotas 0-${erlenCount - 1})`
    })),
    // Balão (Rota 1 a N)
    ...Array.from({ length: balaoCount }, (_, i) => ({
      id: `balao-r${i + 1}`,
      name: `Balão - Rota ${i + 1}`,
      scaleType: 'Balão' as const,
      categoryLabel: `Balão (Rotas 1-${balaoCount})`
    })),
    // Tanques 100L
    ...Array.from({ length: b100Count }, (_, i) => ({
      id: `B${String(i + 1).padStart(2, '0')}`,
      name: `B${String(i + 1).padStart(2, '0')} (100L)`,
      scaleType: '100L' as const,
      categoryLabel: 'Tanques 100L',
      capacityLiters: 100
    })),
    // Tanques 500L
    ...Array.from({ length: b500Count }, (_, i) => {
      const num = String(i + 1 + b100Count).padStart(2, '0');
      return {
        id: `B${num}`,
        name: `B${num} (500L)`,
        scaleType: '500L' as const,
        categoryLabel: 'Tanques 500L',
        capacityLiters: 500
      };
    }),
    // Tanques 5000L / 3000L (B11 a B14 = 5kL, B15 a B16 = 3kL)
    ...Array.from({ length: b5kCount }, (_, i) => {
      const num = i + 1 + b100Count + b500Count;
      const is3k = (num === 15 || num === 16);
      const cap = is3k ? 3000 : 5000;
      const labelCap = is3k ? '3kL' : '5kL';
      return {
        id: `B${num}`,
        name: `B${num} (${labelCap})`,
        scaleType: '3000_5000L' as const,
        categoryLabel: 'Tanques 3000L/5000L',
        capacityLiters: cap
      };
    }),
    // Linha de Envase - 1 linha por máquina física
    ...Array.from({ length: envaseCount }, (_, i) => ({
      id: `envase-m${i + 1}`,
      name: `Envase - Máquina ${i + 1}`,
      scaleType: 'Envase' as const,
      categoryLabel: 'Linha de Envase'
    }))
  ];
}

export function normalizeAssetId(assetId: string, envaseCount: number = 3): string {
  if (assetId === 'quality') return 'envase-m1';
  if (assetId === 'embalagem') return envaseCount >= 2 ? 'envase-m2' : 'envase-m1';
  if (assetId === 'dissolutor') return envaseCount >= 3 ? 'envase-m3' : 'envase-m1';
  
  if (assetId.startsWith('envase-m')) {
    const parts = assetId.split('-');
    if (parts.length >= 2) {
      return `${parts[0]}-${parts[1]}`;
    }
  }

  return assetId;
}

export const ASSETS_POOL: Asset[] = getAssetsPool(3);

export const COLOR_OPTIONS = [
  { value: 'emerald', label: 'Verde (PREMIER)', bg: 'bg-emerald-500', text: 'text-emerald-500', border: 'border-emerald-600', hover: 'hover:bg-emerald-600' },
  { value: 'blue', label: 'Azul (SOJA)', bg: 'bg-blue-500', text: 'text-blue-500', border: 'border-blue-600', hover: 'hover:bg-blue-600' },
  { value: 'indigo', label: 'Indigo', bg: 'bg-indigo-500', text: 'text-indigo-500', border: 'border-indigo-600', hover: 'hover:bg-indigo-600' },
  { value: 'amber', label: 'Amarelo / Laranja', bg: 'bg-amber-500', text: 'text-amber-500', border: 'border-amber-600', hover: 'hover:bg-amber-600' },
  { value: 'purple', label: 'Roxo', bg: 'bg-purple-500', text: 'text-purple-500', border: 'border-purple-600', hover: 'hover:bg-purple-600' },
  { value: 'rose', label: 'Rosa / Vermelho', bg: 'bg-rose-500', text: 'text-rose-500', border: 'border-rose-600', hover: 'hover:bg-rose-600' },
  { value: 'cyan', label: 'Ciano', bg: 'bg-cyan-500', text: 'text-cyan-500', border: 'border-cyan-600', hover: 'hover:bg-cyan-600' }
];
