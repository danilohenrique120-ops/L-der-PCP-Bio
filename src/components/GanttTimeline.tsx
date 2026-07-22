/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { Batch, Preventative, ScaleType, Asset, getAssetsPool, normalizeAssetId, COLOR_OPTIONS, ProductRecipe, DeviationLog, ScheduledStep } from '../types';
import { formatFullDate, formatShortDate, getWeekNumber, areIntervalsOverlapping } from '../utils/timeline';
import { ChevronLeft, ChevronRight, Calendar, AlertTriangle, ShieldCheck, Trash2, Sliders, Info, Eye } from 'lucide-react';

interface GanttTimelineProps {
  batches: Batch[];
  preventatives: Preventative[];
  recipes: ProductRecipe[];
  onDeleteBatch: (id: string) => void;
  onDeletePreventative: (id: string) => void;
  onUpdateBatches: (updatedBatches: Batch[]) => void;
  onAddDeviationLog: (log: DeviationLog) => void;
  setupTimes: Record<ScaleType, number>;
  envaseLinesCount: number;
}

// Visual category groupings for rows
const CATEGORIES = [
  { label: 'Erlenmeyer (Rotas 0-8)', scaleType: 'Erlenmeyer', min: 0, max: 8 },
  { label: 'Balão (Rotas 1-6)', scaleType: 'Balão', min: 1, max: 6 },
  { label: 'Tanques 100L (B01-B05)', scaleType: '100L', min: 1, max: 5 },
  { label: 'Tanques 500L (B06-B10)', scaleType: '500L', min: 6, max: 10 },
  { label: 'Tanques 3000L/5000L (B11-B16)', scaleType: '3000_5000L', min: 11, max: 16 },
  { label: 'Linha de Envase', scaleType: 'Envase', isLine: true }
];

