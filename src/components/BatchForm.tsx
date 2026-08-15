/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { ProductRecipe, Batch, Preventative, ScheduledStep, getAssetsPool, normalizeAssetId, ScaleType, ShiftConfig, Asset } from '../types';
import { calculateProductionTimeline, formatFullDate, areIntervalsOverlapping, tryScheduleBatchBackward, isDateTimeInWorkingHours, validateBatchShifts } from '../utils/timeline';
import { Calendar, Play, Shuffle, CheckCircle, Clock, Info, AlertTriangle } from 'lucide-react';

interface BatchFormProps {
  recipes: ProductRecipe[];
  existingBatches: Batch[];
  preventatives: Preventative[];
  shiftConfig: ShiftConfig;
  onAddBatch: (batch: Batch) => void;
  envaseLinesCount: number;
  setupTimes: Record<ScaleType, number>;
  customAssets?: Asset[];
}

export default function BatchForm({ recipes, existingBatches, preventatives, shiftConfig, onAddBatch, envaseLinesCount, setupTimes, customAssets }: BatchFormProps) {
  const assetsList = customAssets && customAssets.length > 0 ? customAssets : getAssetsPool(envaseLinesCount);
  const [selectedProductId, setSelectedProductId] = useState('');
  const [lotNumber, setLotNumber] = useState('');
  
  // Helper to get today's date formatted as YYYY-MM-DD
  const getTodayDateStr = () => {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  // Helper to format scale names consistently across the app
  const getFormattedScaleName = (scaleType: string) => {
    if (scaleType === '3000_5000L' || scaleType === '5000L') return 'Tanque 5.000L';
    if (scaleType === '3000L') return 'Tanque 3.000L';
    if (scaleType === '100L') return 'Biorreator 100L';
    if (scaleType === '500L') return 'Biorreator 500L';
    if (scaleType === 'Envase') return 'Linha de Envase';
    return scaleType;
  };

  // Set default start time to today's date and standard working hour
  const [startDateStr, setStartDateStr] = useState(() => getTodayDateStr());
  const [startTimeStr, setStartTimeStr] = useState('08:00');
  const [transferInterval, setTransferInterval] = useState(0);

  // Manual asset override selection per step: stepIndex -> assetId
  const [manualAllocations, setManualAllocations] = useState<Record<number, string>>({});
  const [previewSteps, setPreviewSteps] = useState<ScheduledStep[]>([]);
  const [allowOvertime, setAllowOvertime] = useState(false);
  const [pendingShiftBypassBatch, setPendingShiftBypassBatch] = useState<Batch | null>(null);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // Selected recipe detail
  const selectedRecipe = recipes.find(r => r.id === selectedProductId);

  // Initialize selected product
  useEffect(() => {
    if (recipes.length > 0 && !selectedProductId) {
      setSelectedProductId(recipes[0].id);
    }
  }, [recipes, selectedProductId]);

  // Generate a random lot code for easy demonstration
  const handleGenerateLot = () => {
    const randomNum = Math.floor(100000 + Math.random() * 900000);
    const code = selectedRecipe 
      ? selectedRecipe.name.substring(0, 3).toUpperCase().replace(/[^A-Z]/g, 'LOT')
      : 'BAC';
    setLotNumber(`${code}-${randomNum}`);
  };

  // Combine date & time into ISO format
  const getInoculationDateTimeStr = () => {
    try {
      const date = new Date(`${startDateStr}T${startTimeStr}:00`);
      return date.toISOString();
    } catch (e) {
      return new Date().toISOString();
    }
  };

  // Calculate timeline preview
  const handleRecalculatePreview = () => {
    if (!selectedRecipe) return;

    const startISO = getInoculationDateTimeStr();
    
    // Perform parsing to create steps
    const computed = calculateProductionTimeline(
      selectedRecipe,
      startISO,
      transferInterval,
      existingBatches,
      preventatives,
      // Convert state index keys from numbers to strings for helper mapping
      (() => {
        const acc: Record<string, string> = {};
        Object.entries(manualAllocations).forEach(([idx, assetId]) => {
          acc[idx] = assetId as string;
        });
        return acc;
      })(),
      undefined,
      setupTimes,
      envaseLinesCount
    );

    setPreviewSteps(computed);
  };

  // Run preview calculation when inputs change
  useEffect(() => {
    if (selectedRecipe) {
      handleRecalculatePreview();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProductId, startDateStr, startTimeStr, transferInterval, selectedRecipe]);

  // Check if a specific step asset placement has a conflict with other schedules/preventatives
  const checkStepConflict = (step: ScheduledStep, stepIdx: number) => {
    const assetId = normalizeAssetId(step.assetId, envaseLinesCount);
    const s = step.startDateTime;
    const e = step.endDateTime;

    // Check with direct preventatives
    for (const prev of preventatives) {
      if (normalizeAssetId(prev.assetId, envaseLinesCount) === assetId) {
        if (areIntervalsOverlapping(s, e, prev.startDateTime, prev.endDateTime)) {
          return {
            type: 'PREVENTATIVE' as const,
            message: `CONFLITO: O ativo ${assetsList.find(a => a.id === assetId)?.name} está sob ${prev.description}.`
          };
        }
      }
    }

    // Check with other existing batches
    for (const batch of existingBatches) {
      for (const otherStep of batch.steps) {
        if (normalizeAssetId(otherStep.assetId, envaseLinesCount) === assetId) {
          if (areIntervalsOverlapping(s, e, otherStep.startDateTime, otherStep.endDateTime)) {
            const prod = recipes.find(r => r.id === batch.productId)?.name || 'Outro';
            return {
              type: 'BATCH' as const,
              message: `CONFLITO: O ativo ${assetsList.find(a => a.id === assetId)?.name} está reservado para o Lote: ${batch.lotNumber} (${prod}).`
            };
          }
        }
      }
    }

    return null;
  };

  // Save/Submit schedule
  const handleScheduleBatch = (e: React.FormEvent) => {
    e.preventDefault();
    setSuccessMsg('');
    setErrorMsg('');

    if (!selectedRecipe) {
      setErrorMsg('Por favor, cadastre ou selecione um produto válido.');
      return;
    }

    if (!lotNumber.trim()) {
      setErrorMsg('Defina o número do lote ou ordem de produção.');
      return;
    }

    // Ensure we have preview computed
    if (previewSteps.length === 0) {
      setErrorMsg('Erro ao gerar o cronograma das etapas.');
      return;
    }

    // Call tryScheduleBatchBackward to find a shift-safe, conflict-free sequence!
    const selectionInocStr = getInoculationDateTimeStr();
    const result = tryScheduleBatchBackward(
      selectedRecipe,
      selectionInocStr,
      transferInterval,
      existingBatches,
      preventatives,
      allowOvertime ? { shifts: [] } : shiftConfig,
      (() => {
        const acc: Record<string, string> = {};
        Object.entries(manualAllocations).forEach(([idx, assetId]) => {
          acc[idx] = assetId as string;
        });
        return acc;
      })(),
      undefined,
      setupTimes,
      envaseLinesCount
    );

    if (!result.success) {
      // SINALIZAR VISUALMENTE O MOTIVO DO ERRO E BLOQUEAR PROGRAMAÇÃO (NÃO SUPERINCUBAR CRITICAL TRAVA)
      setErrorMsg(
        `🚨 [TRAVA DE SEGURANÇA BIOLÓGICA - SUPERINCUBAÇÃO MÁXIMA EXCEDIDA!] ` +
        `O lote não pôde ser programado nesta data. As operações manuais cairiam fora das horas e dias do turno ativo, ` +
        `e a tentativa de antecipar o processo via Backward Scheduling falhou por bloqueios ou falta de janelas úteis nos reatores. ` +
        `Dica: Tente ativar a opção "Autorizar Horas Extras" para ignorar a restrição de turnos operacionais se for autorizado. ` +
        `Detalhe técnico: ${result.errorReason}`
      );
      return;
    }

    // If backward scheduling modified the start date to fit shifts:
    let finalStartISO = result.startDateTime;
    let finalSteps = result.steps;
    let autoAdjAlert = '';

    if (Math.abs(new Date(result.startDateTime).getTime() - new Date(selectionInocStr).getTime()) > 5 * 60 * 1000) {
      const originalDateFormatted = formatFullDate(selectionInocStr);
      const adjustedDateFormatted = formatFullDate(result.startDateTime);
      autoAdjAlert = `[Motor Sequenciador Backward] O início foi antecipado de ${originalDateFormatted} para ${adjustedDateFormatted} para alinhar as transferências seguintes com o turno de trabalho útil, prevenindo quebras do ciclo biológico bacteriano.`;
    }

    // Make a new batch
    const newBatch: Batch = {
      id: 'batch-' + Date.now(),
      lotNumber: lotNumber.trim(),
      productId: selectedRecipe.id,
      startDateTime: finalStartISO,
      transferIntervalHours: transferInterval,
      steps: finalSteps
    };

    // Check if any step in finalSteps falls out of working shift hours
    const hasOutOfShiftSteps = finalSteps.some(
      s => !isDateTimeInWorkingHours(s.startDateTime, shiftConfig) || !isDateTimeInWorkingHours(s.endDateTime, shiftConfig)
    );

    if (hasOutOfShiftSteps && !allowOvertime) {
      // Prompt Shift Bypass Authorization Modal
      (newBatch as any).autoAdjAlert = autoAdjAlert;
      setPendingShiftBypassBatch(newBatch);
      return;
    }

    onAddBatch(newBatch);

    setSuccessMsg(
      `Lote ${newBatch.lotNumber} programado e alocado com sucesso! ` + 
      (autoAdjAlert ? `\n\n⚡ ${autoAdjAlert}` : '')
    );
    
    // Keep scheduling flows clean by clearing fields
    setLotNumber('');
    setManualAllocations({});
    setAllowOvertime(false);
    setStartDateStr(getTodayDateStr());
  };

  return (
    <div className="space-y-6" id="batch-form-container">
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-800" id="scheduler-tab-title">Programação e Sequenciamento de Lotes</h2>
        <p className="text-xs text-slate-500">Introduza os dados e inocule o lote primário. O motor PCP calculará e distribuirá nos reatores disponíveis.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Input Parameters Box */}
        <div className="lg:col-span-5 bg-white p-6 rounded-xl border border-slate-200 shadow-sm h-fit space-y-6" id="scheduling-inputs">
          <div className="border-b border-slate-100 pb-3">
            <h3 className="font-semibold text-slate-800 text-sm uppercase tracking-wide">1. Parâmetros do Lote</h3>
          </div>

          <form onSubmit={handleScheduleBatch} className="space-y-4">
            {/* Choose Product */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-widest block">Produto / Receita Patrão</label>
              <select
                value={selectedProductId}
                onChange={(e) => {
                  setSelectedProductId(e.target.value);
                  setManualAllocations({}); // Clear overrides when changing products
                }}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-medium focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-800 transition-shadow"
                id="select-product-batch"
              >
                {recipes.map(r => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            </div>

            {/* Lot / Order Number */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-widest block">Número do Lote / O.P.</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={lotNumber}
                  onChange={(e) => setLotNumber(e.target.value)}
                  placeholder="Ex: PRE-1065697"
                  className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm uppercase font-mono font-medium focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-800 transition-shadow"
                  required
                />
                <button
                  type="button"
                  onClick={handleGenerateLot}
                  className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg border border-slate-250 transition-colors cursor-pointer flex items-center gap-1"
                >
                  <Shuffle size={12} /> Gerar O.P.
                </button>
              </div>
            </div>

            {/* Inoculation Start Date/Time */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <label className="text-xs font-semibold text-slate-500 uppercase tracking-widest block">Data Inoculação (Erlen)</label>
                  <button
                    type="button"
                    onClick={() => setStartDateStr(getTodayDateStr())}
                    className="text-[10px] font-extrabold text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 px-2 py-0.5 rounded cursor-pointer transition-colors"
                    title="Usar data de hoje"
                  >
                    📅 Hoje
                  </button>
                </div>
                <input
                  type="date"
                  value={startDateStr}
                  onChange={(e) => setStartDateStr(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-medium focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-800 transition-shadow"
                  required
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-widest block">Hora Inoculação</label>
                <input
                  type="time"
                  value={startTimeStr}
                  onChange={(e) => setStartTimeStr(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-medium focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-800 transition-shadow"
                  required
                />
              </div>
            </div>

            {/* Toggle Hours Overtime */}
            <div className="p-3 bg-slate-50 border border-slate-150 rounded-lg space-y-1.5">
              <label className="flex items-center gap-2 cursor-pointer select-none" id="label-allow-overtime-checkbox">
                <input
                  id="allow-overtime-checkbox"
                  type="checkbox"
                  checked={allowOvertime}
                  onChange={(e) => setAllowOvertime(e.target.checked)}
                  className="w-4 h-4 text-slate-900 border-slate-300 rounded focus:ring-slate-900 focus:ring-2"
                />
                <span className="text-xs font-bold text-slate-700">Autorizar Horas Extras (Fora de Turno)</span>
              </label>
              <p className="text-[10px] text-slate-400 leading-normal">
                Permite agendar operações mesmo que coincidam com horários e dias inativos dos turnos normais de trabalho.
              </p>
            </div>

            {/* Form Validation Feedback */}
            {errorMsg && (
              <div className="p-3 bg-rose-50 text-rose-600 text-xs rounded-lg border border-rose-100 font-medium leading-relaxed">
                {errorMsg}
              </div>
            )}

            {successMsg && (
              <div className="p-3 bg-emerald-50 text-emerald-600 text-xs rounded-lg border border-emerald-100 font-medium">
                {successMsg}
              </div>
            )}

            {/* Action Buttons */}
            <div className="pt-2 flex flex-col gap-2">
              <button
                type="submit"
                id="btn-schedule-batch"
                className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-slate-900 text-white font-medium text-sm rounded-lg hover:bg-slate-800 shadow-sm transition-all cursor-pointer"
              >
                <Play size={14} fill="white" /> Calcular e Agendar Lote
              </button>
            </div>
          </form>
        </div>

        {/* Computed Steps and Live Conflicts Box */}
        <div className="lg:col-span-7 bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-6" id="scheduling-preview">
          <div className="flex justify-between items-center border-b border-slate-100 pb-3">
            <h3 className="font-semibold text-slate-800 text-sm uppercase tracking-wide">2. Prévia de Alocação e Conflitos</h3>
            <span className="text-xs text-slate-400 flex items-center gap-1">
              <Clock size={12} /> {selectedRecipe?.steps.length || 0} Estágios de Scale-Up
            </span>
          </div>

          {selectedRecipe ? (
            <div className="space-y-4">
              <div className="p-3 bg-blue-50/50 text-slate-700 text-xs rounded-lg border border-blue-100 leading-relaxed flex items-start gap-2">
                <Info size={16} className="text-blue-500 shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold">Simulação de Fluxo:</span> O motor PCP está prevendo as datas de transferência sequenciais do maior para o menor grau. Se desejar usar outro reator físico, faça a alteração manual abaixo.
                </div>
              </div>

              <div className="space-y-3" id="preview-steps-timeline">
                {previewSteps.map((step, idx) => {
                  const compatibleAssets = assetsList.filter(a => a.scaleType === step.scaleType);
                  const conflict = checkStepConflict(step, idx);

                  return (
                    <div
                      key={idx}
                      className={`p-4 rounded-xl border transition-all ${
                        conflict 
                          ? 'bg-rose-50/45 border-rose-200 shadow-xs' 
                          : 'bg-slate-50/60 border-slate-200'
                      }`}
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
                        <div className="flex items-center gap-2">
                          <span className="w-5 h-5 flex items-center justify-center rounded-full bg-slate-200 text-slate-700 font-mono text-[10px] font-bold">
                            {idx + 1}
                          </span>
                          <span className="text-xs font-extrabold text-slate-800">
                            {getFormattedScaleName(selectedRecipe?.steps[idx]?.scaleType || step.scaleType)}
                          </span>
                          <span className="text-[10px] uppercase font-mono font-bold bg-slate-200/80 text-slate-600 px-1.5 py-0.5 rounded">
                            {step.durationHours}h
                          </span>
                        </div>

                        {/* Manuel selector of asset */}
                        <div className="flex items-center gap-1">
                          <span className="text-[10px] font-semibold text-slate-500 uppercase mr-1">Ativo:</span>
                          <select
                            value={step.assetId}
                            onChange={(e) => {
                              const assetId = e.target.value;
                              setManualAllocations(prev => ({ ...prev, [idx]: assetId }));
                              
                              // Trigger recalculation on state
                              const updated = [...previewSteps];
                              updated[idx].assetId = assetId;
                              setPreviewSteps(updated);
                            }}
                            className="bg-white border border-slate-300 rounded px-1.5 py-1 text-xs font-semibold text-slate-700 focus:outline-none focus:ring-1 focus:ring-slate-800 shrink-0 cursor-pointer"
                          >
                            {compatibleAssets.map(a => (
                              <option key={a.id} value={a.id}>
                                {a.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      {/* Display Entry / Exit Times */}
                      <div className="grid grid-cols-2 gap-4 text-[11px] font-mono border-t border-slate-100/70 pt-2.5">
                        <div>
                          <div className="flex justify-between items-center mb-1">
                            <span className="text-slate-400 font-sans font-medium uppercase tracking-wider text-[9px]">Entrada / Inoculação</span>
                            {isDateTimeInWorkingHours(step.startDateTime, shiftConfig) ? (
                              <span className="text-[8px] bg-emerald-100 text-emerald-800 font-sans font-bold px-1.5 py-0.5 rounded border border-emerald-200">TURNO OK</span>
                            ) : (
                              <span className="text-[8px] bg-rose-100 text-rose-800 font-sans font-bold px-1.5 py-0.5 rounded border border-rose-200">⚠️ FORA DO TURNO</span>
                            )}
                          </div>
                          <p className="text-slate-800 font-bold">{formatFullDate(step.startDateTime)}</p>
                        </div>
                        <div>
                          <div className="flex justify-between items-center mb-1">
                            <span className="text-slate-400 font-sans font-medium uppercase tracking-wider text-[9px]">Saída / Transferência</span>
                            {isDateTimeInWorkingHours(step.endDateTime, shiftConfig) ? (
                              <span className="text-[8px] bg-emerald-100 text-emerald-800 font-sans font-bold px-1.5 py-0.5 rounded border border-emerald-200">TURNO OK</span>
                            ) : (
                              <span className="text-[8px] bg-rose-100 text-rose-800 font-sans font-bold px-1.5 py-0.5 rounded border border-rose-200">⚠️ FORA DO TURNO</span>
                            )}
                          </div>
                          <p className="text-slate-800 font-bold">{formatFullDate(step.endDateTime)}</p>
                        </div>
                      </div>

                      {/* Display Overlap Conflict Banner inside step if any */}
                      {conflict && (
                        <div className="mt-3 p-2 bg-rose-50 text-rose-700 text-[10px] rounded border border-rose-100 font-medium flex items-center gap-1.5 animate-pulse">
                          <span>⚠️</span>
                          <span>{conflict.message}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="text-center py-12 text-slate-400 text-xs">
              Selecione ou cadastre uma receita para simular o sequenciamento.
            </div>
          )}
        </div>
      </div>

      {/* MODAL DE CONFIRMAÇÃO DE BLOQUEIO / DESVIO DE TURNO */}
      {pendingShiftBypassBatch && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fadeIn">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl p-6 w-full max-w-md space-y-4">
            <div className="flex items-center gap-2 text-amber-600 border-b border-slate-100 pb-3">
              <AlertTriangle size={20} />
              <h3 className="font-extrabold text-slate-800 text-sm">Operação Fora do Turno Operacional</h3>
            </div>

            <div className="space-y-2 text-xs text-slate-600 leading-relaxed">
              <p className="font-semibold text-slate-800">
                Atenção: O lote <span className="font-mono font-bold text-indigo-600">{pendingShiftBypassBatch.lotNumber}</span> contém operações que ocorrem fora das horas/dias dos turnos cadastrados.
              </p>
              <div className="bg-amber-50 p-3 rounded-xl border border-amber-200/80 text-[11px] text-amber-900 space-y-1.5">
                <p className="font-bold">Como deseja proceder com a alocação?</p>
                <ul className="list-disc list-inside text-[10px] space-y-1 text-amber-800">
                  <li><strong>Autorizar Horas Extras:</strong> Aloca o lote na data selecionada assumindo operação extraordinária.</li>
                  <li><strong>Cancelar:</strong> Aborta o agendamento para você ajustar a data/horário ou marcar o checkbox "Autorizar Horas Extras".</li>
                </ul>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setPendingShiftBypassBatch(null)}
                className="px-3.5 py-2 border border-slate-200 rounded-lg text-xs font-bold text-slate-600 hover:bg-slate-100 cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  const b = pendingShiftBypassBatch;
                  const alertMsg = (b as any).autoAdjAlert;
                  setPendingShiftBypassBatch(null);
                  onAddBatch(b);
                  setSuccessMsg(
                    `Lote ${b.lotNumber} programado com autorização de horas extras! ` + 
                    (alertMsg ? `\n\n⚡ ${alertMsg}` : '')
                  );
                  setLotNumber('');
                  setManualAllocations({});
                  setAllowOvertime(false);
                  setStartDateStr(getTodayDateStr());
                }}
                className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black rounded-lg text-xs transition-colors cursor-pointer shadow-xs"
              >
                ⚡ Autorizar Horas Extras e Agendar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
