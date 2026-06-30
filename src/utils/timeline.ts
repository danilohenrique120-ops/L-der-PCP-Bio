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

          // Symmetrical overlap check incorporating execution and setup times
          if (s1 < e2Setup && s2 < e1Setup) {
            hasOverlap = true;
            break;
          }
        }
      }
      if (hasOverlap) break;
    }

    if (!hasOverlap) {
      // Check overlaps with preventatives (preventatives don't have secondary setups,
      // but they cannot overlap with the step execution or step setup)
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
      // Found a completely free asset
      return { asset, hasConflict: false };
    }
  }

  // Fallback: search was unsuccessful, return the first one but with conflict flag true
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
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

export function formatShortDate(isoString: string): string {
  if (!isoString) return '';
  const date = new Date(isoString);
  return date.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit'
  }) + ' ' + date.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit'
  });
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
    if (!sh.workDays.includes(day)) {
      return false;
    }
    const startMin = parseTimeToMinutes(sh.startHour);
    const endMin = parseTimeToMinutes(sh.endHour);
    return minutes >= startMin && minutes <= endMin;
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
  let hasIndustrialViolation = false;
  let hasInoculumViolation = false;
  let firstFailedStep = '';
  let firstFailedTime = '';
  let firstReason = '';

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const isIndustrial = !['Erlenmeyer', 'Balão'].includes(step.scaleType);
    
    // Inoculação / Scale transfer start
    if (!isDateTimeInWorkingHours(step.startDateTime, shiftConfig)) {
      const operationName = i === 0 ? "Inoculação" : `Trf. para ${step.scaleType}`;
      const reason = `${operationName} em ${formatFullDate(step.startDateTime)} (${getDayName(new Date(step.startDateTime).getDay())}) caiu fora de todos os turnos de trabalho ativos.`;
      
      if (isIndustrial) {
        hasIndustrialViolation = true;
        return {
          isValid: false,
          hasIndustrialViolation: true,
          hasInoculumViolation,
          failedStep: step.scaleType,
          failedTime: step.startDateTime,
          reason
        };
      } else {
        hasInoculumViolation = true;
        if (!firstReason) {
          firstFailedStep = step.scaleType;
          firstFailedTime = step.startDateTime;
          firstReason = reason;
        }
      }
    }
    
    // Transfer / Envase (scale end)
    if (!isDateTimeInWorkingHours(step.endDateTime, shiftConfig)) {
      const operationName = i === steps.length - 1 ? "Envase (Quality)" : `Trf. de ${step.scaleType}`;
      const reason = `${operationName} em ${formatFullDate(step.endDateTime)} (${getDayName(new Date(step.endDateTime).getDay())}) caiu fora de todos os turnos de trabalho ativos.`;
      
      if (isIndustrial) {
        hasIndustrialViolation = true;
        return {
          isValid: false,
          hasIndustrialViolation: true,
          hasInoculumViolation,
          failedStep: step.scaleType,
          failedTime: step.endDateTime,
          reason
        };
      } else {
        hasInoculumViolation = true;
        if (!firstReason) {
          firstFailedStep = step.scaleType;
          firstFailedTime = step.endDateTime;
          firstReason = reason;
        }
      }
    }
  }

  if (hasInoculumViolation) {
    return {
      isValid: false,
      hasIndustrialViolation: false,
      hasInoculumViolation: true,
      failedStep: firstFailedStep,
      failedTime: firstFailedTime,
      reason: firstReason
    };
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
 * Automatically plans and schedules several batches to meet a production volume goal, taking setup blocks and dynamic envaser count into parallel allocation.
 */
/**
 * Calculates the inoculation (Erlenmeyer start) date based on a target Envase start date
 * by subtracting the durations of all preceding stages and their transfer intervals.
 */
export function getInoculationDateFromEnvaseStart(
  recipe: ProductRecipe,
  envaseStartDate: Date,
  transferIntervalHours: number
): Date {
  let totalHoursBeforeEnvase = 0;
  // Sum durations of all steps except the last one (Envase) and their transfer intervals
  for (let i = 0; i < recipe.steps.length - 1; i++) {
    totalHoursBeforeEnvase += recipe.steps[i].durationHours + transferIntervalHours;
  }
  return new Date(envaseStartDate.getTime() - totalHoursBeforeEnvase * 60 * 60 * 1000);
}

/**
 * Automatically plans and schedules several batches to meet a production volume goal,
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
  errors: PlanningErrorLog[];
} {
  const envaseCount = envaseLinesCount || 3;
  const scheduledBatches: Batch[] = [];
  const errors: PlanningErrorLog[] = [];
  
  const batchesNeeded = Math.ceil(targetVolume / recipe.yieldPerBatch);
  if (batchesNeeded <= 0) {
    return { scheduledBatches, errors };
  }

  // Create active pool copying existing schedule
  const activeBatchesPool = [...existingBatches];
  
  // Track when the packaging bottleneck is next available
  let ProximoEnvaseDisponivel: Date | null = null;

  for (let lotIdx = 0; lotIdx < batchesNeeded; lotIdx++) {
    const lotNumber = `${recipe.name.substring(0, 3).toUpperCase()}-L${String(1000 + lotIdx + 1).substring(1)}`;
    let lotScheduled = false;

    let foundPerfectStart = '';
    let foundPerfectSteps: ScheduledStep[] = [];

    let foundFlexibleStart = '';
    let foundFlexibleSteps: ScheduledStep[] = [];
    let flexibleReason = '';

    let foundBypassStart = '';
    let foundBypassSteps: ScheduledStep[] = [];
    let bypassReason = '';

    if (lotIdx === 0) {
      // 1. First batch of the campaign starts Erlenmeyer exactly at the user's selected date
      const testStart = new Date(startDateStr);
      try {
        const candidateSteps = calculateProductionTimeline(
          recipe,
          testStart.toISOString(),
          0, // 0h standard transfer interval
          activeBatchesPool,
          preventatives,
          undefined,
          undefined,
          setupTimes,
          envaseCount
        );

        const hasOverlap = checkStepsOverlap(candidateSteps, activeBatchesPool, preventatives, undefined, setupTimes, envaseCount);
        const shiftVal = validateBatchShifts(candidateSteps, shiftConfig);

        if (!hasOverlap) {
          if (shiftVal.isValid) {
            foundPerfectStart = testStart.toISOString();
            foundPerfectSteps = candidateSteps;
            lotScheduled = true;
          } else if (!shiftVal.hasIndustrialViolation) {
            foundFlexibleStart = testStart.toISOString();
            foundFlexibleSteps = candidateSteps;
            flexibleReason = shiftVal.reason || 'Necessita inoculação (Erlenmeyer/Balão) fora do turno.';
          } else {
            foundBypassStart = testStart.toISOString();
            foundBypassSteps = candidateSteps;
            bypassReason = shiftVal.reason || 'Conflito de turnos industriais.';
          }
        }
      } catch (err: any) {
        // Mapping error or physical collision
      }

      // Compute the next available Envase date from Batch 1
      const chosenSteps = lotScheduled 
        ? foundPerfectSteps 
        : (foundFlexibleSteps.length > 0 ? foundFlexibleSteps : foundBypassSteps);

      if (chosenSteps.length > 0) {
        const envaseStep = chosenSteps[chosenSteps.length - 1];
        const setupHours = setupTimes ? (setupTimes['Envase'] || 0) : 0;
        ProximoEnvaseDisponivel = new Date(new Date(envaseStep.endDateTime).getTime() + setupHours * 60 * 60 * 1000);
      } else {
        // Theoretical fallback if Batch 1 failed completely
        let totalRecipeHours = 0;
        recipe.steps.forEach(st => {
          totalRecipeHours += st.durationHours;
        });
        const setupHours = setupTimes ? (setupTimes['Envase'] || 0) : 0;
        ProximoEnvaseDisponivel = new Date(new Date(startDateStr).getTime() + (totalRecipeHours + setupHours) * 60 * 60 * 1000);
      }
    } else {
      // 2. Subsequent batches: schedule backward from ProximoEnvaseDisponivel, shifting forward if busy
      const scanLimitHours = 1080; // 45 days limit to find a clear window
      const baseEnvaseStart = ProximoEnvaseDisponivel || new Date(startDateStr);
      
      for (let offset = 0; offset <= scanLimitHours; offset++) {
        const testEnvaseStart = new Date(baseEnvaseStart.getTime() + offset * 60 * 60 * 1000);
        const candidateStart = getInoculationDateFromEnvaseStart(recipe, testEnvaseStart, 0);

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
            continue; // Physical collision on reactor/preventatives is strictly forbidden
          }

          const shiftVal = validateBatchShifts(candidateSteps, shiftConfig);
          if (shiftVal.isValid) {
            foundPerfectStart = candidateStart.toISOString();
            foundPerfectSteps = candidateSteps;
            lotScheduled = true;
            break;
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
                bypassReason = shiftVal.reason || 'Conflito de turnos industriais.';
              }
            }
          }
        } catch (err: any) {
          // Rota mapping issue, seek next hour
        }
      }

      // Update bottleneck availability based on the chosen slot (perfect, flexible, or bypass)
      const chosenSteps = lotScheduled 
        ? foundPerfectSteps 
        : (foundFlexibleSteps.length > 0 ? foundFlexibleSteps : foundBypassSteps);

      if (chosenSteps.length > 0) {
        const envaseStep = chosenSteps[chosenSteps.length - 1];
        const setupHours = setupTimes ? (setupTimes['Envase'] || 0) : 0;
        ProximoEnvaseDisponivel = new Date(new Date(envaseStep.endDateTime).getTime() + setupHours * 60 * 60 * 1000);
      } else {
        // Theoretical fallback if this lot failed completely
        let totalRecipeHours = 0;
        recipe.steps.forEach(st => {
          totalRecipeHours += st.durationHours;
        });
        const setupHours = setupTimes ? (setupTimes['Envase'] || 0) : 0;
        ProximoEnvaseDisponivel = new Date(baseEnvaseStart.getTime() + (totalRecipeHours + setupHours) * 60 * 60 * 1000);
      }
    }

    // Record the results
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
    } else if (foundFlexibleStart && foundFlexibleSteps.length > 0) {
      errors.push({
        id: `err-bypass-${recipe.id}-${Date.now()}-${lotIdx}`,
        lotNumber,
        productName: recipe.name,
        timestamp: new Date().toISOString(),
        reason: `Turno Flexível (Inoculação): ${flexibleReason}`,
        productId: recipe.id,
        startDateTime: foundFlexibleStart,
        canBypass: true
      });
    } else if (foundBypassStart && foundBypassSteps.length > 0) {
      errors.push({
        id: `err-bypass-${recipe.id}-${Date.now()}-${lotIdx}`,
        lotNumber,
        productName: recipe.name,
        timestamp: new Date().toISOString(),
        reason: `Turno Industrial (Horas Extras): ${bypassReason}`,
        productId: recipe.id,
        startDateTime: foundBypassStart,
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

  return {
    scheduledBatches,
    errors
  };
}
