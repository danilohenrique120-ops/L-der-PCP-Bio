/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type ScaleType = 'Erlenmeyer' | 'Balão' | '100L' | '500L' | '3000_5000L' | 'Envase';

export interface StepDefinition {
  id: string;
  scaleType: ScaleType;
  durationHours: number;
}

export interface ProductRecipe {
  id: string;
  name: string;
  color: string; // Tailwind color name like 'blue', 'emerald', 'amber', 'purple', 'rose', etc.
  yieldPerBatch: number; // Volume yielded per batch in liters/doses
  steps: StepDefinition[];
  fermentationTimeHours?: number;
  cipSipTimeHours?: number;
  chargeDischargeTimeHours?: number;
  batchVolume?: number;
}

export interface CapacityParams {
  workingDaysPerMonth: number;
  shiftsPerDay: number;
  hoursPerShift: number;
  maintenanceHoursPerMonth: number;
  bioreactorCount: number;
  fillingMachineCount: number;
  fillingFlowRateLPH: number;
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
}

export interface ScheduledStep {
  scaleType: ScaleType;
  durationHours: number;
  startDateTime: string; // ISO String
  endDateTime: string;   // ISO String
  assetId: string;       // Assigned asset ID (e.g. 'B01', 'Rota 0')
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

// Fixed industrial process assets mapping
export function getAssetsPool(envaseCount: number = 3): Asset[] {
  return [
    // Erlenmeyer (Rota 0 a 8)
    ...Array.from({ length: 9 }, (_, i) => ({
      id: `erlen-r${i}`,
      name: `Erlen - Rota ${i}`,
      scaleType: 'Erlenmeyer' as const,
      categoryLabel: 'Erlenmeyer (Rotas 0-8)'
    })),
    // Balão (Rota 1 a 6)
    ...Array.from({ length: 6 }, (_, i) => ({
      id: `balao-r${i + 1}`,
      name: `Balão - Rota ${i + 1}`,
      scaleType: 'Balão' as const,
      categoryLabel: 'Balão (Rotas 1-6)'
    })),
    // Tanques 100L (B01 a B05)
    ...Array.from({ length: 5 }, (_, i) => ({
      id: `B0${i + 1}`,
      name: `B0${i + 1} (100L)`,
      scaleType: '100L' as const,
      categoryLabel: 'Tanques 100L'
    })),
    // Tanques 500L (B06 a B10)
    ...Array.from({ length: 5 }, (_, i) => ({
      id: `B${String(i + 6).padStart(2, '0')}`,
      name: `B${String(i + 6).padStart(2, '0')} (500L)`,
      scaleType: '500L' as const,
      categoryLabel: 'Tanques 500L'
    })),
    // Tanques 5000L/3000L (B11 a B16)
    ...Array.from({ length: 6 }, (_, i) => ({
      id: `B${i + 11}`,
      name: `B${i + 11} (3k/5kL)`,
      scaleType: '3000_5000L' as const,
      categoryLabel: 'Tanques 3000L/5000L'
    })),
    // Linha de Envase - dynamically generated
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