export default function GanttTimeline({ batches, preventatives, recipes, onDeleteBatch, onDeletePreventative, onUpdateBatches, onAddDeviationLog, setupTimes, envaseLinesCount }: GanttTimelineProps) {
  const [visibleScales, setVisibleScales] = useState<Record<ScaleType, boolean>>(() => {
    const saved = localStorage.getItem('pcp_gantt_visible_scales');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {}
    }
    return {
      'Erlenmeyer': true,
      'Balão': true,
      '100L': true,
      '500L': true,
      '3000_5000L': true,
      'Envase': true
    };
  });

  useEffect(() => {
    localStorage.setItem('pcp_gantt_visible_scales', JSON.stringify(visibleScales));
  }, [visibleScales]);

  const fullAssetsList = getAssetsPool(envaseLinesCount);
  const assetsList = fullAssetsList.filter(asset => visibleScales[asset.scaleType]);

  const [activeMonth, setActiveMonth] = useState<number>(() => {
    return new Date().getMonth();
  });
  const [viewMode, setViewMode] = useState<'days' | 'weeks'>('days');
  const [now, setNow] = useState<Date>(new Date());

  useEffect(() => {
    const interval = setInterval(() => {
      setNow(new Date());
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    // Scroll to today on initial mount
    setTimeout(() => {
      scrollToDate(new Date(), 'auto');
    }, 150);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Month names in Portuguese for filtering
  const MONTHS_PT = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
  ];

  // Helper to calculate active batches and preventatives per month of year 2026
  const getMonthlyStats = (monthIdx: number) => {
    const year = 2026;
    const startOfMonth = new Date(year, monthIdx, 1, 0, 0, 0);
    const endOfMonth = new Date(year, monthIdx + 1, 0, 23, 59, 59, 999);

    const batchesInMonth = batches.filter(b => {
      return b.steps.some(st => {
        const s = new Date(st.startDateTime).getTime();
        const e = new Date(st.endDateTime).getTime();
        return s <= endOfMonth.getTime() && e >= startOfMonth.getTime();
      });
    });

    const prevInMonth = preventatives.filter(p => {
      const s = new Date(p.startDateTime).getTime();
      const e = new Date(p.endDateTime).getTime();
      return s <= endOfMonth.getTime() && e >= startOfMonth.getTime();
    });

    return {
      batchesCount: batchesInMonth.length,
      prevCount: prevInMonth.length
    };
  };

  const handleSelectMonth = (monthIdx: number) => {
    setActiveMonth(monthIdx);
    scrollToDate(new Date(2026, monthIdx, 1), 'smooth');
  };

  const handleSwitchViewMode = (mode: 'days' | 'weeks') => {
    setViewMode(mode);
    if (mode === 'days') {
      setZoomLevel(120); // standard spacing
    } else {
      setZoomLevel(50); // zoomed out spacing for weeks
    }
  };

  const [selectedBlock, setSelectedBlock] = useState<{
    type: 'batch-step' | 'preventative';
    batch?: Batch;
    product?: ProductRecipe;
    stepIndex?: number;
    preventative?: Preventative;
    asset?: Asset;
  } | null>(null);

  const [zoomLevel, setZoomLevel] = useState<number>(120); // Width of 1 day in pixels

  // State variables for Deviation / Interventions
  const [deviationMode, setDeviationMode] = useState<'none' | 'delay' | 'route-swap' | 'contamination'>('none');
  const [deviationReason, setDeviationReason] = useState<'Mecânico' | 'Biológico' | 'Operacional' | ''>('');
  const [deviationNotes, setDeviationNotes] = useState<string>('');

  const [delayInputStart, setDelayInputStart] = useState<string>('');
  const [delayHoursSecas, setDelayHoursSecas] = useState<number>(0);
  const [swapAssetId, setSwapAssetId] = useState<string>('');

  // Date formatting helpers for datetimes
  function formatToDateTimeInput(d: Date): string {
    const tzOffset = d.getTimezoneOffset() * 60000;
    const localISOTime = (new Date(d.getTime() - tzOffset)).toISOString().slice(0, 16);
    return localISOTime;
  }

  // Effect to reset deviation modal states on block change
  useEffect(() => {
    if (selectedBlock && selectedBlock.type === 'batch-step' && selectedBlock.batch && selectedBlock.stepIndex !== undefined) {
      const step = selectedBlock.batch.steps[selectedBlock.stepIndex];
      setDeviationMode('none');
      setDeviationReason('');
      setDeviationNotes('');
      setSwapAssetId(normalizeAssetId(step.assetId, envaseLinesCount));
      setDelayInputStart(formatToDateTimeInput(new Date(step.startDateTime)));
      setDelayHoursSecas(0);
    } else {
      setDeviationMode('none');
      setDeviationReason('');
      setDeviationNotes('');
    }
  }, [selectedBlock, envaseLinesCount]);

  // Asset occupancy checker taking setup/cleanup and other batches into account
  const isAssetBusy = (assetId: string, startStr: string, endStr: string, ignoreBatchId: string, scaleType: ScaleType) => {
    const s = new Date(startStr).getTime();
    const e = new Date(endStr).getTime();
    const setupMins = setupTimes[scaleType] || 0;
    const eSetup = e + setupMins * 60 * 60 * 1000;

    const overlapBatch = batches.some(b => {
      if (b.id === ignoreBatchId) return false;
      return b.steps.some(st => {
        if (normalizeAssetId(st.assetId, envaseLinesCount) !== assetId) return false;
        const s2 = new Date(st.startDateTime).getTime();
        const e2 = new Date(st.endDateTime).getTime();
        const setup2 = setupTimes[st.scaleType] || 0;
        const e2Setup = e2 + setup2 * 60 * 60 * 1000;
        return s < e2Setup && s2 < eSetup;
      });
    });

    const overlapPrev = preventatives.some(p => {
      if (normalizeAssetId(p.assetId, envaseLinesCount) !== assetId) return false;
      const pStart = new Date(p.startDateTime).getTime();
      const pEnd = new Date(p.endDateTime).getTime();
      return s < pEnd && pStart < eSetup;
    });

    return overlapBatch || overlapPrev;
  };

  // Execution Handlers
  const handleApplyContamination = () => {
    if (!selectedBlock || !selectedBlock.batch || selectedBlock.stepIndex === undefined || !deviationReason) return;
    if (!deviationNotes.trim()) {
      alert('Por favor, insira as observações sobre a contaminação.');
      return;
    }

    const batch = selectedBlock.batch;
    const stepIndex = selectedBlock.stepIndex;
    const step = batch.steps[stepIndex];
    const recipe = recipes.find(r => r.id === batch.productId);

    const newLog: DeviationLog = {
      id: `dev-${Date.now()}`,
      timestamp: new Date().toISOString(),
      type: 'CONTAMINATION',
      lotNumber: batch.lotNumber,
      productId: batch.productId,
      productName: recipe?.name || 'Produto Desconhecido',
      stepScaleType: step.scaleType,
      reason: deviationReason,
      notes: deviationNotes,
      details: `BLOQUEIO POR CONTAMINAÇÃO: Lote congelado no estágio ${step.scaleType} (${selectedBlock.asset?.name}). Estágios subsequentes cancelados e liberados.`
    };

    const updatedBatches = batches.map(b => {
      if (b.id !== batch.id) return b;
      return {
        ...b,
        isContaminated: true,
        contaminatedStepIndex: stepIndex,
        contaminationReason: deviationReason,
        contaminationNotes: deviationNotes,
        steps: b.steps.slice(0, stepIndex + 1)
      };
    });

    onUpdateBatches(updatedBatches);
    onAddDeviationLog(newLog);
    setSelectedBlock(null);
    alert(`Contaminação declarada com sucesso para o lote ${batch.lotNumber}. Os reatores posteriores foram liberados.`);
  };

  const handleApplyDelay = () => {
    if (!selectedBlock || !selectedBlock.batch || selectedBlock.stepIndex === undefined || !deviationReason) return;
    if (!deviationNotes.trim()) {
      alert('Por favor, insira as notas explicativas sobre o atraso.');
      return;
    }

    const batch = selectedBlock.batch;
    const stepIdx = selectedBlock.stepIndex;
    const step = batch.steps[stepIdx];
    const recipe = recipes.find(r => r.id === batch.productId);

    const originalStart = new Date(step.startDateTime);
    const newStart = new Date(delayInputStart);
    
    const diffMs = newStart.getTime() - originalStart.getTime();
    if (diffMs === 0) {
      alert('Nenhuma alteração de horário foi informada.');
      return;
    }

    const diffHours = diffMs / (1000 * 60 * 60);

    const newLog: DeviationLog = {
      id: `dev-${Date.now()}`,
      timestamp: new Date().toISOString(),
      type: 'DELAY',
      lotNumber: batch.lotNumber,
      productId: batch.productId,
      productName: recipe?.name || 'Produto Desconhecido',
      stepScaleType: step.scaleType,
      reason: deviationReason,
      notes: deviationNotes,
      details: `AJUSTE DE HORÁRIO: Etapa ${step.scaleType} atrasada/deslocada em ${diffHours.toFixed(1)}h. Efeito cascata aplicado a partir de ${formatFullDate(step.startDateTime)}.`
    };

    const updatedBatches = batches.map(b => {
      if (b.id !== batch.id) return b;
      const updatedSteps = b.steps.map((st, i) => {
        if (i < stepIdx) return st;
        const sTime = new Date(st.startDateTime).getTime() + diffMs;
        const eTime = new Date(st.endDateTime).getTime() + diffMs;
        return {
          ...st,
          startDateTime: new Date(sTime).toISOString(),
          endDateTime: new Date(eTime).toISOString()
        };
      });
      return { ...b, steps: updatedSteps };
    });

    onUpdateBatches(updatedBatches);
    onAddDeviationLog(newLog);
    setSelectedBlock(null);
    alert(`Horário recalibrado para o lote ${batch.lotNumber} com efeito cascata de ${diffHours.toFixed(1)}h.`);
  };

  const handleApplyRouteSwap = () => {
    if (!selectedBlock || !selectedBlock.batch || selectedBlock.stepIndex === undefined || !deviationReason || !swapAssetId) return;
    if (!deviationNotes.trim()) {
      alert('Por favor, insira as observações sobre a alteração de rota.');
      return;
    }

    const batch = selectedBlock.batch;
    const stepIdx = selectedBlock.stepIndex;
    const step = batch.steps[stepIdx];
    const recipe = recipes.find(r => r.id === batch.productId);

    const currentAssetId = normalizeAssetId(step.assetId, envaseLinesCount);
    if (currentAssetId === swapAssetId) {
      alert('Nenhum reator novo foi selecionado.');
      return;
    }

    const targetAsset = assetsList.find(a => a.id === swapAssetId);

    const newLog: DeviationLog = {
      id: `dev-${Date.now()}`,
      timestamp: new Date().toISOString(),
      type: 'ROUTE_CHANGE',
      lotNumber: batch.lotNumber,
      productId: batch.productId,
      productName: recipe?.name || 'Produto Desconhecido',
      stepScaleType: step.scaleType,
      reason: deviationReason,
      notes: deviationNotes,
      details: `MUDANÇA DE ROTA: Equipamento alterado de ${selectedBlock.asset?.name} para ${targetAsset?.name || swapAssetId} para a etapa ${step.scaleType}.`
    };

    const updatedBatches = batches.map(b => {
      if (b.id !== batch.id) return b;
      const updatedSteps = b.steps.map((st, i) => {
        if (i !== stepIdx) return st;
        return {
          ...st,
          assetId: swapAssetId
        };
      });
      return { ...b, steps: updatedSteps };
    });

    onUpdateBatches(updatedBatches);
    onAddDeviationLog(newLog);
    setSelectedBlock(null);
    alert(`Troca de reator concluída com sucesso para o estágio ${step.scaleType}.`);
  };

  // Scrolling reference
  const timelineContentRef = useRef<HTMLDivElement>(null);

  // Core dimensions
  const dayWidth = zoomLevel; 
  const hourWidth = dayWidth / 24;

  const timelineStart = new Date('2026-01-01T00:00:00');
  const timelineEnd = new Date('2026-12-31T23:59:59');
  const totalDays = 365;

  // Calculate list of days in the active viewport range
  const daysArray: Date[] = [];
  for (let i = 0; i < totalDays; i++) {
    const d = new Date(timelineStart);
    d.setDate(timelineStart.getDate() + i);
    daysArray.push(d);
  }

  // Group days by Sunday/Monday week descriptors
  const weeksMap: Record<string, { weekNum: number; days: Date[] }> = {};
  daysArray.forEach(day => {
    const { week, year } = getWeekNumber(day);
    const key = `W${week}-${year}`;
    if (!weeksMap[key]) {
      weeksMap[key] = { weekNum: week, days: [] };
    }
    weeksMap[key].days.push(day);
  });

  const scrollToDate = (date: Date, behavior: ScrollBehavior = 'smooth') => {
    if (timelineContentRef.current) {
      const diffTime = date.getTime() - timelineStart.getTime();
      const diffDays = diffTime / (1000 * 60 * 60 * 24);
      const containerWidth = timelineContentRef.current.clientWidth || 800;
      const scrollLeft = (diffDays * dayWidth) - (containerWidth / 2) + (dayWidth / 2);
      timelineContentRef.current.scrollTo({ left: Math.max(0, scrollLeft), behavior });
    }
  };

  // Automatically scroll to the active month when mounting or changing zoom level
  useEffect(() => {
    scrollToDate(new Date(2026, activeMonth, 1), 'auto');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoomLevel]);

  // Listen to scroll to update active month
  const handleScroll = () => {
    if (timelineContentRef.current) {
      const scrollLeft = timelineContentRef.current.scrollLeft;
      const scrollDays = scrollLeft / dayWidth;
      const currentDate = new Date(timelineStart.getTime() + scrollDays * 24 * 60 * 60 * 1000);
      const currentMonth = currentDate.getMonth();
      if (activeMonth !== currentMonth) {
        setActiveMonth(currentMonth);
      }
    }
  };

  // Time navigation via scrolling
  const navigateTimeline = (direction: 'next' | 'prev') => {
    if (timelineContentRef.current) {
      const scrollAmount = direction === 'next' ? 7 * dayWidth : -7 * dayWidth;
      timelineContentRef.current.scrollBy({ left: scrollAmount, behavior: 'smooth' });
    }
  };

  const handleScrollToToday = () => {
    const today = new Date();
    setActiveMonth(today.getMonth());
    scrollToDate(today, 'smooth');
  };

  // Determine if today's date context is visible
  const isTodayVisible = now >= timelineStart && now <= timelineEnd;
  
  // Calculate today line horizontal position
  let todayLinePos = 0;
  if (isTodayVisible) {
    const diffHours = (now.getTime() - timelineStart.getTime()) / (1000 * 60 * 60);
    todayLinePos = diffHours * hourWidth;
  }

  // Calculate conflicts/collisions list caused by delay adjustments or manual scheduling
  const conflictingStepsList: { batch: Batch; step: ScheduledStep; assetName: string; index: number }[] = [];
  batches.forEach(b => {
    b.steps.forEach((st, sIdx) => {
      if (b.isContaminated && sIdx === b.contaminatedStepIndex) return; // ignore contamination freeze

      const normAssetId = normalizeAssetId(st.assetId, envaseLinesCount);
      const asset = assetsList.find(a => a.id === normAssetId);
      const stepSetup = setupTimes[st.scaleType] || 0;
      const s1 = new Date(st.startDateTime).getTime();
      const e1 = new Date(st.endDateTime).getTime();
      const e1Setup = e1 + stepSetup * 60 * 60 * 1000;

      const hasPrevOverlap = preventatives.some(p => 
        normalizeAssetId(p.assetId, envaseLinesCount) === normAssetId && 
        s1 < new Date(p.endDateTime).getTime() && 
        new Date(p.startDateTime).getTime() < e1Setup
      );

      const hasBatchOverlap = batches.some(ob => 
        ob.id !== b.id && 
        ob.steps.some(ost => {
          if (normalizeAssetId(ost.assetId, envaseLinesCount) !== normAssetId) return false;
          const s2 = new Date(ost.startDateTime).getTime();
          const e2 = new Date(ost.endDateTime).getTime();
          const setup2 = setupTimes[ost.scaleType] || 0;
          const e2Setup = e2 + setup2 * 60 * 60 * 1000;
          return s1 < e2Setup && s2 < e1Setup;
        })
      );

      if (hasPrevOverlap || hasBatchOverlap) {
        conflictingStepsList.push({
          batch: b,
          step: st,
          assetName: asset?.name || normAssetId,
          index: sIdx
        });
      }
    });
  });

  return (
    <div className="space-y-4" id="gantt-root">
      {/* Control bar / header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
        <div className="flex flex-wrap items-center justify-between lg:justify-start gap-4">
          <div className="flex items-center gap-3">
            <div className="bg-indigo-600 text-white rounded-lg p-2 shrink-0 shadow-xs">
              <Calendar size={20} />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-800 uppercase tracking-widest">Cronograma de Produção Avançado</h2>
              <p className="text-[11px] font-mono font-bold text-slate-400">
                Período: {formatShortDate(timelineStart.toISOString())} a {formatShortDate(timelineEnd.toISOString())}
              </p>
            </div>
          </div>

          {/* View Mode Segment Switcher */}
          <div className="flex items-center bg-slate-100 p-1 rounded-xl border border-slate-250 shrink-0">
            <button
              type="button"
              onClick={() => handleSwitchViewMode('days')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-black rounded-lg transition-all cursor-pointer ${
                viewMode === 'days'
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'text-slate-600 hover:bg-slate-200'
              }`}
            >
              <Info size={13} className={viewMode === 'days' ? 'text-indigo-400' : ''} />
              Vista Diária
            </button>
            <button
              type="button"
              onClick={() => handleSwitchViewMode('weeks')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-black rounded-lg transition-all cursor-pointer ${
                viewMode === 'weeks'
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'text-slate-600 hover:bg-slate-200'
              }`}
            >
              <Calendar size={13} className={viewMode === 'weeks' ? 'text-indigo-400' : ''} />
              Vista Semanal
            </button>
          </div>
        </div>

        {/* Navigation panel */}
        <div className="flex flex-wrap items-center gap-3 justify-end">
          {/* Zoom controls */}
          <div className="flex items-center gap-1 border-r border-slate-200 pr-3 mr-1">
            <span className="text-[10px] font-black text-slate-400 uppercase mr-1">Tamanho:</span>
            <button
              onClick={() => setZoomLevel(viewMode === 'weeks' ? 35 : 96)}
              className={`px-2 py-1 text-[10px] font-extrabold rounded ${zoomLevel === (viewMode === 'weeks' ? 35 : 96) ? 'bg-slate-800 text-white border border-slate-900' : 'text-slate-500 hover:bg-slate-100 border border-transparent'}`}
            >
              {viewMode === 'weeks' ? 'Compacto' : 'Estreito'}
            </button>
            <button
              onClick={() => setZoomLevel(viewMode === 'weeks' ? 55 : 120)}
              className={`px-2 py-1 text-[10px] font-extrabold rounded ${zoomLevel === (viewMode === 'weeks' ? 55 : 120) ? 'bg-slate-800 text-white border border-slate-900' : 'text-slate-500 hover:bg-slate-100 border border-transparent'}`}
            >
              {viewMode === 'weeks' ? 'Padrão' : 'Médio'}
            </button>
            <button
              onClick={() => setZoomLevel(viewMode === 'weeks' ? 80 : 160)}
              className={`px-2 py-1 text-[10px] font-extrabold rounded ${zoomLevel === (viewMode === 'weeks' ? 80 : 160) ? 'bg-slate-800 text-white border border-slate-900' : 'text-slate-500 hover:bg-slate-100 border border-transparent'}`}
            >
              {viewMode === 'weeks' ? 'Largo' : 'Amplo'}
            </button>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => navigateTimeline('prev')}
              className="p-2 bg-white border border-slate-250 hover:border-slate-400 text-slate-700 hover:bg-slate-50 rounded-lg transition-colors cursor-pointer flex items-center justify-center shadow-2xs"
              title={viewMode === 'weeks' ? "Voltar 2 semanas" : "Voltar 1 semana"}
            >
              <ChevronLeft size={15} />
            </button>
            
            <button
              onClick={handleScrollToToday}
              className="px-3 py-2 bg-slate-50 hover:bg-slate-150 text-slate-700 border border-slate-250 hover:border-slate-400 rounded-lg text-xs font-bold font-mono transition-all cursor-pointer flex items-center gap-1 shadow-2xs"
              title="Ir para a data e hora atual no calendário"
            >
              📍 Hoje ({String(now.getDate()).padStart(2, '0')}/{String(now.getMonth() + 1).padStart(2, '0')})
            </button>

            <button
              onClick={() => navigateTimeline('next')}
              className="p-2 bg-white border border-slate-250 hover:border-slate-400 text-slate-700 hover:bg-slate-50 rounded-lg transition-colors cursor-pointer flex items-center justify-center shadow-2xs"
              title={viewMode === 'weeks' ? "Avançar 2 semanas" : "Avançar 1 semana"}
            >
              <ChevronRight size={15} />
            </button>
          </div>

          <div className="flex items-center bg-slate-50 p-1 rounded-lg border border-slate-200">
            <span className="text-[9px] font-bold text-slate-500 uppercase px-2 py-1 select-none">
              Safra Completa (2026)
            </span>
          </div>
        </div>
      </div>

      {/* Month Selection Filter Bar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 px-1">
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-3 rounded bg-indigo-600 inline-block"></span>
            <span className="text-[10px] font-black uppercase tracking-wider text-slate-500 font-mono">
              Filtro por Mês (Ano 2026)
            </span>
          </div>
          <span className="text-[9px] font-bold text-indigo-600 bg-indigo-50 px-2.5 py-0.5 rounded-full font-mono md:self-center self-start">
            Total planejado da planta distribuído nos meses de safra
          </span>
        </div>
        
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-12 gap-1.5">
          {MONTHS_PT.map((mName, mIdx) => {
            const stats = getMonthlyStats(mIdx);
            const isSelected = activeMonth === mIdx;
            
            // Highlight months that actually have batches or preventatives scheduled
            const hasActivity = stats.batchesCount > 0 || stats.prevCount > 0;
            
            return (
              <button
                key={mIdx}
                type="button"
                onClick={() => handleSelectMonth(mIdx)}
                className={`py-2 px-1 rounded-xl border transition-all text-center cursor-pointer flex flex-col justify-center items-center ${
                  isSelected
                    ? 'bg-indigo-600 border-indigo-750 text-white shadow-md font-black scale-[1.03] -translate-y-0.5 ring-2 ring-indigo-200'
                    : hasActivity
                    ? 'bg-indigo-50/40 hover:bg-indigo-50 border-indigo-150 text-indigo-900 font-semibold shadow-2xs'
                    : 'bg-slate-50/80 hover:bg-slate-100 border-slate-200 text-slate-500 font-medium'
                }`}
              >
                <span className="text-[11px] uppercase tracking-wider font-extrabold">{mName.slice(0, 3)}</span>
                <span className={`text-[8px] mt-1 font-mono leading-none ${isSelected ? 'text-indigo-100 font-bold' : 'text-slate-400'}`}>
                  {hasActivity ? (
                    <span className="flex items-center gap-0.5 justify-center leading-none">
                      {stats.batchesCount > 0 && `📦${stats.batchesCount}`}
                      {stats.prevCount > 0 && `🔒${stats.prevCount}`}
                    </span>
                  ) : (
                    'Vazio'
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Gantt Interactive Area */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col" id="gantt-board">
        {/* Shaded legend and Filter scale bar */}
        <div className="flex flex-col xl:flex-row bg-slate-50 text-xs border-b border-slate-200 px-4 py-3 gap-3 xl:items-center justify-between select-none">
          {/* Legend */}
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-blue-500 inline-block"></span> SOJA</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-emerald-500 inline-block"></span> PREMIER</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-amber-500 inline-block"></span> MILHO</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-black inline-block"></span> PREVENTIVAS</span>
          </div>

          {/* Scale Filters */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[9px] font-black uppercase text-slate-400 tracking-wider flex items-center gap-1 mr-1">
              <Eye size={12} /> Mostrar Escalas:
            </span>
            {(['Erlenmeyer', 'Balão', '100L', '500L', '3000_5000L', 'Envase'] as ScaleType[]).map((scale) => {
              const active = visibleScales[scale];
              let label = scale === '3000_5000L' ? 'Tanques 5kL' : scale === 'Envase' ? 'Envase' : `Escala ${scale}`;
              let scaleBadgeColor = '';
              if (scale === 'Erlenmeyer') scaleBadgeColor = active ? 'bg-teal-900 text-teal-100 border-teal-850' : 'bg-slate-100 text-slate-400 border-slate-200';
              else if (scale === 'Balão') scaleBadgeColor = active ? 'bg-sky-900 text-sky-100 border-sky-850' : 'bg-slate-100 text-slate-400 border-slate-200';
              else if (scale === '100L') scaleBadgeColor = active ? 'bg-orange-950 text-orange-100 border-orange-850' : 'bg-slate-100 text-slate-400 border-slate-200';
              else if (scale === '500L') scaleBadgeColor = active ? 'bg-amber-900 text-amber-100 border-amber-850' : 'bg-slate-100 text-slate-400 border-slate-200';
              else if (scale === '3000_5000L') scaleBadgeColor = active ? 'bg-purple-900 text-purple-100 border-purple-800' : 'bg-slate-100 text-slate-400 border-slate-200';
              else if (scale === 'Envase') scaleBadgeColor = active ? 'bg-rose-900 text-rose-100 border-rose-800' : 'bg-slate-100 text-slate-400 border-slate-200';

              return (
                <button
                  key={scale}
                  type="button"
                  onClick={() => setVisibleScales(prev => ({ ...prev, [scale]: !prev[scale] }))}
                  className={`px-2 py-1 rounded text-[10px] font-bold border transition-all cursor-pointer shadow-3xs hover:scale-[1.02] active:scale-[0.98] ${scaleBadgeColor}`}
                >
                  {label}
                </button>
              );
            })}
          </div>

          <div className="text-[10px] text-indigo-600 bg-indigo-50 font-bold px-2 py-0.5 rounded flex items-center gap-1 xl:self-center self-start">
            <span className="animate-ping w-1.5 h-1.5 rounded-full bg-indigo-500"></span> Linha vermelha atual ({formatFullDate(now.toISOString())})
          </div>
        </div>

        <div className="flex overflow-hidden relative">
          
          {/* Pinned Left Sidebar: Production Assets */}
          <div className="w-64 bg-slate-900 text-slate-200 shrink-0 border-r border-slate-800 z-10 select-none flex flex-col" id="gantt-sidebar">
            {/* Top Empty Header Spacer to match timeline headers date row height */}
            <div className="h-[68px] bg-slate-950 border-b border-slate-800 sticky top-0 flex items-center px-4">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">ATIVOS DA INDÚSTRIA</span>
            </div>

            {/* Rows list of assets */}
            <div className="divide-y divide-slate-800/60 break-words">
              {assetsList.map((asset) => {
                // Determine category color decoration
                let scaleBadgeColor = 'bg-slate-800 text-slate-400';
                if (asset.scaleType === 'Erlenmeyer') scaleBadgeColor = 'bg-teal-900/40 text-teal-300 border-teal-800';
                else if (asset.scaleType === 'Balão') scaleBadgeColor = 'bg-sky-900/40 text-sky-300 border-sky-800';
                else if (asset.scaleType === '100L') scaleBadgeColor = 'bg-orange-900/40 text-orange-300 border-orange-850';
                else if (asset.scaleType === '500L') scaleBadgeColor = 'bg-amber-900/40 text-amber-300 border-amber-850';
                else if (asset.scaleType === '3000_5000L') scaleBadgeColor = 'bg-purple-900/40 text-purple-300 border-purple-800';
                else if (asset.scaleType === 'Envase') scaleBadgeColor = 'bg-rose-900/40 text-rose-300 border-rose-800';

                return (
                  <div
                    key={asset.id}
                    className="h-12 px-3 flex flex-col justify-center bg-slate-900 text-xs hover:bg-slate-850 border-b border-slate-800/50"
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="font-bold text-slate-200 tracking-tight text-[11px] truncate" title={asset.name}>
                        {asset.name}
                      </span>
                      <span className={`px-1 rounded text-[9px] font-mono uppercase font-bold border ${scaleBadgeColor} shrink-0`}>
                        {asset.scaleType === '3000_5000L' ? '5kL' : asset.scaleType === 'Envase' ? 'Env.' : asset.scaleType}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right Scrollable Timeline Container */}
          <div 
            ref={timelineContentRef} 
            className="flex-1 overflow-x-auto relative" 
            id="gantt-timeline-scroller"
            onScroll={handleScroll}
          >
            {/* TIMELINE HEADERS */}
            <div className="sticky top-0 z-20 bg-white border-b border-slate-200 shadow-2xs select-none" style={{ width: `${totalDays * dayWidth}px` }}>
              {/* Row 1: Weeks */}
              <div className="flex h-8 bg-slate-900 border-b border-slate-800">
                {Object.entries(weeksMap).map(([key, value]) => {
                  const width = value.days.length * dayWidth;
                  return (
                    <div
                      key={key}
                      className="h-full border-r border-slate-800 flex items-center justify-center text-slate-300 font-bold uppercase tracking-wider text-[10px]"
                      style={{ width: `${width}px` }}
                    >
                      Semana {value.weekNum}
                    </div>
                  );
                })}
              </div>

              {/* Row 2: Days */}
              <div className="flex h-9 bg-slate-800 text-white divide-x divide-slate-700">
                {daysArray.map((day, idx) => {
                  const dayOfWeek = day.getDay();
                  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6; // Sunday or Saturday
                  
                  // Weekend styling
                  const bgClass = isWeekend ? 'bg-slate-700/80 text-amber-200 font-semibold' : 'bg-slate-800';
                  
                  // Determine compactness based on zoom density
                  const isCompact = zoomLevel < 75;
                  
                  return (
                    <div
                      key={idx}
                      className={`h-full flex flex-col justify-center items-center leading-tight shrink-0 text-center ${bgClass}`}
                      style={{ width: `${dayWidth}px` }}
                    >
                      <span className="text-[9px] capitalize font-mono text-slate-300">
                        {day.toLocaleDateString('pt-BR', { weekday: isCompact ? 'narrow' : 'short' })}
                      </span>
                      <span className={`${isCompact ? 'text-[9px] font-black' : 'text-[11px] font-extrabold'} tracking-tight`}>
                        {day.getDate()}{!isCompact && `/${String(day.getMonth() + 1).padStart(2, '0')}`}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* GRID CANVAS & BLOCKS */}
            <div 
              className="relative divide-y divide-slate-200/80 bg-slate-100" 
              style={{ width: `${totalDays * dayWidth}px` }}
              id="gantt-rows-container"
            >
              {/* Draw Vertical shading guidelines for weekend columns and calendar days */}
              <div className="absolute inset-y-0 left-0 flex pointer-events-none z-0">
                {daysArray.map((day, idx) => {
                   const dayOfWeek = day.getDay();
                   const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
                   const isMonday = dayOfWeek === 1;

                   const borderClass = (viewMode === 'weeks' && isMonday) 
                     ? 'border-r-2 border-indigo-400/40' 
                     : 'border-r border-slate-250/50';

                  return (
                    <div
                      key={idx}
                      className={`h-full shrink-0 ${borderClass} ${
                        isWeekend ? 'bg-slate-300/10' : 'bg-transparent'
                      }`}
                      style={{ width: `${dayWidth}px` }}
                    />
                  );
                })}
              </div>

              {/* Draw Current Time Virtual Marker Line */}
              {isTodayVisible && (
                <div 
                  className="absolute inset-y-0 w-0.5 bg-red-500 z-10 pointer-events-none"
                  style={{ left: `${todayLinePos}px` }}
                  title={`Data e hora atual: ${formatFullDate(now.toISOString())}`}
                >
                  <div className="absolute top-0 -translate-x-1/2 bg-red-500 text-white px-1.5 py-0.5 rounded text-[8px] font-black tracking-widest uppercase shadow-md leading-none whitespace-nowrap">
                    AGORA ({formatShortDate(now.toISOString())})
                  </div>
                </div>
              )}

              {/* Loop and draw batches & preventatives inside rows aligned with assetsList */}
              {assetsList.map((asset) => {
                return (
                  <div
                    key={asset.id}
                    className="h-12 relative flex items-center z-0 group hover:bg-slate-50 transition-colors"
                  >
                    
                    {/* PREVENTIVE BLOCKS */}
                    {preventatives
                      .filter(p => normalizeAssetId(p.assetId, envaseLinesCount) === asset.id)
                      .map((prev) => {
                        const start = new Date(prev.startDateTime);
                        const end = new Date(prev.endDateTime);

                        // Overlap calculations
                        if (end <= timelineStart || start >= timelineEnd) return null; // Outside range

                        const vStart = start < timelineStart ? timelineStart : start;
                        const vEnd = end > timelineEnd ? timelineEnd : end;

                        const leftHours = (vStart.getTime() - timelineStart.getTime()) / (1000 * 60 * 60);
                        const durHours = (vEnd.getTime() - vStart.getTime()) / (1000 * 60 * 60);

                        const leftPx = leftHours * hourWidth;
                        const widthPx = durHours * hourWidth;

                        return (
                          <button
                            key={prev.id}
                            onClick={() => setSelectedBlock({ type: 'preventative', preventative: prev, asset })}
                            className="absolute h-[34px] rounded bg-stone-950 text-amber-400 border border-stone-850 z-20 flex items-center justify-start px-2 py-0.5 hover:scale-[1.01] hover:shadow transition-transform text-left cursor-pointer overflow-hidden animate-pulse"
                            style={{
                              left: `${leftPx}px`,
                              width: `${widthPx}px`,
                            }}
                          >
                            <div className="truncate text-[9px] uppercase tracking-wider font-extrabold font-mono w-full">
                              🔒 PREVENTIVA: {prev.description}
                            </div>
                          </button>
                        );
                      })}

                    {/* BATCH STEP BLOCKS */}
                    {batches.flatMap((batch) => {
                      const recipe = recipes.find(r => r.id === batch.productId);
                      const recipeColorOb = COLOR_OPTIONS.find(o => o.value === recipe?.color) || COLOR_OPTIONS[0];

                      return batch.steps
                        .map((step, stepIdx) => ({ step, stepIdx, batch, recipe, recipeColorOb }))
                        .filter(({ step }) => normalizeAssetId(step.assetId, envaseLinesCount) === asset.id)
                        .flatMap(({ step, stepIdx, batch, recipe, recipeColorOb }) => {
                          const start = new Date(step.startDateTime);
                          const end = new Date(step.endDateTime);

                          const blocks: React.ReactNode[] = [];

                          // Render Main Step Execution Block
                          if (!(end <= timelineStart || start >= timelineEnd)) {
                            const vStart = start < timelineStart ? timelineStart : start;
                            const vEnd = end > timelineEnd ? timelineEnd : end;

                            const leftHours = (vStart.getTime() - timelineStart.getTime()) / (1000 * 60 * 60);
                            const durHours = (vEnd.getTime() - vStart.getTime()) / (1000 * 60 * 60);

                            const leftPx = leftHours * hourWidth;
                            const widthPx = durHours * hourWidth;

                            // Conflict check with setup times
                            const stepSetup = setupTimes[step.scaleType] || 0;
                            const e1Setup = end.getTime() + stepSetup * 60 * 60 * 1000;

                            const hasPrevOverlap = preventatives.some(p => 
                              normalizeAssetId(p.assetId, envaseLinesCount) === asset.id && 
                              start.getTime() < new Date(p.endDateTime).getTime() && 
                              new Date(p.startDateTime).getTime() < e1Setup
                            );

                            const hasBatchOverlap = batches.some(b => 
                              b.id !== batch.id && 
                              b.steps.some(st => {
                                if (normalizeAssetId(st.assetId, envaseLinesCount) !== asset.id) return false;
                                const s2 = new Date(st.startDateTime).getTime();
                                const e2 = new Date(st.endDateTime).getTime();
                                const setup2 = setupTimes[st.scaleType] || 0;
                                const e2Setup = e2 + setup2 * 60 * 60 * 1000;
                                return start.getTime() < e2Setup && s2 < e1Setup;
                              })
                            );

                            const displayConflict = hasPrevOverlap || hasBatchOverlap;

                            const isStepContaminated = batch.isContaminated && stepIdx === batch.contaminatedStepIndex;
                            const isStepColliding = !isStepContaminated && displayConflict;

                            const calculatedBgClass = isStepContaminated
                              ? 'bg-slate-700 border-slate-900 text-slate-300'
                              : isStepColliding
                              ? 'bg-rose-600 border-rose-800 text-white animate-pulse'
                              : `${recipeColorOb.bg} ${recipeColorOb.border} text-white`;

                            const extraStyles: React.CSSProperties = {};
                            if (isStepContaminated) {
                              extraStyles.backgroundImage = 'repeating-linear-gradient(45deg, #334155, #334155 8px, #475569 8px, #475569 16px)';
                            }

                            blocks.push(
                              <button
                                key={`${batch.id}-${stepIdx}`}
                                onClick={() => setSelectedBlock({ 
                                  type: 'batch-step', 
                                  batch, 
                                  product: recipe, 
                                  stepIndex: stepIdx,
                                  asset
                                })}
                                className={`absolute h-[38px] rounded border shadow-2xs hover:shadow hover:-translate-y-0.5 z-10 transition-all text-left px-2 py-1 flex flex-col justify-center cursor-pointer overflow-hidden ${calculatedBgClass}`}
                                style={{
                                  left: `${leftPx}px`,
                                  width: `${widthPx}px`,
                                  ...extraStyles
                                }}
                              >
                                <div className="flex items-center justify-between w-full">
                                  <span className="font-black text-[9px] tracking-tight leading-none leading-tight font-mono truncate">
                                    [{step.durationHours}h] {batch.lotNumber}
                                  </span>
                                  {isStepContaminated ? (
                                    <span className="text-[8px] bg-slate-950 text-rose-450 rounded font-bold px-1 select-none font-mono">
                                      🚫 CONTAMINADO
                                    </span>
                                  ) : isStepColliding ? (
                                    <span className="text-[8px] bg-yellow-400 text-slate-950 rounded font-bold px-1 select-none font-mono" title="COLISÃO DE CRONOGRAMA POR ATRASO!">
                                      ⚠️ COLISÃO ATRASO
                                    </span>
                                  ) : displayConflict ? (
                                    <span className="text-[9px] bg-rose-600 text-white rounded font-bold px-1 py-0.2 select-none" title="CONFLITO DE AGENDAMENTO!">
                                      ⚠️ CONFLITO
                                    </span>
                                  ) : null}
                                </div>
                                <div className="text-[10px] font-extrabold truncate w-full tracking-tighter opacity-95">
                                  {recipe?.name || 'Bio-Lote'}
                                </div>
                              </button>
                            );
                          }

                          // Render Setup Block right after the step ends, if setupTime > 0
                          const setupTime = setupTimes[step.scaleType] || 0;
                          if (setupTime > 0) {
                            const setupStart = end;
                            const setupEnd = new Date(setupStart.getTime() + setupTime * 60 * 60 * 1000);

                            if (!(setupEnd <= timelineStart || setupStart >= timelineEnd)) {
                              const vSetupStart = setupStart < timelineStart ? timelineStart : setupStart;
                              const vSetupEnd = setupEnd > timelineEnd ? timelineEnd : setupEnd;

                              const setupLeftHours = (vSetupStart.getTime() - timelineStart.getTime()) / (1000 * 60 * 60);
                              const setupDurHours = (vSetupEnd.getTime() - vSetupStart.getTime()) / (1000 * 60 * 60);

                              const setupLeftPx = setupLeftHours * hourWidth;
                              const setupWidthPx = setupDurHours * hourWidth;

                              blocks.push(
                                <div
                                  key={`${batch.id}-${stepIdx}-setup`}
                                  className="absolute h-[34px] rounded border border-dashed border-slate-300 bg-slate-100 flex items-center justify-center text-slate-400 font-mono font-bold text-[8px] uppercase select-none z-10 opacity-80"
                                  style={{
                                    left: `${setupLeftPx}px`,
                                    width: `${setupWidthPx}px`,
                                  }}
                                  title={`Tempo de Setup / CIP pós lote: ${setupTime}h`}
                                >
                                  SETUP {setupTime}h
                                </div>
                              );
                            }
                          }

                          return blocks;
                        });
                    })}

                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* INSPECIION OVERLAY PANEL MODAL / DETAIL DRAWER */}
      {selectedBlock && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4" id="details-modal">
          <div className="bg-white rounded-xl border border-slate-200 shadow-xl max-w-lg w-full overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            {/* Header */}
            <div className={`px-6 py-4 border-b text-white flex justify-between items-center ${
              selectedBlock.type === 'preventative' 
                ? 'bg-stone-950' 
                : (COLOR_OPTIONS.find(o => o.value === selectedBlock.product?.color)?.bg || 'bg-slate-900')
            }`}>
              <div>
                <span className="text-[10px] font-black tracking-widest uppercase opacity-75">
                  {selectedBlock.type === 'preventative' ? 'Janela de Bloqueio Físico' : 'Ficha de Produção - PCP'}
                </span>
                <h3 className="font-bold text-base">
                  {selectedBlock.type === 'preventative' 
                    ? selectedBlock.preventative?.description 
                    : `${selectedBlock.batch?.lotNumber} - ${selectedBlock.product?.name}`
                  }
                </h3>
              </div>
              <button 
                onClick={() => setSelectedBlock(null)}
                className="text-white bg-white/10 hover:bg-white/20 rounded px-2 py-1 text-xs font-semibold cursor-pointer"
              >
                Fechar
              </button>
            </div>

            {/* Body */}
            <div className="p-6 space-y-4 text-xs text-slate-705">
              
              {selectedBlock.type === 'batch-step' && selectedBlock.batch && selectedBlock.stepIndex !== undefined && (
                <div className="space-y-4">
                  
                  {/* Process details */}
                  <div className="grid grid-cols-2 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-150">
                    <div>
                      <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest block">Lote O.P.</span>
                      <span className="text-sm font-bold text-slate-800 font-mono">{selectedBlock.batch.lotNumber}</span>
                    </div>
                    <div>
                      <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest block">Fórmula Ativa</span>
                      <span className="text-sm font-bold text-slate-800">{selectedBlock.product?.name}</span>
                    </div>
                  </div>

                  {/* Active step details */}
                  <div className="space-y-3">
                    <h4 className="font-bold text-slate-700 text-xs border-b border-slate-100 pb-1 uppercase tracking-wider">Status do Estágio Atual</h4>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 font-medium">
                      <div className="bg-slate-50 p-3 rounded-lg border border-slate-150">
                        <span className="text-[9px] uppercase font-bold text-slate-400 block">Equipamento / Instalação</span>
                        <span className="font-bold text-slate-800 text-xs">{selectedBlock.asset?.name}</span>
                      </div>

                      <div className="bg-slate-50 p-3 rounded-lg border border-slate-150">
                        <span className="text-[9px] uppercase font-bold text-slate-400 block">Duração Estimada</span>
                        <span className="font-bold font-mono text-slate-800 text-xs">
                          {selectedBlock.batch.steps[selectedBlock.stepIndex].durationHours} horas
                        </span>
                      </div>
                    </div>

                    <div className="bg-slate-50 p-3 rounded-lg border border-slate-150 grid grid-cols-2 gap-4">
                      <div>
                        <span className="text-[9px] uppercase font-bold text-slate-400 block">Horário Entrada / Inoculação</span>
                        <span className="font-bold text-slate-800 text-[11px] font-mono">
                          {formatFullDate(selectedBlock.batch.steps[selectedBlock.stepIndex].startDateTime)}
                        </span>
                      </div>
                      <div>
                        <span className="text-[9px] uppercase font-bold text-slate-400 block">Horário Saída / Transferência</span>
                        <span className="font-bold text-slate-800 text-[11px] font-mono">
                          {formatFullDate(selectedBlock.batch.steps[selectedBlock.stepIndex].endDateTime)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Complete recipe track mapping */}
                  <div className="space-y-2">
                    <h4 className="font-bold text-slate-700 text-xs border-b border-slate-100 pb-1 uppercase tracking-wider">Metas da Rota do Lote</h4>
                    <div className="space-y-1.5 max-h-[140px] overflow-y-auto">
                      {selectedBlock.batch.steps.map((st, i) => {
                        const isCurrent = i === selectedBlock.stepIndex;
                        const assetName = assetsList.find(a => a.id === normalizeAssetId(st.assetId, envaseLinesCount))?.name || 'N/A';

                        return (
                          <div
                            key={i}
                            className={`flex items-center justify-between p-2 rounded text-[10px] ${
                              isCurrent 
                                ? 'bg-slate-900 text-white font-bold' 
                                : 'bg-slate-50 text-slate-600'
                            }`}
                          >
                            <span className="font-mono">Estágio {i + 1}: {st.scaleType}</span>
                            <span className="font-bold">{assetName} ({st.durationHours}h)</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* GESTÃO DE DESVIOS E INTERVENÇÕES EM TEMPO REAL */}
                  <div className="mt-4 border-t border-slate-200 pt-4 space-y-4">
                    <h4 className="font-bold text-slate-800 text-xs uppercase tracking-wider flex items-center gap-1.5 bg-slate-50 p-2 rounded">
                      <Sliders size={14} className="text-slate-600 animate-pulse" />
                      Intervenções & Gestão de Desvios (PCP)
                    </h4>

                    {selectedBlock.batch.isContaminated ? (
                      <div className="p-3 bg-slate-100 rounded-xl border border-slate-300 space-y-2 text-slate-700">
                        <div className="flex items-center gap-1.5 text-rose-600 font-extrabold text-[10px] uppercase tracking-widest">
                          🚫 Lote Interrompido por Contaminação
                        </div>
                        <p className="text-[10px] leading-relaxed">
                          Este lote foi congelado no estágio <span className="font-bold">{selectedBlock.batch.steps[selectedBlock.batch.contaminatedStepIndex ?? 0]?.scaleType}</span>.
                        </p>
                        <div className="text-[9px] font-mono bg-slate-200/50 p-2 rounded leading-normal border border-slate-250">
                          <strong>Motivo:</strong> {selectedBlock.batch.contaminationReason}<br />
                          <strong>Observações:</strong> {selectedBlock.batch.contaminationNotes}
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="flex gap-1.5 justify-center border-b border-slate-100 pb-3 font-mono">
                          <button 
                            type="button"
                            onClick={() => setDeviationMode(deviationMode === 'delay' ? 'none' : 'delay')}
                            className={`flex-1 px-2.5 py-2 rounded-lg font-bold text-[9px] uppercase border transition-all cursor-pointer ${
                              deviationMode === 'delay' 
                                ? 'bg-amber-500 text-slate-950 border-amber-650 shadow-sm' 
                                : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                            }`}
                          >
                            ⏱️ Ajustar Horário
                          </button>
                          <button 
                            type="button"
                            onClick={() => setDeviationMode(deviationMode === 'route-swap' ? 'none' : 'route-swap')}
                            className={`flex-1 px-2.5 py-2 rounded-lg font-bold text-[9px] uppercase border transition-all cursor-pointer ${
                              deviationMode === 'route-swap' 
                                ? 'bg-indigo-600 text-white border-indigo-750 shadow-sm' 
                                : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                            }`}
                          >
                            🔀 Trocar Vaso
                          </button>
                          <button 
                            type="button"
                            onClick={() => setDeviationMode(deviationMode === 'contamination' ? 'none' : 'contamination')}
                            className={`flex-1 px-2.5 py-2 rounded-lg font-bold text-[9px] uppercase border transition-all cursor-pointer ${
                              deviationMode === 'contamination' 
                                ? 'bg-rose-500 text-white border-rose-650 shadow-sm' 
                                : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                            }`}
                          >
                            ☣️ Contaminar
                          </button>
                        </div>

                        {deviationMode === 'delay' && (
                          <div className="space-y-3 p-3.5 bg-amber-50/50 rounded-xl border border-amber-250 text-xs animate-fadeIn">
                            <span className="font-extrabold text-amber-850 uppercase text-[9px] tracking-wide block">⏱️ Ajustar Horário / Registrar Atraso</span>
                            
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              <div>
                                <label className="text-[9px] font-bold text-slate-500 uppercase tracking-tight block">Novo Início da Etapa</label>
                                <input 
                                  type="datetime-local"
                                  value={delayInputStart}
                                  onChange={(e) => {
                                    setDelayInputStart(e.target.value);
                                    // calculate hours difference to sync hours input
                                    const orig = new Date(selectedBlock.batch!.steps[selectedBlock.stepIndex!].startDateTime).getTime();
                                    const next = new Date(e.target.value).getTime();
                                    setDelayHoursSecas(Number(((next - orig) / (1000 * 60 * 60)).toFixed(1)));
                                  }}
                                  className="w-full mt-1 px-2 py-1 bg-white border border-slate-300 rounded font-mono font-bold text-slate-800"
                                />
                              </div>
                              <div>
                                <label className="text-[9px] font-bold text-slate-500 uppercase tracking-tight block">Somar/Subtrair Horas (Secas)</label>
                                <input 
                                  type="number"
                                  step="0.5"
                                  value={delayHoursSecas}
                                  onChange={(e) => {
                                    const val = parseFloat(e.target.value) || 0;
                                    setDelayHoursSecas(val);
                                    const orig = new Date(selectedBlock.batch!.steps[selectedBlock.stepIndex!].startDateTime);
                                    const next = new Date(orig.getTime() + val * 60 * 60 * 1000);
                                    setDelayInputStart(formatToDateTimeInput(next));
                                  }}
                                  className="w-full mt-1 px-2 py-1 bg-white border border-slate-300 rounded font-mono font-bold text-center text-slate-800"
                                />
                              </div>
                            </div>

                            <div>
                              <label className="text-[9px] font-bold text-slate-500 uppercase tracking-tight block">Motivo Principal do Desvio</label>
                              <select 
                                value={deviationReason}
                                onChange={(e) => setDeviationReason(e.target.value as any)}
                                className="w-full mt-1 px-2 py-1.5 bg-white border border-slate-300 rounded font-semibold text-slate-700 cursor-pointer"
                              >
                                <option value="">Selecione o motivo...</option>
                                <option value="Mecânico">Mecânico (Falha Compressor/Agitador)</option>
                                <option value="Biológico">Biológico (Mutação/Contaminação)</option>
                                <option value="Operacional">Operacional (Falta Operador/Equipe)</option>
                              </select>
                            </div>

                            <div>
                              <label className="text-[9px] font-bold text-slate-500 uppercase tracking-tight block">Notas Explicativas / Justificativa</label>
                              <textarea
                                value={deviationNotes}
                                onChange={(e) => setDeviationNotes(e.target.value)}
                                placeholder="Descreva os detalhes da alteração (campo obrigatório)..."
                                className="w-full mt-1 px-2.5 py-1.5 bg-white border border-slate-300 rounded min-h-16 text-slate-700"
                              />
                            </div>

                            <button
                              type="button"
                              onClick={handleApplyDelay}
                              disabled={!deviationReason || !deviationNotes.trim()}
                              className="w-full bg-amber-500 hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed text-slate-950 font-bold py-2 rounded-lg text-xs transition-colors cursor-pointer"
                            >
                              Aplicar Deslocamento (+ Efeito Cascata)
                            </button>
                          </div>
                        )}

                        {deviationMode === 'route-swap' && (
                          <div className="space-y-3 p-3.5 bg-indigo-50/50 rounded-xl border border-indigo-250 text-xs animate-fadeIn">
                            <span className="font-extrabold text-indigo-850 uppercase text-[9px] tracking-wide block">🔀 Troca de Rota / Realocação de Vaso</span>

                            <div>
                              <label className="text-[9px] font-bold text-slate-500 uppercase tracking-tight block">Escolha Novo Equipamento Compatível ({selectedBlock.batch.steps[selectedBlock.stepIndex].scaleType})</label>
                              <select 
                                value={swapAssetId}
                                onChange={(e) => setSwapAssetId(e.target.value)}
                                className="w-full mt-1 px-2 py-1.5 bg-white border border-slate-300 rounded font-semibold text-slate-700 cursor-pointer font-mono"
                              >
                                {assetsList
                                  .filter(a => a.scaleType === selectedBlock.batch!.steps[selectedBlock.stepIndex!].scaleType)
                                  .map(a => {
                                    const overlap = isAssetBusy(
                                      a.id, 
                                      selectedBlock.batch!.steps[selectedBlock.stepIndex!].startDateTime, 
                                      selectedBlock.batch!.steps[selectedBlock.stepIndex!].endDateTime, 
                                      selectedBlock.batch!.id,
                                      selectedBlock.batch!.steps[selectedBlock.stepIndex!].scaleType
                                    );
                                    return (
                                      <option key={a.id} value={a.id}>
                                        {a.name} {overlap ? '⚠️ (OCUPADO)' : '✅ (DISPONÍVEL)'}
                                      </option>
                                    );
                                  })
                                }
                              </select>
                            </div>

                            <div>
                              <label className="text-[9px] font-bold text-slate-500 uppercase tracking-tight block">Motivo Principal da Alteração</label>
                              <select 
                                value={deviationReason}
                                onChange={(e) => setDeviationReason(e.target.value as any)}
                                className="w-full mt-1 px-2 py-1.5 bg-white border border-slate-300 rounded font-semibold text-slate-700 cursor-pointer"
                              >
                                <option value="">Selecione o motivo...</option>
                                <option value="Biológico">Biológico (Parâmetro fora do padrão)</option>
                                <option value="Mecânico">Mecânico (Vazamento/Sensor quebrado)</option>
                                <option value="Operacional">Operacional (Logística do galpão/CIP)</option>
                              </select>
                            </div>

                            <div>
                              <label className="text-[9px] font-bold text-slate-500 uppercase tracking-tight block">Notas Explicativas / Justificativa</label>
                              <textarea
                                value={deviationNotes}
                                onChange={(e) => setDeviationNotes(e.target.value)}
                                placeholder="Insira o motivo operacional da mudança de ativo..."
                                className="w-full mt-1 px-2.5 py-1.5 bg-white border border-slate-300 rounded min-h-16 text-slate-700"
                              />
                            </div>

                            <button
                              type="button"
                              onClick={handleApplyRouteSwap}
                              disabled={!deviationReason || !deviationNotes.trim()}
                              className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold py-2 rounded-lg text-xs transition-colors cursor-pointer"
                            >
                              Confirmar Troca de Rota Operacional
                            </button>
                          </div>
                        )}

                        {deviationMode === 'contamination' && (
                          <div className="space-y-3 p-3.5 bg-rose-50/70 rounded-xl border border-rose-250 text-xs animate-fadeIn text-slate-800">
                            <span className="font-extrabold text-rose-850 uppercase text-[9px] tracking-wide block">☣️ Declarar Contaminação do Lote</span>
                            <p className="text-[10px] text-rose-600 leading-relaxed font-semibold">
                              Atenção: Ao registrar contaminação, este lote será <strong className="text-rose-700">congelado definitivamente no estágio atual</strong>. Todas as etapas posteriores agendadas em reatores/envase serão deletadas imediatamente, abrindo espaço para novos agendamentos da planta!
                            </p>

                            <div>
                              <label className="text-[9px] font-bold text-slate-500 uppercase tracking-tight block">Origem da Contaminação</label>
                              <select 
                                value={deviationReason}
                                onChange={(e) => setDeviationReason(e.target.value as any)}
                                className="w-full mt-1 px-2 py-1.5 bg-white border border-slate-300 rounded font-semibold text-slate-700 cursor-pointer"
                              >
                                <option value="">Selecione a origem...</option>
                                <option value="Biológico">Biológico (Fagos / Bactéria Competidora)</option>
                                <option value="Mecânico">Mecânico (Filtro HEPA quebrado / Vedação)</option>
                                <option value="Operacional">Operacional (Falha de esterilização / Inoculadores)</option>
                              </select>
                            </div>

                            <div>
                              <label className="text-[9px] font-bold text-slate-500 uppercase tracking-tight block">Estudo de Causa / Anotacões</label>
                              <textarea
                                value={deviationNotes}
                                onChange={(e) => setDeviationNotes(e.target.value)}
                                placeholder="Ações corretivas emergenciais e detalhes..."
                                className="w-full mt-1 px-2.5 py-1.5 bg-white border border-slate-300 rounded min-h-16 text-slate-700"
                              />
                            </div>

                            <button
                              type="button"
                              onClick={handleApplyContamination}
                              disabled={!deviationReason || !deviationNotes.trim()}
                              className="w-full bg-rose-650 hover:bg-rose-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold py-2 rounded-lg text-xs transition-colors cursor-pointer"
                            >
                              Interromper e Declarar Contaminação ☣️
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Actions inside modal */}
                  <div className="pt-4 border-t border-slate-150 flex justify-between items-center gap-2">
                    <span className="text-[9px] text-slate-400 font-bold font-mono">
                      Ref: {selectedBlock.batch.id.slice(0, 8)}
                    </span>
                    <button
                      onClick={() => {
                        if (confirm(`Deseja realmente apagar e desprogramar o lote completo ${selectedBlock.batch?.lotNumber}?`)) {
                          onDeleteBatch(selectedBlock.batch?.id || '');
                          setSelectedBlock(null);
                        }
                      }}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-50 text-rose-600 border border-rose-200 hover:bg-rose-100 rounded-lg text-[11px] font-bold transition-colors cursor-pointer"
                    >
                      <Trash2 size={12} /> Desprogramar Lote Completo
                    </button>
                  </div>
                </div>
              )}

              {selectedBlock.type === 'preventative' && selectedBlock.preventative && (
                <div className="space-y-4">
                  <div className="p-4 bg-slate-50 rounded-xl border border-slate-150 space-y-3">
                    <div>
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">Ativo Bloqueado</span>
                      <span className="text-sm font-extrabold text-slate-800">{selectedBlock.asset?.name}</span>
                    </div>

                    <div>
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">Motivo / Descrição</span>
                      <span className="text-xs font-semibold text-slate-700 tracking-tight block mt-1 uppercase">
                        {selectedBlock.preventative.description}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 bg-slate-50 p-3 rounded-lg border border-slate-150 font-mono">
                    <div>
                      <span className="text-[9px] font-bold text-slate-400 font-sans block">Início da Manutenção</span>
                      <span className="font-bold text-slate-800 text-[11px]">
                        {formatFullDate(selectedBlock.preventative.startDateTime)}
                      </span>
                    </div>
                    <div>
                      <span className="text-[9px] font-bold text-slate-400 font-sans block">Final da Manutenção</span>
                      <span className="font-bold text-slate-800 text-[11px]">
                        {formatFullDate(selectedBlock.preventative.endDateTime)}
                      </span>
                    </div>
                  </div>

                  <div className="pt-4 border-t border-slate-150 flex justify-end">
                    <button
                      onClick={() => {
                        if (confirm(`Remover bloqueio do ativo ${selectedBlock.asset?.name}?`)) {
                          onDeletePreventative(selectedBlock.preventative?.id || '');
                          setSelectedBlock(null);
                        }
                      }}
                      className="flex items-center gap-1.5 px-4 py-2 bg-stone-900 text-amber-400 border border-stone-800 hover:bg-stone-850 rounded-lg font-semibold transition-colors cursor-pointer"
                    >
                      <Trash2 size={13} /> Liberar Vaso (Liberar Ativo)
                    </button>
                  </div>
                </div>
              )}

            </div>
          </div>
        </div>
      )}
      {/* FLOATING ACTION ALARMS FOR DELAY COLLISIONS */}
      {conflictingStepsList.length > 0 && (
        <div 
          className="fixed bottom-6 right-6 z-50 max-w-sm bg-rose-50 border-2 border-rose-500 rounded-2xl p-4 shadow-2xl animate-bounce" 
          id="collision-floating-alert"
          style={{ animationDuration: '3s' }}
        >
          <div className="flex items-start gap-3">
            <div className="bg-rose-500 text-white rounded-lg p-1.5 shrink-0">
              <AlertTriangle size={18} />
            </div>
            <div className="space-y-1.5 flex-1">
              <h4 className="font-extrabold text-xs text-rose-800 uppercase tracking-wider">Colisão de Agendamento por Atraso</h4>
              <p className="text-[10px] text-rose-600 leading-normal font-semibold">
                O realinhamento/delay de lotes gerou sobreposição com outros lotes ou manutenções:
              </p>
              <div className="max-h-32 overflow-y-auto space-y-1.5 pt-1 pr-1 border-t border-rose-150 mt-1 scrollbar-thin">
                {conflictingStepsList.map((c, i) => (
                  <div key={i} className="text-[9px] font-mono text-rose-700 bg-rose-100/50 p-2 rounded border border-rose-200">
                    Lote <span className="font-extrabold">{c.batch.lotNumber}</span> • {c.step.scaleType}<br />
                    no Ativo <span className="font-extrabold text-rose-800">{c.assetName}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
