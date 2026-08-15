/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { Batch, Preventative, ScaleType, Asset, getAssetsPool, normalizeAssetId, COLOR_OPTIONS, ProductRecipe, DeviationLog, ScheduledStep, PlanningErrorLog, FactoryScaleCounts } from '../types';
import { formatFullDate, formatShortDate, getWeekNumber, areIntervalsOverlapping, assignStepOpNumbers, getInoculationDateForAnchoredScale, calculateProductionTimeline, getBatchYield } from '../utils/timeline';
import { ChevronLeft, ChevronRight, Calendar, AlertTriangle, ShieldCheck, Trash2, Sliders, Info, Eye, Edit3, Check, Plus, Sparkles, Clock, X, BarChart3, Lock, Search } from 'lucide-react';

export function isAssetMatch(targetAssetId: string, rowAssetId: string, envaseCount: number): boolean {
  if (!targetAssetId || !rowAssetId) return false;
  return normalizeAssetId(targetAssetId, envaseCount) === normalizeAssetId(rowAssetId, envaseCount);
}

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
  scaleCounts?: FactoryScaleCounts;
  onUpdateScaleCount?: (scale: keyof FactoryScaleCounts, delta: number) => void;
  customAssets?: Asset[];
  deviations?: DeviationLog[];
  planningErrors?: PlanningErrorLog[];
  onDeleteCampaignBatches?: (productId: string | 'all', monthIndex: number | 'all') => void;
}

// Visual category groupings for rows
const CATEGORIES = [
  { label: 'Erlenmeyer', scaleType: 'Erlenmeyer' },
  { label: 'Balão', scaleType: 'Balão' },
  { label: 'Tanques 100L', scaleType: '100L' },
  { label: 'Tanques 500L', scaleType: '500L' },
  { label: 'Tanques 3000L/5000L', scaleType: '3000_5000L' },
  { label: 'Linha de Envase', scaleType: 'Envase', isLine: true }
];

