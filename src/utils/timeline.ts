/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ProductRecipe, ScheduledStep, ASSETS_POOL, Batch, Preventative, ScaleType, Asset, ShiftConfig, PlanningErrorLog, getAssetsPool, normalizeAssetId } from '../types';

/**
 * Checks if two date range intervals overlap
 */
export function areIntervalsOverlapping(
  start1: Date | string,
  end1: Date | string,
  start2: Date | string,
  end2: Date | string
): boolean {
  const s1 = new Date(start1).getTime();
  const e1 = new Date(end1).getTime();
  const s2 = new Date(start2).getTime();
  const e2 = new Date(end2).getTime();

  return s1 < e2 && s2 < e1;
}

/**
 * Finds the first asset of a given ScaleType that has NO scheduling overlaps
 * with any existing batches or preventatives during the specified timeframe (including setup/preparation times).
 * If all assets are busy, returns the first asset of that type and flags it.
 */
export function findFirstAvailableAsset(
  scaleType: ScaleType,
  start: Date | string,
  end: Date | string,
  existingBatches: Batch[],
  preventatives: Preventative[],
  ignoreBatchId?: string,
  setupTimes?: Record<ScaleType, number>,
  envaseLinesCount?: number
): { asset: Asset; hasConflict: boolean } {
  const envaseCount = envaseLinesCount || 3;
  const compatibleAssets = getAssetsPool(envaseCount).filter(a => a.scaleType === scaleType);
  if (compatibleAssets.length === 0) {
    throw new Error(`Nenhum ativo configurado para a escala: ${scaleType}`);
  }

  const s1 = new Date(start).getTime();
  const e1 = new Date(end).getTime();
  const setup1 = setupTimes ? (setupTimes[scaleType] || 0) : 0;
  const e1Setup = e1 + setup1 * 60 * 60 * 1000;

  for (const asset of compatibleAssets) {
    let hasOverlap = false;

    // Check overlaps with other batches taking setup times into account
    for (const batch of existingBatches) {
      if (batch.id === ignoreBatchId) continue;
      for (const step of batch.steps) {
        if (normalizeAssetId(step.assetId, envaseCount) === asset.id) {
          const s2 = new Date(step.startDateTime).getTime();
          const e2 = new Date(step.endDateTime).getTime();
          const setup2 = setupTimes ? (setupTimes[step.scaleType] || 0) : 0;
          const e2Setup = e2 + setup2 * 60 * 60 * 1000;

          if (s1 < e2Setup && s2 < e1Setup) {
            hasOverlap = true;
            break;
          }
        }
      }
      if (hasOverlap) break;
    }

    if (!hasOverlap) {
      // Check overlaps with preventatives
      for (const prev of preventatives) {
        if (normalizeAssetId(prev.assetId, envaseCount) === asset.id) {
          const pStart = new Date(prev.startDateTime).getTime();
          const pEnd = new Date(prev.endDateTime).getTime();

          if (s1 < pEnd && pStart < e1Setup) {
            hasOverlap = true;
            break;
          }
        }
      }
    }

    if (!hasOverlap) {
      return { asset, hasConflict: false };
    }
  }

  return { asset: compatibleAssets[0], hasConflict: true };
}

/**
 * Calculates a complete batch timeline based on product recipe and start time.
 * If autoAllocate is true, it queries existing list of scheduled batches to find free assets.
 * Otherwise, it can take manual step allocations.
 */