function GanttTimeline({ batches, preventatives, recipes, onDeleteBatch, onDeletePreventative, onUpdateBatches, onAddDeviationLog, setupTimes, envaseLinesCount, scaleCounts, onUpdateScaleCount, customAssets, deviations = [], planningErrors = [], onDeleteCampaignBatches }: GanttTimelineProps) {
  const [visibleScales, setVisibleScales] = useState<Record<ScaleType, boolean>>(() => {
    const saved = localStorage.getItem('pcp_gantt_visible_scales');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object') return parsed;
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

  const getScaleSortWeight = (scaleType: string, capacity?: number, name?: string): number => {
    const sLower = scaleType.toLowerCase();
    const nLower = (name || '').toLowerCase();
    const combined = `${sLower} ${nLower}`;

    if (sLower.includes('erlenmeyer') || nLower.includes('erlen')) return 10;
    if (sLower.includes('balão') || sLower.includes('balao') || nLower.includes('balão')) return 20;
    if (sLower.includes('envase') || nLower.includes('envase')) return 999900;

    // 1. Check custom tab order from Mapeamento de Equipamentos
    try {
      const savedScalesOrder = localStorage.getItem('pcp_custom_scales_list');
      if (savedScalesOrder) {
        const orderArr: string[] = JSON.parse(savedScalesOrder);
        const idx = orderArr.indexOf(scaleType);
        if (idx >= 0) {
          return 100 + (idx * 50);
        }
      }
    } catch (e) {}

    // 2. Capacity in Liters (100L -> 1100, 200L -> 1200, 500L -> 1500, 3000L -> 4000, 5000L -> 6000)
    if (capacity && capacity > 0) {
      return 1000 + capacity;
    }

    const matchNum = combined.match(/(\d+)/);
    if (matchNum) {
      const parsedNum = parseInt(matchNum[1], 10);
      if (!isNaN(parsedNum) && parsedNum > 0) {
        return 1000 + (parsedNum < 50 ? parsedNum * 100 : parsedNum);
      }
    }

    if (combined.includes('100l') || combined.includes('100 l')) return 1100;
    if (combined.includes('200l') || combined.includes('200 l') || combined.includes('200')) return 1200;
    if (combined.includes('500l') || combined.includes('500 l')) return 1500;
    if (combined.includes('3000') || combined.includes('3kl')) return 4000;
    if (combined.includes('5000') || combined.includes('5kl')) return 6000;

    return 50000;
  };

  const rawAssets = customAssets || getAssetsPool(scaleCounts || envaseLinesCount);
  const fullAssetsList = React.useMemo(() => {
    return [...rawAssets].sort((a, b) => {
      const wA = getScaleSortWeight(a.scaleType, a.capacityLiters, a.name);
      const wB = getScaleSortWeight(b.scaleType, b.capacityLiters, b.name);
      if (wA !== wB) return wA - wB;
      return a.name.localeCompare(b.name, undefined, { numeric: true });
    });
  }, [rawAssets]);

  const assetsList = fullAssetsList.filter(asset => visibleScales[asset.scaleType] !== false);

  const [activeYear, setActiveYear] = useState<number>(() => {
    const saved = localStorage.getItem('pcp_gantt_active_year');
    if (saved !== null) {
      const parsed = parseInt(saved, 10);
      if (!isNaN(parsed) && parsed >= 2020 && parsed <= 2035) return parsed;
    }
    return new Date().getFullYear();
  });

  useEffect(() => {
    localStorage.setItem('pcp_gantt_active_year', String(activeYear));
  }, [activeYear]);

  const [activeMonth, setActiveMonth] = useState<number | null>(() => {
    const saved = localStorage.getItem('pcp_gantt_active_month');
    if (saved !== null) {
      if (saved === 'all') return null;
      const parsed = parseInt(saved, 10);
      if (!isNaN(parsed) && parsed >= 0 && parsed <= 11) return parsed;
    }
    return new Date().getMonth();
  });

  useEffect(() => {
    if (activeMonth === null) {
      localStorage.setItem('pcp_gantt_active_month', 'all');
    } else {
      localStorage.setItem('pcp_gantt_active_month', String(activeMonth));
    }
  }, [activeMonth]);

  const [showCropSeasonsModal, setShowCropSeasonsModal] = useState<boolean>(false);

  // Available years dynamically derived from batches + default range 2024 to 2028
  const availableYears = Array.from(new Set([
    2024, 2025, 2026, 2027, 2028,
    ...batches.map(b => {
      const d = new Date(b.startDateTime);
      return isNaN(d.getTime()) ? null : d.getFullYear();
    }).filter((y): y is number => y !== null)
  ])).sort((a, b) => a - b);

  const [viewMode, setViewMode] = useState<'days' | 'weeks'>('days');
  const [now, setNow] = useState<Date>(new Date());

  useEffect(() => {
    const interval = setInterval(() => {
      setNow(new Date());
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  const isJumpingToSearchRef = useRef<boolean>(false);
  const isJumpingToTodayRef = useRef<boolean>(false);
  const isInitialMountRef = useRef<boolean>(false);

  // Automatically focus on current day/time (AGORA) upon login/initial mount
  useEffect(() => {
    if (!isInitialMountRef.current) {
      isInitialMountRef.current = true;
      isJumpingToTodayRef.current = true;
      const today = new Date();
      setActiveYear(today.getFullYear());
      setActiveMonth(today.getMonth());
    }
  }, []);

  // Month names in Portuguese for filtering
  const MONTHS_PT = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
  ];

  // Helper to calculate active batches and preventatives per month of activeYear
  const getMonthlyStats = (monthIdx: number) => {
    const startOfMonth = new Date(activeYear, monthIdx, 1, 0, 0, 0);
    const endOfMonth = new Date(activeYear, monthIdx + 1, 0, 23, 59, 59, 999);

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
    scrollToDate(new Date(activeYear, monthIdx, 1), 'smooth');
  };

  const handleSelectYear = (yearVal: number) => {
    setActiveYear(yearVal);
    const targetMonth = activeMonth !== null ? activeMonth : 0;
    scrollToDate(new Date(yearVal, targetMonth, 1), 'smooth');
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

  const [quickScheduleData, setQuickScheduleData] = useState<{
    asset: Asset;
    clickedDate: Date;
    recipeId: string;
    anchorMode: 'clicked_asset' | 'inoculation' | 'envase';
    opNumber: string;
    customStartStr?: string;
  } | null>(null);

  const [zoomLevel, setZoomLevel] = useState<number>(120); // Width of 1 day in pixels

  // Search state & index for Excel-like batch finder (with debounced fast input buffer)
  const [searchInput, setSearchInput] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [currentMatchIndex, setCurrentMatchIndex] = useState<number>(0);
  const [highlightedBatchId, setHighlightedBatchId] = useState<string | null>(null);
  const [highlightedStepIndex, setHighlightedStepIndex] = useState<number | null>(null);

  // Debounce search input to avoid laggy renders while typing fast
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchQuery(searchInput);
    }, 180);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // State variables for Deviation / Interventions
  const [deviationMode, setDeviationMode] = useState<'none' | 'delay' | 'route-swap' | 'contamination'>('none');
  const [deviationReason, setDeviationReason] = useState<'Mecânico' | 'Biológico' | 'Operacional' | ''>('');
  const [deviationNotes, setDeviationNotes] = useState<string>('');

  const [delayInputStart, setDelayInputStart] = useState<string>('');
  const [delayHoursSecas, setDelayHoursSecas] = useState<number>(0);
  const [swapAssetId, setSwapAssetId] = useState<string>('');

  const [isEditingLotNumber, setIsEditingLotNumber] = useState<boolean>(false);
  const [editedLotNumber, setEditedLotNumber] = useState<string>('');

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
      setEditedLotNumber(selectedBlock.batch.lotNumber);
      setIsEditingLotNumber(false);
    } else {
      setDeviationMode('none');
      setDeviationReason('');
      setDeviationNotes('');
      setIsEditingLotNumber(false);
    }
  }, [selectedBlock, envaseLinesCount]);

  const handleSaveLotNumber = () => {
    if (!selectedBlock?.batch || !editedLotNumber.trim()) return;

    const newLotNumber = editedLotNumber.trim();
    const updatedSteps = assignStepOpNumbers(selectedBlock.batch.steps, newLotNumber);

    const updatedBatch: Batch = {
      ...selectedBlock.batch,
      lotNumber: newLotNumber,
      steps: updatedSteps
    };

    const updatedBatchesList = batches.map(b => b.id === updatedBatch.id ? updatedBatch : b);
    onUpdateBatches(updatedBatchesList);

    setSelectedBlock(prev => prev ? {
      ...prev,
      batch: updatedBatch
    } : null);

    setIsEditingLotNumber(false);
  };

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
      category: deviationReason,
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
      category: deviationReason,
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
      category: deviationReason,
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

  // Dynamically scope timeline range: if a month is active, render only that month (~30 days), reducing DOM nodes by 90%!
  const { timelineStart, timelineEnd, totalDays } = React.useMemo(() => {
    if (activeMonth !== null) {
      const start = new Date(activeYear, activeMonth, 1, 0, 0, 0);
      const end = new Date(activeYear, activeMonth + 1, 0, 23, 59, 59);
      const daysCount = new Date(activeYear, activeMonth + 1, 0).getDate();
      return { timelineStart: start, timelineEnd: end, totalDays: daysCount };
    } else {
      const start = new Date(`${activeYear}-01-01T00:00:00`);
      const end = new Date(`${activeYear}-12-31T23:59:59`);
      const isLeapYear = (activeYear % 4 === 0 && activeYear % 100 !== 0) || (activeYear % 400 === 0);
      return { timelineStart: start, timelineEnd: end, totalDays: isLeapYear ? 366 : 365 };
    }
  }, [activeYear, activeMonth]);

  // Memoize days array and weeks map for ultra-fast rendering
  const { daysArray, weeksMap } = React.useMemo<{
    daysArray: Date[];
    weeksMap: Record<string, { weekNum: number; days: Date[] }>;
  }>(() => {
    const days: Date[] = [];
    const tStart = new Date(timelineStart);
    for (let i = 0; i < totalDays; i++) {
      const d = new Date(tStart);
      d.setDate(tStart.getDate() + i);
      days.push(d);
    }

    const wMap: Record<string, { weekNum: number; days: Date[] }> = {};
    days.forEach(day => {
      const { week, year } = getWeekNumber(day);
      const key = `W${week}-${year}`;
      if (!wMap[key]) {
        wMap[key] = { weekNum: week, days: [] };
      }
      wMap[key].days.push(day);
    });

    return { daysArray: days, weeksMap: wMap };
  }, [timelineStart, totalDays]);

  const scrollToDate = (date: Date, behavior: ScrollBehavior = 'smooth') => {
    if (timelineContentRef.current) {
      const diffTime = date.getTime() - timelineStart.getTime();
      const diffDays = diffTime / (1000 * 60 * 60 * 24);
      const containerWidth = timelineContentRef.current.clientWidth || 800;
      const scrollLeft = (diffDays * dayWidth) - (containerWidth / 2) + (dayWidth / 2);
      timelineContentRef.current.scrollTo({ left: Math.max(0, scrollLeft), behavior });
    }
  };

  // Single, unified scroll controller: triggers whenever timeline scope (timelineStart) or zoomLevel changes
  useEffect(() => {
    if (isJumpingToSearchRef.current) return;

    const today = new Date();
    const isTodayInActiveMonth = (activeYear === today.getFullYear() && (activeMonth === null || activeMonth === today.getMonth()));
    const shouldScrollToToday = isJumpingToTodayRef.current || isTodayInActiveMonth;

    if (isJumpingToTodayRef.current) {
      isJumpingToTodayRef.current = false;
    }

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (shouldScrollToToday) {
          scrollToDate(today, 'smooth');
        } else {
          const targetMonth = activeMonth !== null ? activeMonth : 0;
          scrollToDate(new Date(activeYear, targetMonth, 1), 'auto');
        }
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timelineStart, zoomLevel]);

  // Optimized scroll handler (runs without re-rendering during active month view)
  const handleScroll = () => {
    if (activeMonth !== null) return; // Month is locked, no re-render needed during scroll
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
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth();

    isJumpingToSearchRef.current = false;
    isJumpingToTodayRef.current = true;

    if (activeYear !== currentYear || activeMonth !== currentMonth) {
      setActiveYear(currentYear);
      setActiveMonth(currentMonth);
    } else {
      scrollToDate(today, 'smooth');
    }
  };

  // Search matching logic across OPs, Lot numbers, Product names, Batch IDs, and Notes
  const searchResults = React.useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.trim().toLowerCase();

    const results: {
      batch: Batch;
      stepIndex: number;
      step: ScheduledStep;
      recipeName: string;
    }[] = [];

    batches.forEach(b => {
      const recipe = recipes.find(r => r.id === b.productId);
      const recipeName = recipe?.name || '';
      const lotStr = (b.lotNumber || '').toLowerCase();
      const idStr = (b.id || '').toLowerCase();
      const prodStr = recipeName.toLowerCase();
      const notesStr = (b.contaminationNotes || '').toLowerCase();
      const reasonStr = (b.contaminationReason || '').toLowerCase();

      b.steps.forEach((st, sIdx) => {
        const opStr = (st.opNumber || '').toLowerCase();
        const normAssetId = normalizeAssetId(st.assetId, envaseLinesCount);
        const assetObj = fullAssetsList.find(a => normalizeAssetId(a.id, envaseLinesCount) === normAssetId);
        const assetStr = (assetObj?.name || st.assetId || '').toLowerCase();
        const scaleStr = (st.scaleType || '').toLowerCase();

        if (
          lotStr.includes(q) ||
          opStr.includes(q) ||
          idStr.includes(q) ||
          prodStr.includes(q) ||
          notesStr.includes(q) ||
          reasonStr.includes(q) ||
          assetStr.includes(q) ||
          scaleStr.includes(q)
        ) {
          results.push({
            batch: b,
            stepIndex: sIdx,
            step: st,
            recipeName
          });
        }
      });
    });

    return results;
  }, [searchQuery, batches, recipes, fullAssetsList, envaseLinesCount]);

  const [showSearchDropdown, setShowSearchDropdown] = useState<boolean>(false);

  const handleJumpToMatch = (index: number) => {
    if (searchResults.length === 0) return;
    const matchIndex = (index + searchResults.length) % searchResults.length;
    setCurrentMatchIndex(matchIndex);

    const match = searchResults[matchIndex];
    if (!match) return;

    isJumpingToSearchRef.current = true;

    // Ensure scale is visible if currently hidden
    if (!visibleScales[match.step.scaleType]) {
      setVisibleScales(prev => ({ ...prev, [match.step.scaleType]: true }));
    }

    const stepDate = new Date(match.step.startDateTime);

    // Switch year if step is in a different year
    if (stepDate.getFullYear() !== activeYear) {
      setActiveYear(stepDate.getFullYear());
    }

    // Switch month if step is in a different month
    if (activeMonth !== stepDate.getMonth()) {
      setActiveMonth(stepDate.getMonth());
    }

    // Set pulse highlight
    setHighlightedBatchId(match.batch.id);
    setHighlightedStepIndex(match.stepIndex);

    // Scroll directly to element and timestamp
    setTimeout(() => {
      scrollToDate(stepDate, 'smooth');

      const stepBtnId = `gantt-step-block-${match.batch.id}-${match.stepIndex}`;
      const stepEl = document.getElementById(stepBtnId);
      if (stepEl) {
        stepEl.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
      } else {
        const normAssetId = normalizeAssetId(match.step.assetId, envaseLinesCount);
        const rowEl = document.getElementById(`gantt-asset-row-${normAssetId}`);
        if (rowEl) {
          rowEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }

      setTimeout(() => {
        isJumpingToSearchRef.current = false;
      }, 600);
    }, 200);
  };

  useEffect(() => {
    if (searchQuery.trim()) {
      setCurrentMatchIndex(0);
      setShowSearchDropdown(true);
      if (searchResults.length > 0) {
        handleJumpToMatch(0);
      } else {
        setHighlightedBatchId(null);
        setHighlightedStepIndex(null);
      }
    } else {
      setShowSearchDropdown(false);
      setHighlightedBatchId(null);
      setHighlightedStepIndex(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery]);

  // Determine if today's date context is visible
  const isTodayVisible = now >= timelineStart && now <= timelineEnd;
  
  // Calculate today line horizontal position
  let todayLinePos = 0;
  if (isTodayVisible) {
    const diffHours = (now.getTime() - timelineStart.getTime()) / (1000 * 60 * 60);
    todayLinePos = diffHours * hourWidth;
  }

  // Calculate conflicts/collisions list caused by delay adjustments or manual scheduling (Memoized)
  const conflictingStepsList = React.useMemo(() => {
    const list: { batch: Batch; step: ScheduledStep; assetName: string; index: number }[] = [];
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
          list.push({
            batch: b,
            step: st,
            assetName: asset?.name || normAssetId,
            index: sIdx
          });
        }
      });
    });
    return list;
  }, [batches, preventatives, setupTimes, envaseLinesCount, assetsList]);

  // Dynamic suggestions for deviation reasons
  const delaySuggestions = Array.from(new Set([
    'Mecânico',
    'Biológico',
    'Operacional',
    'Ajuste de Horário',
    'Atraso na liberação de laudo',
    'Manutenção corretiva',
    'Setup prolongado',
    'Mecânico (Falha Compressor/Agitador)',
    'Biológico (Mutação/Contaminação)',
    'Operacional (Falta Operador/Equipe)',
    ...deviations
      .filter(d => d.type === 'DELAY')
      .map(d => d.reason)
  ])).filter(Boolean);

  const swapSuggestions = Array.from(new Set([
    'Biológico',
    'Mecânico',
    'Operacional',
    'Biológico (Parâmetro fora do padrão)',
    'Mecânico (Vazamento/Sensor quebrado)',
    'Operacional (Logística do galpão/CIP)',
    'Troca de reator por CIP prolongado',
    'Reator indisponível',
    'Gargalo físico',
    ...deviations
      .filter(d => d.type === 'ROUTE_CHANGE')
      .map(d => d.reason)
  ])).filter(Boolean);

  const contaminationSuggestions = Array.from(new Set([
    'Biológico',
    'Mecânico',
    'Operacional',
    'Biológico (Fagos / Bactéria Competidora)',
    'Mecânico (Filtro HEPA quebrado / Vedação)',
    'Operacional (Falha de esterilização / Inoculadores)',
    'Contaminação por fagos',
    'Falha no filtro HEPA',
    'Falha operacional de inoculação',
    ...deviations
      .filter(d => d.type === 'CONTAMINATION')
      .map(d => d.reason)
  ])).filter(Boolean);

  // Month names helper for displaying month label in the summary card
  const MONTHS_LABEL_PT = [
    'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun',
    'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'
  ];
  const activeMonthLabel = activeMonth !== null ? MONTHS_LABEL_PT[activeMonth] : null;

  // Compute per-product planned and unfeasible volume statistics (Memoized for high performance)
  const productVolumeSummary = React.useMemo(() => {
    return recipes.map(recipe => {
      const allProductBatches = batches.filter(b => b.productId === recipe.id);
      
      // Filter batches belonging to activeYear
      const yearBatches = allProductBatches.filter(b => {
        const mainStep = b.steps.find(s => s.scaleType === 'Envase') || b.steps[0];
        if (!mainStep) return false;
        const d = new Date(mainStep.startDateTime);
        return d.getFullYear() === activeYear;
      });

      const totalAccumulatedBatchesCount = yearBatches.length;
      const totalAccumulatedVolumeLiters = yearBatches.reduce((acc, b) => acc + getBatchYield(b, recipe, customAssets || envaseLinesCount), 0);

      // Batches whose Envase (or start) falls in the currently active month of activeYear
      const monthBatches = activeMonth !== null
        ? yearBatches.filter(b => {
            const envaseStep = b.steps.find(s => s.scaleType === 'Envase') || b.steps[b.steps.length - 1];
            if (!envaseStep) return false;
            const d = new Date(envaseStep.startDateTime);
            return d.getMonth() === activeMonth;
          })
        : yearBatches;

      const monthBatchesCount = monthBatches.length;
      const monthVolumeLiters = monthBatches.reduce((acc, b) => acc + getBatchYield(b, recipe, customAssets || envaseLinesCount), 0);

      const productErrors = (planningErrors || []).filter(e => e.productId === recipe.id || e.productName === recipe.name);
      const unfeasibleErrorCount = productErrors.filter(e => !e.canBypass).length;
      const unfeasibleVolumeLiters = unfeasibleErrorCount * recipe.yieldPerBatch;

      return {
        recipe,
        totalAccumulatedBatchesCount,
        totalAccumulatedVolumeLiters,
        monthBatchesCount,
        monthVolumeLiters,
        unfeasibleErrorCount,
        unfeasibleVolumeLiters,
        hasActivity: totalAccumulatedBatchesCount > 0 || unfeasibleErrorCount > 0
      };
    }).filter(item => item.hasActivity || batches.length === 0);
  }, [recipes, batches, activeYear, activeMonth, customAssets, envaseLinesCount, planningErrors]);

  const totalAccumulatedVolumeAll = productVolumeSummary.reduce((sum, p) => sum + p.totalAccumulatedVolumeLiters, 0);
  const totalMonthVolumeAll = productVolumeSummary.reduce((sum, p) => sum + p.monthVolumeLiters, 0);
  const totalUnfeasibleVolumeAll = productVolumeSummary.reduce((sum, p) => sum + p.unfeasibleVolumeLiters, 0);

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
          {/* SEARCH BAR (Excel-like Localizador de Lote / OP) */}
          <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl border border-slate-250 shrink-0 shadow-3xs">
            <div className="relative flex items-center">
              <Search size={14} className="absolute left-2.5 text-slate-400 pointer-events-none" />
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    setSearchQuery(searchInput);
                    if (e.shiftKey) handleJumpToMatch(currentMatchIndex - 1);
                    else handleJumpToMatch(currentMatchIndex + 1);
                  }
                }}
                placeholder="Pesquisar OP, Lote, Produto (ex: OP-1024)..."
                className="pl-8 pr-7 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-semibold text-slate-800 focus:outline-none focus:border-indigo-500 w-44 sm:w-60"
              />
              {searchInput && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchInput('');
                    setSearchQuery('');
                    setHighlightedBatchId(null);
                    setHighlightedStepIndex(null);
                    setShowSearchDropdown(false);
                  }}
                  className="absolute right-2 text-slate-400 hover:text-slate-700 cursor-pointer"
                  title="Limpar pesquisa"
                >
                  <X size={12} />
                </button>
              )}

              {/* Quick Search Matches Dropdown Menu */}
              {searchQuery.trim() !== '' && showSearchDropdown && searchResults.length > 0 && (
                <div className="absolute top-full left-0 mt-2 w-80 bg-white rounded-2xl border border-slate-200 shadow-2xl z-50 overflow-hidden animate-fadeIn">
                  <div className="p-2.5 bg-slate-50 border-b border-slate-150 flex items-center justify-between text-[10px] font-extrabold text-slate-500 uppercase tracking-wider">
                    <span>Lotes Encontrados ({searchResults.length})</span>
                    <button onClick={() => setShowSearchDropdown(false)} className="hover:text-slate-800 cursor-pointer p-0.5">
                      <X size={12} />
                    </button>
                  </div>
                  <div className="max-h-60 overflow-y-auto divide-y divide-slate-100">
                    {searchResults.slice(0, 8).map((res, rIdx) => {
                      const isCurrent = rIdx === currentMatchIndex;
                      const stepStartFormatted = formatFullDate(res.step.startDateTime);
                      const opTag = res.step.opNumber || res.batch.lotNumber;
                      return (
                        <button
                          key={`${res.batch.id}-${res.stepIndex}`}
                          type="button"
                          onClick={() => {
                            handleJumpToMatch(rIdx);
                            setShowSearchDropdown(false);
                          }}
                          className={`w-full p-2.5 text-left flex items-start gap-2.5 transition-colors cursor-pointer ${
                            isCurrent ? 'bg-indigo-50/90 font-bold border-l-4 border-indigo-600' : 'hover:bg-slate-50'
                          }`}
                        >
                          <div className="p-1.5 bg-indigo-100 text-indigo-700 rounded-lg shrink-0 mt-0.5">
                            <Search size={13} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-1">
                              <span className="font-extrabold text-xs text-slate-800 font-mono truncate">{opTag}</span>
                              <span className="text-[9px] font-bold text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded font-mono border border-slate-200 shrink-0">
                                {res.step.scaleType}
                              </span>
                            </div>
                            <p className="text-[10px] text-slate-600 truncate font-semibold mt-0.5">{res.recipeName}</p>
                            <p className="text-[9px] text-slate-400 font-mono mt-0.5">📅 {stepStartFormatted}</p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {searchQuery.trim() !== '' && (
              <div className="flex items-center gap-1 text-[11px] font-bold text-slate-600 pl-1 pr-1">
                {searchResults.length > 0 ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setShowSearchDropdown(!showSearchDropdown)}
                      className="font-mono text-indigo-700 font-extrabold bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-150 whitespace-nowrap cursor-pointer hover:bg-indigo-100"
                      title="Ver lista de resultados"
                    >
                      {currentMatchIndex + 1}/{searchResults.length}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleJumpToMatch(currentMatchIndex - 1)}
                      className="p-1 hover:bg-slate-200 rounded text-slate-600 transition-colors cursor-pointer"
                      title="Anterior (Shift + Enter)"
                    >
                      <ChevronLeft size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleJumpToMatch(currentMatchIndex + 1)}
                      className="p-1 hover:bg-slate-200 rounded text-slate-600 transition-colors cursor-pointer"
                      title="Próximo (Enter)"
                    >
                      <ChevronRight size={14} />
                    </button>
                  </>
                ) : (
                  <span className="text-rose-600 font-mono text-[10px] bg-rose-50 px-1.5 py-0.5 rounded border border-rose-150 whitespace-nowrap">
                    0 resultados
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Zoom controls */}
          <div className="flex items-center gap-1 border-r border-slate-200 pr-3 mr-1">
            <span className="text-[10px] font-black text-slate-400 uppercase mr-1">Zoom:</span>
            <button
              type="button"
              onClick={() => setZoomLevel(prev => Math.max(30, prev - 20))}
              className="px-2 py-1 bg-slate-50 hover:bg-slate-150 text-slate-700 border border-slate-250 rounded text-xs font-bold transition-all cursor-pointer"
              title="Diminuir Zoom"
            >
              - Zoom
            </button>
            <button
              type="button"
              onClick={() => setZoomLevel(prev => Math.min(250, prev + 20))}
              className="px-2 py-1 bg-slate-50 hover:bg-slate-150 text-slate-700 border border-slate-250 rounded text-xs font-bold transition-all cursor-pointer"
              title="Aumentar Zoom"
            >
              + Zoom
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

          {/* Multi-Year & Crop Season Selector */}
          <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl border border-slate-250 shrink-0">
            <span className="text-[10px] font-black uppercase text-slate-500 tracking-tight px-1 flex items-center gap-1">
              🌾 Safra / Ano:
            </span>
            <select
              value={activeYear}
              onChange={(e) => handleSelectYear(parseInt(e.target.value, 10))}
              className="bg-white text-slate-900 font-mono font-extrabold text-xs px-2.5 py-1 rounded-lg border border-slate-300 focus:outline-none cursor-pointer shadow-3xs"
            >
              {availableYears.map(y => (
                <option key={y} value={y}>
                  Safra {y} {y < now.getFullYear() ? '(Histórico 🔒)' : y === now.getFullYear() ? '(🟢 Safra Ativa)' : '(Futura 🔮)'}
                </option>
              ))}
            </select>

            {activeYear < now.getFullYear() && (
              <span className="text-[9px] font-bold bg-amber-100 text-amber-800 border border-amber-200 px-1.5 py-0.5 rounded flex items-center gap-1" title="Ano encerrado em modo histórico de auditoria">
                🔒 Audit
              </span>
            )}

            <button
              type="button"
              onClick={() => setShowCropSeasonsModal(true)}
              className="px-2 py-1 bg-white hover:bg-slate-200 text-slate-700 font-bold text-[10px] rounded-lg border border-slate-250 transition-all cursor-pointer flex items-center gap-1 shadow-3xs"
              title="Ver comparativo plurianual entre Safras"
            >
              <BarChart3 size={12} className="text-indigo-600" />
              <span>Safras</span>
            </button>
          </div>
        </div>
      </div>

      {/* ULTRA-COMPACT SLIM PCP VOLUME SUMMARY BAR (Visão Mensal + Acumulada) */}
      <div className="bg-white px-4 py-2.5 rounded-xl border border-slate-200 shadow-2xs flex flex-wrap items-center justify-between gap-3 text-xs">
        {/* Left: Product Badges */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 font-mono mr-1">
            {activeMonthLabel ? `Volume (${activeMonthLabel} / Total):` : 'Volume Acumulado:'}
          </span>
          {productVolumeSummary.map(({ recipe, totalAccumulatedBatchesCount, totalAccumulatedVolumeLiters, monthBatchesCount, monthVolumeLiters, unfeasibleErrorCount, unfeasibleVolumeLiters }) => {
            const colorOb = COLOR_OPTIONS.find(o => o.value === recipe.color) || COLOR_OPTIONS[0];

            return (
              <div 
                key={recipe.id} 
                className="flex items-center gap-2 px-2.5 py-1 bg-slate-50 border border-slate-200/80 rounded-lg text-slate-700 font-medium hover:border-slate-350 transition-all shadow-3xs"
              >
                <span className={`w-2.5 h-2.5 rounded-full ${colorOb.bg} border ${colorOb.border} shrink-0`}></span>
                <span className="font-bold text-slate-800">{recipe.name}:</span>

                {activeMonthLabel ? (
                  <div className="flex items-center gap-1.5 font-mono">
                    <span className="text-indigo-600 font-bold bg-indigo-50 px-1.5 py-0.5 rounded text-[11px]" title={`Programado no mês de ${activeMonthLabel}`}>
                      {activeMonthLabel}: {monthVolumeLiters.toLocaleString('pt-BR')} L <span className="text-[9px] text-indigo-400 font-normal">({monthBatchesCount} lotes)</span>
                    </span>
                    <span className="text-slate-300">|</span>
                    <span className="text-emerald-600 font-bold text-[11px]" title="Total Geral Acumulado no Gantt">
                      Total: {totalAccumulatedVolumeLiters.toLocaleString('pt-BR')} L <span className="text-[9px] text-slate-400 font-normal">({totalAccumulatedBatchesCount} lotes)</span>
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1 font-mono">
                    <span className="font-bold text-emerald-600 text-[11px]">
                      {totalAccumulatedVolumeLiters.toLocaleString('pt-BR')} L
                    </span>
                    <span className="text-[10px] text-slate-400">({totalAccumulatedBatchesCount} {totalAccumulatedBatchesCount === 1 ? 'lote' : 'lotes'})</span>
                  </div>
                )}

                {unfeasibleVolumeLiters > 0 ? (
                  <span className="text-[9px] font-bold bg-rose-100 text-rose-700 border border-rose-200 px-1.5 py-0.5 rounded ml-1" title={`${unfeasibleErrorCount} lote(s) não foi possível programar por falta de rota/capacidade`}>
                    ⚠️ Sem Rota: -{unfeasibleVolumeLiters.toLocaleString('pt-BR')} L
                  </span>
                ) : (
                  <span className="text-[9px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200/60 px-1.5 py-0.5 rounded ml-1">
                    ✓ 100%
                  </span>
                )}

                {/* Trash button for surgical deletion of this product in this month */}
                {onDeleteCampaignBatches && (monthBatchesCount > 0 || (activeMonth === null && totalAccumulatedBatchesCount > 0)) && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      const targetM = activeMonth !== null ? activeMonth : 'all';
                      const mText = activeMonthLabel ? `no mês de ${activeMonthLabel}` : 'em toda a safra';
                      const bCount = activeMonth !== null ? monthBatchesCount : totalAccumulatedBatchesCount;
                      const volText = (activeMonth !== null ? monthVolumeLiters : totalAccumulatedVolumeLiters).toLocaleString('pt-BR');
                      if (confirm(`Tem certeza que deseja excluir os ${bCount} lote(s) (${volText} L) do produto ${recipe.name} ${mText}?`)) {
                        onDeleteCampaignBatches(recipe.id, targetM);
                      }
                    }}
                    className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-100/80 rounded-md transition-colors cursor-pointer ml-1 shrink-0"
                    title={activeMonthLabel ? `Excluir lotes de ${recipe.name} no mês de ${activeMonthLabel}` : `Excluir todos os lotes de ${recipe.name}`}
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {/* Right: Total Summary */}
        <div className="flex items-center gap-3 font-mono text-xs shrink-0 ml-auto">
          {activeMonthLabel && (
            <span className="text-indigo-700 font-medium bg-indigo-50 border border-indigo-200/60 px-2 py-1 rounded-lg text-[11px]">
              {activeMonthLabel}: <strong className="font-extrabold">{totalMonthVolumeAll.toLocaleString('pt-BR')} L</strong>
            </span>
          )}
          <span className="text-slate-500 font-medium">
            Total Acumulado: <strong className="text-slate-900 font-extrabold text-sm">{totalAccumulatedVolumeAll.toLocaleString('pt-BR')} L</strong>
          </span>
          {totalUnfeasibleVolumeAll > 0 && (
            <span className="text-rose-700 font-bold bg-rose-50 border border-rose-200 px-2 py-1 rounded-lg text-[11px]">
              ⚠️ Não Programado: {totalUnfeasibleVolumeAll.toLocaleString('pt-BR')} L
            </span>
          )}
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

          {/* Scale Filters & Row Customization */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[9px] font-black uppercase text-slate-400 tracking-wider flex items-center gap-1 mr-1">
              <Eye size={12} /> Ajustar Equipamentos / Escalas:
            </span>
            {Array.from(new Set([
              'Erlenmeyer', 'Balão', '100L', '500L', '3000_5000L', 'Envase',
              ...fullAssetsList.map(a => a.scaleType)
            ])).map((scale) => {
              const active = visibleScales[scale] !== false;
              let label = scale === '3000_5000L' ? 'Tanques 5kL' : scale === 'Envase' ? 'Envase' : scale;

              let scaleBadgeColor = active ? 'bg-indigo-900 text-indigo-100 border-indigo-800' : 'bg-slate-100 text-slate-400 border-slate-200';
              if (scale === 'Erlenmeyer') scaleBadgeColor = active ? 'bg-teal-900 text-teal-100 border-teal-850' : 'bg-slate-100 text-slate-400 border-slate-200';
              else if (scale === 'Balão') scaleBadgeColor = active ? 'bg-sky-900 text-sky-100 border-sky-850' : 'bg-slate-100 text-slate-400 border-slate-200';
              else if (scale === '100L') scaleBadgeColor = active ? 'bg-orange-950 text-orange-100 border-orange-850' : 'bg-slate-100 text-slate-400 border-slate-200';
              else if (scale === '500L') scaleBadgeColor = active ? 'bg-amber-900 text-amber-100 border-amber-850' : 'bg-slate-100 text-slate-400 border-slate-200';
              else if (scale === '3000_5000L') scaleBadgeColor = active ? 'bg-purple-900 text-purple-100 border-purple-800' : 'bg-slate-100 text-slate-400 border-slate-200';
              else if (scale === 'Envase') scaleBadgeColor = active ? 'bg-rose-900 text-rose-100 border-rose-800' : 'bg-slate-100 text-slate-400 border-slate-200';

              return (
                <div key={scale} className="flex items-center rounded-lg border border-slate-300 overflow-hidden shadow-2xs">
                  <button
                    type="button"
                    onClick={() => setVisibleScales(prev => ({ ...prev, [scale]: visibleScales[scale] === false ? true : false }))}
                    className={`px-2.5 py-1 text-[10px] font-extrabold transition-all cursor-pointer flex items-center gap-1 ${scaleBadgeColor}`}
                    title={`Clique para alternar visibilidade da escala ${scale}`}
                  >
                    <span>{label}</span>
                  </button>
                </div>
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
                {(Object.entries(weeksMap) as [string, { weekNum: number; days: Date[] }][]).map(([key, value]) => {
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
                const normRowAssetId = normalizeAssetId(asset.id, envaseLinesCount);
                return (
                  <div
                    key={asset.id}
                    id={`gantt-asset-row-${normRowAssetId}`}
                    className="h-12 relative flex items-center z-0 group hover:bg-indigo-50/20 transition-colors cursor-crosshair"
                    onClick={(e) => {
                      if ((e.target as HTMLElement).closest('button')) return;

                      const rect = e.currentTarget.getBoundingClientRect();
                      const clickX = e.clientX - rect.left;
                      const clickedHoursFromStart = clickX / hourWidth;
                      const clickedMs = timelineStart.getTime() + clickedHoursFromStart * 60 * 60 * 1000;
                      const clickedDate = new Date(clickedMs);
                      clickedDate.setMinutes(clickedDate.getMinutes() >= 30 ? 30 : 0, 0, 0);

                      const defaultRecipe = recipes[0]?.id || '';
                      setQuickScheduleData({
                        asset,
                        clickedDate,
                        recipeId: defaultRecipe,
                        anchorMode: 'clicked_asset',
                        opNumber: `OP-${Math.floor(1000 + Math.random() * 9000)}`
                      });
                    }}
                    title={`Clique no espaço em branco para agendar um lote em ${asset.name}`}
                  >
                    
                    {/* PREVENTIVE BLOCKS */}
                    {preventatives
                      .filter(p => isAssetMatch(p.assetId, asset.id, envaseLinesCount))
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
                        .filter(({ step }) => isAssetMatch(step.assetId, asset.id, envaseLinesCount))
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
                              normalizeAssetId(p.assetId, envaseLinesCount) === normalizeAssetId(asset.id, envaseLinesCount) && 
                              start.getTime() < new Date(p.endDateTime).getTime() && 
                              new Date(p.startDateTime).getTime() < e1Setup
                            );

                            const hasBatchOverlap = batches.some(b => 
                              b.id !== batch.id && 
                              b.steps.some(st => {
                                if (normalizeAssetId(st.assetId, envaseLinesCount) !== normalizeAssetId(asset.id, envaseLinesCount)) return false;
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

                            const isHighlightedMatch = highlightedBatchId === batch.id && highlightedStepIndex === stepIdx;

                            const calculatedBgClass = isStepContaminated
                              ? 'bg-slate-700 border-slate-900 text-slate-300'
                              : isStepColliding
                              ? 'bg-rose-600 border-rose-800 text-white animate-pulse'
                              : `${recipeColorOb.bg} ${recipeColorOb.border} text-white`;

                            const highlightEffectClass = isHighlightedMatch
                              ? 'ring-4 ring-red-500 border-2 border-red-600 shadow-2xl scale-105 z-40 animate-pulse'
                              : 'hover:shadow hover:-translate-y-0.5 z-10';

                            const extraStyles: React.CSSProperties = {};
                            if (isStepContaminated) {
                              extraStyles.backgroundImage = 'repeating-linear-gradient(45deg, #334155, #334155 8px, #475569 8px, #475569 16px)';
                            }

                            const startTimeFormatted = `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}h`;
                            const stepStartFull = formatFullDate(step.startDateTime);
                            const stepEndFull = formatFullDate(step.endDateTime);

                            blocks.push(
                              <button
                                key={`${batch.id}-${stepIdx}`}
                                id={`gantt-step-block-${batch.id}-${stepIdx}`}
                                onClick={() => setSelectedBlock({ 
                                  type: 'batch-step', 
                                  batch, 
                                  product: recipe, 
                                  stepIndex: stepIdx,
                                  asset
                                })}
                                title={`Lote ${batch.lotNumber} - ${recipe?.name || 'Bio-Lote'}\nEtapa: ${step.scaleType}\nInício (${stepIdx === 0 ? 'Inoculação' : 'Etapa'}): ${stepStartFull}\nPrevisão Término: ${stepEndFull}`}
                                className={`absolute h-[38px] rounded border shadow-2xs transition-all text-left px-2 py-1 flex flex-col justify-center cursor-pointer overflow-visible ${calculatedBgClass} ${highlightEffectClass}`}
                                style={{
                                  left: `${leftPx}px`,
                                  width: `${widthPx}px`,
                                  ...extraStyles
                                }}
                              >
                                {/* CÍRCULO VERMELHO PULSANTE DE ALTA VISIBILIDADE NA ORDEM ENCONTRADA */}
                                {isHighlightedMatch && (
                                  <div className="absolute -top-3 -right-2.5 z-50 pointer-events-none flex items-center justify-center">
                                    <span className="relative flex h-6 w-6 items-center justify-center">
                                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75"></span>
                                      <span className="relative inline-flex rounded-full h-6 w-6 bg-red-600 border-2 border-white text-white items-center justify-center shadow-2xl font-black text-[10px]">
                                        🔴
                                      </span>
                                    </span>
                                  </div>
                                )}

                                <div className="flex items-center justify-between w-full gap-1">
                                  <span className="font-black text-[9px] tracking-tight leading-none font-mono truncate">
                                    [{step.durationHours}h] {batch.lotNumber} <span className="text-amber-300 font-extrabold ml-0.5">• {startTimeFormatted}</span>
                                  </span>
                                  {isHighlightedMatch ? (
                                    <span className="text-[8px] bg-red-600 text-white font-mono font-black px-1.5 py-0.2 rounded-full flex items-center gap-0.5 shadow-md animate-pulse shrink-0 border border-white">
                                      🔴 ENCONTRADO
                                    </span>
                                  ) : isStepContaminated ? (
                                    <span className="text-[8px] bg-slate-950 text-rose-450 rounded font-bold px-1 select-none font-mono shrink-0">
                                      🚫 CONTAMINADO
                                    </span>
                                  ) : isStepColliding ? (
                                    <span className="text-[8px] bg-yellow-400 text-slate-950 rounded font-bold px-1 select-none font-mono shrink-0" title="COLISÃO DE CRONOGRAMA POR ATRASO!">
                                      ⚠️ COLISÃO ATRASO
                                    </span>
                                  ) : displayConflict ? (
                                    <span className="text-[9px] bg-rose-600 text-white rounded font-bold px-1 py-0.2 select-none shrink-0" title="CONFLITO DE AGENDAMENTO!">
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
                      {isEditingLotNumber ? (
                        <div className="flex items-center gap-1 mt-1">
                          <input
                            type="text"
                            value={editedLotNumber}
                            onChange={(e) => setEditedLotNumber(e.target.value)}
                            className="px-2 py-1 bg-white border border-indigo-400 rounded font-mono font-bold text-xs text-slate-900 w-full focus:outline-hidden focus:ring-1 focus:ring-indigo-500"
                            placeholder="Nova OP/Lote"
                            autoFocus
                          />
                          <button
                            type="button"
                            onClick={handleSaveLotNumber}
                            className="px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-[10px] font-bold transition-colors cursor-pointer shrink-0 flex items-center gap-0.5"
                            title="Salvar novo número da OP"
                          >
                            <Check size={12} /> Salvar
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-sm font-bold text-slate-800 font-mono">{selectedBlock.batch.lotNumber}</span>
                          <button
                            type="button"
                            onClick={() => {
                              setEditedLotNumber(selectedBlock.batch!.lotNumber);
                              setIsEditingLotNumber(true);
                            }}
                            className="p-1 text-slate-400 hover:text-indigo-650 hover:bg-indigo-50 rounded transition-colors cursor-pointer"
                            title="Editar número da Ordem de Produção (OP)"
                          >
                            <Edit3 size={13} />
                          </button>
                        </div>
                      )}
                    </div>
                    <div>
                      <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest block">Fórmula Ativa & Volume do Lote</span>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="text-sm font-bold text-slate-800">{selectedBlock.product?.name}</span>
                        <span className="text-xs font-mono font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded" title="Volume real gerado determinado pela capacidade do reator alocado">
                          {getBatchYield(selectedBlock.batch, selectedBlock.product, envaseLinesCount).toLocaleString('pt-BR')} L
                        </span>
                      </div>
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
                            className={`flex flex-col gap-1 p-2 rounded text-[10px] ${
                              isCurrent 
                                ? 'bg-slate-900 text-white font-bold shadow-xs' 
                                : 'bg-slate-50 text-slate-700 border border-slate-200'
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-mono font-bold">Estágio {i + 1}: {st.scaleType}</span>
                              <span className="font-bold">{assetName} ({st.durationHours}h)</span>
                            </div>
                            <div className="flex flex-wrap items-center justify-between font-mono text-[9px] border-t border-slate-200/40 pt-1 mt-0.5 gap-2">
                              <span className={isCurrent ? "text-amber-300 font-extrabold" : "text-indigo-600 font-bold"}>
                                OP Etapa: <strong>{st.opNumber || `${selectedBlock.batch.lotNumber}-${st.scaleType}`}</strong>
                              </span>
                              {st.parentOpNumber && (
                                <span className={isCurrent ? "text-emerald-300 font-medium" : "text-slate-500 font-medium"} title="Ordem da etapa anterior consumida/empenhada nesta escala">
                                  🔗 Consumiu: {st.parentOpNumber}
                                </span>
                              )}
                            </div>
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
                                ? 'bg-rose-600 text-white border-rose-700 shadow-sm' 
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
                              <input 
                                type="text"
                                list="suggested-reasons-delay"
                                value={deviationReason}
                                onChange={(e) => setDeviationReason(e.target.value)}
                                placeholder="Digite ou selecione o motivo do desvio..."
                                className="w-full mt-1 px-3 py-1.5 bg-white border border-slate-300 rounded font-semibold text-slate-700 focus:outline-hidden focus:ring-1 focus:ring-amber-500 focus:border-amber-500"
                              />
                              <datalist id="suggested-reasons-delay">
                                {delaySuggestions.map((sug, idx) => (
                                  <option key={idx} value={sug} />
                                ))}
                              </datalist>
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
                              <input 
                                type="text"
                                list="suggested-reasons-swap"
                                value={deviationReason}
                                onChange={(e) => setDeviationReason(e.target.value)}
                                placeholder="Digite ou selecione o motivo da troca de ativo..."
                                className="w-full mt-1 px-3 py-1.5 bg-white border border-slate-300 rounded font-semibold text-slate-700 focus:outline-hidden focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
                              />
                              <datalist id="suggested-reasons-swap">
                                {swapSuggestions.map((sug, idx) => (
                                  <option key={idx} value={sug} />
                                ))}
                              </datalist>
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
                              <input 
                                type="text"
                                list="suggested-reasons-contamination"
                                value={deviationReason}
                                onChange={(e) => setDeviationReason(e.target.value)}
                                placeholder="Digite ou selecione a causa..."
                                className="w-full mt-1 px-3 py-1.5 bg-white border border-slate-300 rounded font-semibold text-slate-700 focus:outline-hidden focus:ring-1 focus:ring-rose-500 focus:border-rose-500"
                              />
                              <datalist id="suggested-reasons-contamination">
                                {contaminationSuggestions.map((sug, idx) => (
                                  <option key={idx} value={sug} />
                                ))}
                              </datalist>
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
                              className="w-full bg-rose-600 hover:bg-rose-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold py-2 rounded-lg text-xs transition-colors cursor-pointer"
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

      {/* QUICK SCHEDULE MODAL ON TIMELINE CLICK */}
      {quickScheduleData && (() => {
        const recipe = recipes.find(r => r.id === quickScheduleData.recipeId) || recipes[0];
        if (!recipe) return null;

        let anchorTargetDate = quickScheduleData.customStartStr 
          ? new Date(quickScheduleData.customStartStr) 
          : quickScheduleData.clickedDate;

        let inoculationStartDate: Date;
        if (quickScheduleData.anchorMode === 'inoculation') {
          inoculationStartDate = anchorTargetDate;
        } else if (quickScheduleData.anchorMode === 'envase') {
          inoculationStartDate = getInoculationDateForAnchoredScale(recipe, 'Envase', anchorTargetDate, 0);
        } else {
          inoculationStartDate = getInoculationDateForAnchoredScale(recipe, quickScheduleData.asset.scaleType, anchorTargetDate, 0);
        }

        const pad = (n: number) => String(n).padStart(2, '0');
        const inoculationIsoStr = `${inoculationStartDate.getFullYear()}-${pad(inoculationStartDate.getMonth() + 1)}-${pad(inoculationStartDate.getDate())}T${pad(inoculationStartDate.getHours())}:${pad(inoculationStartDate.getMinutes())}`;

        const previewSteps = calculateProductionTimeline(recipe, inoculationIsoStr, 0, batches, preventatives, undefined, undefined, setupTimes, envaseLinesCount);

        const handleConfirmSchedule = () => {
          const newBatchId = `batch-${Date.now()}`;
          const newBatchNumber = quickScheduleData.opNumber.trim() || `OP-${Math.floor(1000 + Math.random() * 9000)}`;

          const stepsWithOps = assignStepOpNumbers(previewSteps, newBatchNumber);

          const newBatch: Batch = {
            id: newBatchId,
            productId: recipe.id,
            lotNumber: newBatchNumber,
            startDateTime: previewSteps[0].startDateTime,
            transferIntervalHours: 0,
            steps: stepsWithOps
          };

          onUpdateBatches([...batches, newBatch]);
          setQuickScheduleData(null);
        };

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-fade-in">
            <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-xl w-full overflow-hidden flex flex-col max-h-[90vh]">
              {/* Header */}
              <div className="bg-slate-900 text-white p-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-2 bg-indigo-600 rounded-lg text-white">
                    <Sparkles size={18} />
                  </div>
                  <div>
                    <h3 className="font-extrabold text-sm tracking-tight flex items-center gap-1.5">
                      Programar Lote a partir do Gantt
                    </h3>
                    <span className="text-[10px] text-slate-400 font-mono">
                      Vaso Selecionado: <strong className="text-amber-300 font-bold">{quickScheduleData.asset.name}</strong> ({quickScheduleData.asset.scaleType})
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setQuickScheduleData(null)}
                  className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Body */}
              <div className="p-5 space-y-4 overflow-y-auto text-xs text-slate-700">
                {/* Product Selection */}
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
                    Selecione a Fórmula / Produto
                  </label>
                  <select
                    value={quickScheduleData.recipeId}
                    onChange={(e) => setQuickScheduleData(prev => prev ? { ...prev, recipeId: e.target.value } : null)}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl font-bold text-slate-800 focus:ring-2 focus:ring-indigo-500 cursor-pointer"
                  >
                    {recipes.map(r => (
                      <option key={r.id} value={r.id}>
                        {r.name} (Rendimento: {r.yieldPerBatch.toLocaleString('pt-BR')} L)
                      </option>
                    ))}
                  </select>
                </div>

                {/* OP Number input */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
                      Número da Ordem (OP)
                    </label>
                    <input
                      type="text"
                      value={quickScheduleData.opNumber}
                      onChange={(e) => setQuickScheduleData(prev => prev ? { ...prev, opNumber: e.target.value } : null)}
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl font-mono font-bold text-slate-900 focus:ring-2 focus:ring-indigo-500"
                      placeholder="ex: OP-9040"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
                      Data/Hora Clicada
                    </label>
                    <input
                      type="datetime-local"
                      value={quickScheduleData.customStartStr || formatToDateTimeInput(quickScheduleData.clickedDate)}
                      onChange={(e) => setQuickScheduleData(prev => prev ? { ...prev, customStartStr: e.target.value } : null)}
                      className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-xl font-mono font-bold text-slate-800 text-[11px]"
                    />
                  </div>
                </div>

                {/* Anchor Mode Options */}
                <div className="space-y-1.5 bg-slate-50 p-3.5 rounded-xl border border-slate-200">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
                    Modo de Encaixe e Calibração da Cascata
                  </label>
                  <div className="space-y-2 pt-1">
                    <label className="flex items-center gap-2 cursor-pointer font-semibold text-slate-800 text-[11px]">
                      <input
                        type="radio"
                        name="anchorMode"
                        checked={quickScheduleData.anchorMode === 'clicked_asset'}
                        onChange={() => setQuickScheduleData(prev => prev ? { ...prev, anchorMode: 'clicked_asset' } : null)}
                        className="text-indigo-600 focus:ring-indigo-500"
                      />
                      <span>
                        Ancorar etapa no vaso clicado (<strong className="text-indigo-700">{quickScheduleData.asset.name}</strong>)
                      </span>
                    </label>

                    <label className="flex items-center gap-2 cursor-pointer font-semibold text-slate-800 text-[11px]">
                      <input
                        type="radio"
                        name="anchorMode"
                        checked={quickScheduleData.anchorMode === 'inoculation'}
                        onChange={() => setQuickScheduleData(prev => prev ? { ...prev, anchorMode: 'inoculation' } : null)}
                        className="text-indigo-600 focus:ring-indigo-500"
                      />
                      <span>
                        Iniciar Inoculação (Erlenmeyer) neste horário
                      </span>
                    </label>

                    <label className="flex items-center gap-2 cursor-pointer font-semibold text-slate-800 text-[11px]">
                      <input
                        type="radio"
                        name="anchorMode"
                        checked={quickScheduleData.anchorMode === 'envase'}
                        onChange={() => setQuickScheduleData(prev => prev ? { ...prev, anchorMode: 'envase' } : null)}
                        className="text-indigo-600 focus:ring-indigo-500"
                      />
                      <span>
                        Concluir/Iniciar Envase neste horário (Cálculo Regressivo)
                      </span>
                    </label>
                  </div>
                </div>

                {/* Live Cascade Preview */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1">
                      <Clock size={12} /> Prévia da Rota em Cascata ({previewSteps.length} Estágios)
                    </span>
                    <span className="text-[10px] font-mono text-indigo-700 font-bold bg-indigo-50 px-2 py-0.5 rounded">
                      Inoculação: {formatShortDate(previewSteps[0].startDateTime)}
                    </span>
                  </div>

                  <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                    {previewSteps.map((st, idx) => {
                      const isAnchoredStep = st.scaleType === quickScheduleData.asset.scaleType && quickScheduleData.anchorMode === 'clicked_asset';
                      const assetName = assetsList.find(a => a.id === normalizeAssetId(st.assetId, envaseLinesCount))?.name || 'Automático';

                      return (
                        <div
                          key={idx}
                          className={`p-2 rounded-lg text-[10px] flex items-center justify-between font-mono ${
                            isAnchoredStep
                              ? 'bg-indigo-900 text-white font-extrabold shadow-sm ring-1 ring-indigo-400'
                              : 'bg-slate-50 border border-slate-200 text-slate-700'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <span className="font-bold">{st.scaleType}</span>
                            {isAnchoredStep && (
                              <span className="bg-amber-400 text-slate-950 text-[8px] font-black uppercase px-1 rounded">
                                📍 Vaso Clicado
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-3">
                            <span>{assetName}</span>
                            <span className={isAnchoredStep ? 'text-amber-200' : 'text-slate-500'}>
                              {formatShortDate(st.startDateTime)} ➔ {formatShortDate(st.endDateTime)} ({st.durationHours}h)
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setQuickScheduleData(null)}
                  className="px-4 py-2 text-slate-600 font-semibold hover:bg-slate-200 rounded-xl transition-colors cursor-pointer"
                >
                  Cancelar
                </button>

                <button
                  type="button"
                  onClick={handleConfirmSchedule}
                  className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-xs shadow-md transition-all cursor-pointer flex items-center gap-1.5 hover:scale-[1.02] active:scale-[0.98]"
                >
                  <Sparkles size={15} /> 🚀 Confirmar e Encaixar Lote no Gantt
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* CROP SEASONS MULTI-YEAR COMPARISON MODAL */}
      {showCropSeasonsModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4" id="crop-seasons-modal">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-2xl w-full overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <BarChart3 size={20} className="text-indigo-400" />
                <h3 className="font-bold text-base">Comparativo Plurianual de Safras (Histórico & Futuro)</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowCropSeasonsModal(false)}
                className="text-slate-400 hover:text-white p-1 rounded transition-colors cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <p className="text-xs text-slate-600 font-medium">
                Consolidado histórico de volume total produzido e quantidade de lotes sequenciados em cada Safra Industrial:
              </p>

              <div className="space-y-3">
                {availableYears.map(yr => {
                  const yearBatches = batches.filter(b => {
                    const mainStep = b.steps.find(s => s.scaleType === 'Envase') || b.steps[0];
                    if (!mainStep) return false;
                    const d = new Date(mainStep.startDateTime);
                    return d.getFullYear() === yr;
                  });

                  const isCurrent = yr === now.getFullYear();
                  const isPast = yr < now.getFullYear();
                  const totalVol = yearBatches.reduce((acc, b) => {
                    const rec = recipes.find(r => r.id === b.productId);
                    return acc + getBatchYield(b, rec, customAssets || envaseLinesCount);
                  }, 0);

                  return (
                    <div key={yr} className={`p-4 rounded-xl border flex items-center justify-between transition-all ${
                      isCurrent
                        ? 'bg-indigo-50/70 border-indigo-300 shadow-2xs'
                        : isPast
                        ? 'bg-slate-50 border-slate-200'
                        : 'bg-emerald-50/50 border-emerald-200'
                    }`}>
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-sm font-mono text-slate-800">Safra {yr}</span>
                          {isCurrent && (
                            <span className="px-2 py-0.5 bg-indigo-600 text-white rounded text-[10px] font-bold">🟢 Safra Ativa</span>
                          )}
                          {isPast && (
                            <span className="px-2 py-0.5 bg-slate-200 text-slate-700 rounded text-[10px] font-bold">🔒 Encerrada</span>
                          )}
                          {!isCurrent && !isPast && (
                            <span className="px-2 py-0.5 bg-emerald-600 text-white rounded text-[10px] font-bold">🔮 Futura</span>
                          )}
                        </div>
                        <span className="text-xs font-medium text-slate-500">
                          {yearBatches.length} lote(s) programados
                        </span>
                      </div>

                      <div className="text-right font-mono">
                        <span className="text-base font-extrabold text-slate-900 block">
                          {totalVol.toLocaleString('pt-BR')} L
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            handleSelectYear(yr);
                            setShowCropSeasonsModal(false);
                          }}
                          className="text-[11px] font-bold text-indigo-600 hover:text-indigo-900 hover:underline cursor-pointer"
                        >
                          Abrir Safra no Gantt &rarr;
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="p-4 bg-slate-50 border-t border-slate-200 flex justify-end">
              <button
                type="button"
                onClick={() => setShowCropSeasonsModal(false)}
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-bold transition-colors cursor-pointer"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default React.memo(GanttTimeline);