export function calculateProductionTimeline(
  recipe: ProductRecipe,
  startDateTimeStr: string,
  transferIntervalHours: number,
  existingBatches: Batch[],
  preventatives: Preventative[],
  manualAllocations?: Record<string, string>, // stepIndex -> assetId
  ignoreBatchId?: string,
  setupTimes?: Record<ScaleType, number>,
  envaseLinesCount?: number
): ScheduledStep[] {
  const envaseCount = envaseLinesCount || 3;
  const steps: ScheduledStep[] = [];
  let currentStart = new Date(startDateTimeStr);

  for (let idx = 0; idx < recipe.steps.length; idx++) {
    const stepDef = recipe.steps[idx];
    const durationHours = stepDef.durationHours;
    
    // Calculate end date
    const currentEnd = new Date(currentStart.getTime() + durationHours * 60 * 60 * 1000);

    let finalAssetId = '';
    
    if (manualAllocations && manualAllocations[idx]) {
      finalAssetId = normalizeAssetId(manualAllocations[idx], envaseCount);
    } else {
      // Find available asset automatically
      const { asset } = findFirstAvailableAsset(
        stepDef.scaleType,
        currentStart,
        currentEnd,
        existingBatches,
        preventatives,
        ignoreBatchId,
        setupTimes,
        envaseCount
      );
      finalAssetId = asset.id;
    }

    steps.push({
      scaleType: stepDef.scaleType,
      durationHours,
      startDateTime: currentStart.toISOString(),
      endDateTime: currentEnd.toISOString(),
      assetId: finalAssetId
    });

    // Next step starts after the end of the current step + transfer interval
    currentStart = new Date(currentEnd.getTime() + transferIntervalHours * 60 * 60 * 1000);
  }

  return steps;
}

/**
 * Parses and formats dates for display
 */
export function formatFullDate(isoString: string): string {
  if (!isoString) return '';
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return '';
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${day}/${month}/${year} ${hour}:${minute}`;
}

export function formatShortDate(isoString: string): string {
  if (!isoString) return '';
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return '';
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${day}/${month} ${hour}:${minute}`;
}

/**
 * Calculates ISO week number and year
 */
export function getWeekNumber(d: Date): { week: number; year: number } {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return { week: weekNo, year: date.getUTCFullYear() };
}

export function parseTimeToMinutes(timeStr: string): number {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function isDateTimeInWorkingHours(dateTime: Date | string, config: ShiftConfig): boolean {
  const date = new Date(dateTime);
  const day = date.getDay();
  const minutes = date.getHours() * 60 + date.getMinutes();
  
  const shifts = config?.shifts || [];
  if (shifts.length === 0) {
    return true; // No shifts configured is a fallback
  }
  
  return shifts.some(sh => {
    if (!sh.workDays || !sh.workDays.includes(day)) {
      return false;
    }
    const startMin = parseTimeToMinutes(sh.startHour);
    const endMin = parseTimeToMinutes(sh.endHour);
    
    if (startMin <= endMin) {
      return minutes >= startMin && minutes <= endMin;
    } else {
      // Overnight shift (e.g. 22:00 to 06:00)
      return minutes >= startMin || minutes <= endMin;
    }
  });
}

export function getDayName(day: number): string {
  const days = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
  return days[day] || '';
}

export interface ShiftValidationResult {
  isValid: boolean;
  hasIndustrialViolation: boolean;
  hasInoculumViolation: boolean;
  reason?: string;
  failedStep?: string;
  failedTime?: string;
}

export function validateBatchShifts(
  steps: ScheduledStep[],
  shiftConfig: ShiftConfig
): ShiftValidationResult {
  if (!steps || steps.length === 0) {
    return { isValid: true, hasIndustrialViolation: false, hasInoculumViolation: false };
  }

  // 1. Validação do Início da Inoculação (Primeira etapa)
  const firstStep = steps[0];
  if (!isDateTimeInWorkingHours(firstStep.startDateTime, shiftConfig)) {
    return {
      isValid: false,
      hasIndustrialViolation: false,
      hasInoculumViolation: true,
      failedStep: firstStep.scaleType,
      failedTime: firstStep.startDateTime,
      reason: `Inoculação (${firstStep.scaleType}) em ${formatFullDate(firstStep.startDateTime)} (${getDayName(new Date(firstStep.startDateTime).getDay())}) caiu fora de todos os turnos de trabalho ativos.`
    };
  }

  // 2. Validação do Início e Término do Envase (Etapa final)
  const lastStep = steps[steps.length - 1];
  if (lastStep.scaleType === 'Envase') {
    if (!isDateTimeInWorkingHours(lastStep.startDateTime, shiftConfig)) {
      return {
        isValid: false,
        hasIndustrialViolation: true,
        hasInoculumViolation: false,
        failedStep: 'Envase',
        failedTime: lastStep.startDateTime,
        reason: `Início do Envase em ${formatFullDate(lastStep.startDateTime)} (${getDayName(new Date(lastStep.startDateTime).getDay())}) caiu fora de todos os turnos de trabalho ativos.`
      };
    }
    if (!isDateTimeInWorkingHours(lastStep.endDateTime, shiftConfig)) {
      return {
        isValid: false,
        hasIndustrialViolation: true,
        hasInoculumViolation: false,
        failedStep: 'Envase',
        failedTime: lastStep.endDateTime,
        reason: `Término do Envase em ${formatFullDate(lastStep.endDateTime)} (${getDayName(new Date(lastStep.endDateTime).getDay())}) caiu fora de todos os turnos de trabalho ativos.`
      };
    }
  }

  return {
    isValid: true,
    hasIndustrialViolation: false,
    hasInoculumViolation: false
  };
}

export interface ScheduleAttemptResult {
  success: boolean;
  steps: ScheduledStep[];
  startDateTime: string;
  errorReason?: string;
}

/**
 * Checks if a proposed set of scheduled steps conflicts with any existing batches or preventatives, implementing setup times.
 */
export function checkStepsOverlap(
  steps: ScheduledStep[],
  existingBatches: Batch[],
  preventatives: Preventative[],
  ignoreBatchId?: string,
  setupTimes?: Record<ScaleType, number>,
  envaseLinesCount?: number
): boolean {
  const envaseCount = envaseLinesCount || 3;
  for (const step of steps) {
    const s1 = new Date(step.startDateTime).getTime();
    const e1 = new Date(step.endDateTime).getTime();
    const setup1 = setupTimes ? (setupTimes[step.scaleType] || 0) : 0;
    const e1Setup = e1 + setup1 * 60 * 60 * 1000;
    const stepAssetId = normalizeAssetId(step.assetId, envaseCount);

    // Overlap with preventatives
    const isBlockPrev = preventatives.some(p => {
      if (normalizeAssetId(p.assetId, envaseCount) !== stepAssetId) return false;
      const pStart = new Date(p.startDateTime).getTime();
      const pEnd = new Date(p.endDateTime).getTime();
      return s1 < pEnd && pStart < e1Setup;
    });
    if (isBlockPrev) return true;

    // Overlap with other batches
    const isBlockBatch = existingBatches.some(b => {
      if (b.id === ignoreBatchId) return false;
      return b.steps.some(st => {
        if (normalizeAssetId(st.assetId, envaseCount) !== stepAssetId) return false;
        const s2 = new Date(st.startDateTime).getTime();
        const e2 = new Date(st.endDateTime).getTime();
        const setup2 = setupTimes ? (setupTimes[st.scaleType] || 0) : 0;
        const e2Setup = e2 + setup2 * 60 * 60 * 1000;
        return s1 < e2Setup && s2 < e1Setup;
      });
    });
    if (isBlockBatch) return true;
  }
  return false;
}

/**
 * Attempts to schedule a batch starting from a preferred date.
 * If shifts or assets conflict, it tries backward scheduling (shifting start time earlier hour-by-hour) up to 168 hours (7 days).
 */
export function tryScheduleBatchBackward(
  recipe: ProductRecipe,
  preferredStartStr: string,
  transferIntervalHours: number,
  existingBatches: Batch[],
  preventatives: Preventative[],
  shiftConfig: ShiftConfig,
  manualAllocations?: Record<string, string>,
  ignoreBatchId?: string,
  setupTimes?: Record<ScaleType, number>,
  envaseLinesCount?: number
): ScheduleAttemptResult {
  const envaseCount = envaseLinesCount || 3;
  const preferredStart = new Date(preferredStartStr);
  let bestFallback: ScheduleAttemptResult | null = null;
  let initialErrorReason = '';

  const testCandidate = (startDate: Date): { success: boolean; isPerfect: boolean; steps: ScheduledStep[]; reason?: string } => {
    try {
      const steps = calculateProductionTimeline(
        recipe,
        startDate.toISOString(),
        transferIntervalHours,
        existingBatches,
        preventatives,
        manualAllocations,
        ignoreBatchId,
        setupTimes,
        envaseCount
      );

      const shiftVal = validateBatchShifts(steps, shiftConfig);
      const hasOverlap = checkStepsOverlap(steps, existingBatches, preventatives, ignoreBatchId, setupTimes, envaseCount);

      if (hasOverlap) {
        return { success: false, isPerfect: false, steps: [], reason: 'Conflito com outro lote ou preventiva.' };
      }

      if (shiftVal.hasIndustrialViolation) {
        return { success: false, isPerfect: false, steps: [], reason: shiftVal.reason };
      }

      return {
        success: true,
        isPerfect: !shiftVal.hasInoculumViolation,
        steps,
        reason: shiftVal.reason
      };
    } catch (err: any) {
      return { success: false, isPerfect: false, steps: [], reason: err.message };
    }
  };

  // 1. Initial direct forward check
  const preferredRes = testCandidate(preferredStart);
  if (preferredRes.success) {
    if (preferredRes.isPerfect) {
      return {
        success: true,
        steps: preferredRes.steps,
        startDateTime: preferredStartStr
      };
    } else {
      bestFallback = {
        success: true,
        steps: preferredRes.steps,
        startDateTime: preferredStartStr,
        errorReason: preferredRes.reason
      };
    }
  } else {
    initialErrorReason = preferredRes.reason || '';
  }

  // 2. BACKWARD SCHEDULING - Search up to 168 hours backward
  for (let hoursBack = 1; hoursBack <= 168; hoursBack++) {
    const testStart = new Date(preferredStart.getTime() - hoursBack * 60 * 60 * 1000);
    const res = testCandidate(testStart);
    if (res.success) {
      if (res.isPerfect) {
        return {
          success: true,
          steps: res.steps,
          startDateTime: testStart.toISOString()
        };
      } else if (!bestFallback) {
        bestFallback = {
          success: true,
          steps: res.steps,
          startDateTime: testStart.toISOString(),
          errorReason: res.reason
        };
      }
    }
  }

  // 3. FORWARD SCHEDULING - Try to search forward as fallback (up to 7 days)
  for (let hoursForward = 1; hoursForward <= 168; hoursForward++) {
    const testStart = new Date(preferredStart.getTime() + hoursForward * 60 * 60 * 1000);
    const res = testCandidate(testStart);
    if (res.success) {
      if (res.isPerfect) {
        return {
          success: true,
          steps: res.steps,
          startDateTime: testStart.toISOString()
        };
      } else if (!bestFallback) {
        bestFallback = {
          success: true,
          steps: res.steps,
          startDateTime: testStart.toISOString(),
          errorReason: res.reason
        };
      }
    }
  }

  if (bestFallback) {
    return bestFallback;
  }

  return {
    success: false,
    steps: [],
    startDateTime: preferredStartStr,
    errorReason: `Falha ao programar lote devido a restrição de turnos ou colisão física. Detalhes: ${initialErrorReason}`
  };
}

/**
 * Calculates theoretical inoculation start date by working backward from an Envase start date,
 * by subtracting the durations of all preceding stages and their transfer intervals.
 */
export function getInoculationDateFromEnvaseStart(
  recipe: ProductRecipe,
  envaseStartDate: Date,
  transferIntervalHours: number
): Date {
  let totalHoursBeforeEnvase = 0;
  for (let i = 0; i < recipe.steps.length - 1; i++) {
    totalHoursBeforeEnvase += recipe.steps[i].durationHours + transferIntervalHours;
  }
  return new Date(envaseStartDate.getTime() - totalHoursBeforeEnvase * 60 * 60 * 1000);
}

/**
 * Generates an automatic campaign timeline for a target volume,
 * implementing staggered scheduling based on packaging line availability and backward offsets.
 */
export function generateAutomaticPlanning(
  recipe: ProductRecipe,
  targetVolume: number,
  startDateStr: string,
  existingBatches: Batch[],
  preventatives: Preventative[],
  shiftConfig: ShiftConfig,
  setupTimes?: Record<ScaleType, number>,
  envaseLinesCount?: number
): {
  scheduledBatches: Batch[];
  outOfShiftBatches: Batch[];
  errors: PlanningErrorLog[];
} {
  const envaseCount = envaseLinesCount || 3;
  const scheduledBatches: Batch[] = [];
  const outOfShiftBatches: Batch[] = [];
  const errors: PlanningErrorLog[] = [];
  
  const batchesNeeded = Math.ceil(targetVolume / recipe.yieldPerBatch);
  if (batchesNeeded <= 0) {
    return { scheduledBatches, outOfShiftBatches, errors };
  }

  // Create active pool copying existing schedule
  const activeBatchesPool = [...existingBatches];

  const scanLimitHours = 1080; // 45 days search window

  for (let lotIdx = 0; lotIdx < batchesNeeded; lotIdx++) {
    const lotNumber = `${recipe.name.substring(0, 3).toUpperCase()}-L${String(1000 + lotIdx + 1).substring(1)}`;

    let baseStartMs = new Date(startDateStr).getTime();
    if (lotIdx > 0) {
      const allPrev = [...scheduledBatches, ...outOfShiftBatches];
      if (allPrev.length > 0) {
        const prevStartMs = new Date(allPrev[allPrev.length - 1].startDateTime).getTime();
        baseStartMs = Math.max(baseStartMs, prevStartMs + 60 * 60 * 1000);
      }
    }

    let lotScheduled = false;

    let foundPerfectStart = '';
    let foundPerfectSteps: ScheduledStep[] = [];

    let foundFlexibleStart = '';
    let foundFlexibleSteps: ScheduledStep[] = [];
    let flexibleReason = '';

    let foundBypassStart = '';
    let foundBypassSteps: ScheduledStep[] = [];
    let bypassReason = '';

    for (let offset = 0; offset <= scanLimitHours; offset++) {
      const candidateStart = new Date(baseStartMs + offset * 60 * 60 * 1000);

      try {
        const candidateSteps = calculateProductionTimeline(
          recipe,
          candidateStart.toISOString(),
          0,
          activeBatchesPool,
          preventatives,
          undefined,
          undefined,
          setupTimes,
          envaseCount
        );

        const hasOverlap = checkStepsOverlap(candidateSteps, activeBatchesPool, preventatives, undefined, setupTimes, envaseCount);
        if (hasOverlap) {
          continue; // Physical collision -> try next hour
        }

        const shiftVal = validateBatchShifts(candidateSteps, shiftConfig);
        
        if (shiftVal.isValid) {
          foundPerfectStart = candidateStart.toISOString();
          foundPerfectSteps = candidateSteps;
          lotScheduled = true;
          break; // Perfect in-shift slot found!
        } else {
          if (!shiftVal.hasIndustrialViolation) {
            if (!foundFlexibleStart) {
              foundFlexibleStart = candidateStart.toISOString();
              foundFlexibleSteps = candidateSteps;
              flexibleReason = shiftVal.reason || 'Necessita inoculação (Erlenmeyer/Balão) fora do turno.';
            }
          } else {
            if (!foundBypassStart) {
              foundBypassStart = candidateStart.toISOString();
              foundBypassSteps = candidateSteps;
              bypassReason = shiftVal.reason || 'Conflito de turnos industriais (Envase).';
            }
          }
        }
      } catch (err: any) {
        // Rota mapping issue, seek next hour
      }
    }

    if (lotScheduled && foundPerfectStart && foundPerfectSteps.length > 0) {
      const newBatch: Batch = {
        id: `auto-batch-${recipe.id}-${Date.now()}-${lotIdx}`,
        lotNumber,
        productId: recipe.id,
        startDateTime: foundPerfectStart,
        transferIntervalHours: 0,
        steps: foundPerfectSteps
      };

      scheduledBatches.push(newBatch);
      activeBatchesPool.push(newBatch);
    } else {
      const chosenSteps = foundFlexibleSteps.length > 0 ? foundFlexibleSteps : foundBypassSteps;
      const chosenStart = foundFlexibleStart || foundBypassStart;

      if (chosenSteps.length > 0 && chosenStart) {
        const newBatch: Batch = {
          id: `auto-batch-bypass-${recipe.id}-${Date.now()}-${lotIdx}`,
          lotNumber,
          productId: recipe.id,
          startDateTime: chosenStart,
          transferIntervalHours: 0,
          steps: chosenSteps
        };

        outOfShiftBatches.push(newBatch);
        activeBatchesPool.push(newBatch);

        const isFlex = foundFlexibleStart && chosenStart === foundFlexibleStart;
        errors.push({
          id: `err-bypass-${recipe.id}-${Date.now()}-${lotIdx}`,
          lotNumber,
          productName: recipe.name,
          timestamp: new Date().toISOString(),
          reason: isFlex ? `Turno Flexível (Inoculação): ${flexibleReason}` : `Turno Operacional (Envase): ${bypassReason}`,
          productId: recipe.id,
          startDateTime: chosenStart,
          canBypass: true
        });
      } else {
        errors.push({
          id: `err-absolute-${recipe.id}-${Date.now()}-${lotIdx}`,
          lotNumber,
          productName: recipe.name,
          timestamp: new Date().toISOString(),
          reason: `Lote ${lotNumber} totalmente inviabilizado: Sem reatores ou rota física livre no período analisado (incluindo setup).`,
          canBypass: false
        });
      }
    }
  }

  return {
    scheduledBatches,
    outOfShiftBatches,
    errors
  };
}

export interface ProductSuggestionDetail {
  recipeId: string;
  recipeName: string;
  color?: string;
  targetVolume: number;
  scheduledVolume: number;
  batchesScheduledCount: number;
  yieldPerBatch: number;
}

export interface StartTimeSuggestion {
  startDateTime: string;
  endDateTime: string;
  volumeScheduled: number;
  batchesScheduledCount: number;
  hasErrors: boolean;
  errorsCount: number;
  requiresBypass: boolean;
  errors: PlanningErrorLog[];
  productDetails?: ProductSuggestionDetail[];
}

/**
 * Sweeps the entire active month to find the best candidate start times for a campaign.
 */
export function findBestStartTimes(
  year: number,
  monthIndex: number,
  campaignItems: { recipe: ProductRecipe; targetVolume: number }[],
  existingBatches: Batch[],
  preventatives: Preventative[],
  shiftConfig: ShiftConfig,
  setupTimes: Record<ScaleType, number>,
  envaseLinesCount: number,
  restrictToMonth: boolean
): StartTimeSuggestion[] {
  const suggestions: StartTimeSuggestion[] = [];
  const targetMonthStartMs = new Date(year, monthIndex, 1, 0, 0, 0).getTime();
  const targetMonthEndMs = new Date(year, monthIndex + 1, 0, 23, 59, 59).getTime();
  
  let leadTimeHours = 0;
  if (campaignItems.length > 0) {
    const recipe = campaignItems[0].recipe;
    for (let i = 0; i < recipe.steps.length - 1; i++) {
      leadTimeHours += recipe.steps[i].durationHours;
    }
    leadTimeHours += (recipe.steps.length - 2) * 2; // buffer transfer
  }
  if (leadTimeHours <= 0) leadTimeHours = 96;

  const sweepStartMs = restrictToMonth 
    ? targetMonthStartMs - leadTimeHours * 60 * 60 * 1000 
    : targetMonthStartMs;

  const testPoints: Date[] = [];
  let currentTest = new Date(sweepStartMs);
  currentTest.setMinutes(0, 0, 0);
  if (currentTest.getHours() % 2 !== 0) {
    currentTest.setHours(currentTest.getHours() + 1);
  }

  while (currentTest.getTime() <= targetMonthEndMs) {
    testPoints.push(new Date(currentTest.getTime()));
    currentTest.setHours(currentTest.getHours() + 2);
  }
  
  const formatLocal = (d: Date): string => {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  for (const point of testPoints) {
    const startStr = formatLocal(point);
    let activePool = [...existingBatches];
    let totalVolumeScheduled = 0;
    let totalBatchesScheduled = 0;
    let totalErrors: PlanningErrorLog[] = [];
    let maxEndMs = new Date(startStr).getTime();
    const productDetails: ProductSuggestionDetail[] = [];
    
    for (const item of campaignItems) {
      const result = generateAutomaticPlanning(
        item.recipe,
        item.targetVolume,
        startStr,
        activePool,
        preventatives,
        shiftConfig,
        setupTimes,
        envaseLinesCount
      );
      
      let batchesToCount = result.scheduledBatches;
      if (restrictToMonth) {
        batchesToCount = result.scheduledBatches.filter(b => {
          const envaseStep = b.steps.find(s => s.scaleType === 'Envase');
          if (!envaseStep) return false;
          const envaseStartMs = new Date(envaseStep.startDateTime).getTime();
          const envaseEndMs = new Date(envaseStep.endDateTime).getTime();
          return envaseEndMs >= targetMonthStartMs && envaseStartMs <= targetMonthEndMs;
        });
      }

      const itemScheduledVol = batchesToCount.length * item.recipe.yieldPerBatch;
      productDetails.push({
        recipeId: item.recipe.id,
        recipeName: item.recipe.name,
        color: item.recipe.color,
        targetVolume: item.targetVolume,
        scheduledVolume: itemScheduledVol,
        batchesScheduledCount: batchesToCount.length,
        yieldPerBatch: item.recipe.yieldPerBatch
      });
      
      if (batchesToCount.length > 0) {
        totalBatchesScheduled += batchesToCount.length;
        totalVolumeScheduled += itemScheduledVol;
        activePool.push(...batchesToCount);
        
        batchesToCount.forEach(b => {
          b.steps.forEach(s => {
            const t = new Date(s.endDateTime).getTime();
            if (t > maxEndMs) maxEndMs = t;
          });
        });
      }
      
      if (result.errors.length > 0) {
        const filteredErrors = result.errors.filter(err => {
          if (!err.startDateTime) return true;
          const errStartMs = new Date(err.startDateTime).getTime();
          return !restrictToMonth || (errStartMs >= targetMonthStartMs && errStartMs <= targetMonthEndMs);
        });
        totalErrors.push(...filteredErrors);
      }
    }
    
    if (totalBatchesScheduled > 0) {
      const endStr = formatLocal(new Date(maxEndMs));
      const requiresBypass = totalErrors.some(e => e.canBypass);
      
      suggestions.push({
        startDateTime: startStr,
        endDateTime: endStr,
        volumeScheduled: totalVolumeScheduled,
        batchesScheduledCount: totalBatchesScheduled,
        hasErrors: totalErrors.length > 0,
        errorsCount: totalErrors.length,
        requiresBypass,
        errors: totalErrors,
        productDetails
      });
    }
  }
  
  suggestions.sort((a, b) => {
    if (b.volumeScheduled !== a.volumeScheduled) {
      return b.volumeScheduled - a.volumeScheduled;
    }
    if (a.errorsCount !== b.errorsCount) {
      return a.errorsCount - b.errorsCount;
    }
    return new Date(a.endDateTime).getTime() - new Date(b.endDateTime).getTime();
  });
  
  const uniqueSuggestions: StartTimeSuggestion[] = [];
  const seenStarts = new Set<string>();
  
  for (const sug of suggestions) {
    if (!seenStarts.has(sug.startDateTime)) {
      seenStarts.add(sug.startDateTime);
      uniqueSuggestions.push(sug);
      if (uniqueSuggestions.length >= 5) break;
    }
  }
  
  return uniqueSuggestions;
}
