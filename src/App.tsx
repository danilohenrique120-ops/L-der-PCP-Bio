/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { ProductRecipe, Batch, Preventative, COLOR_OPTIONS, ScaleType, ShiftConfig, PlanningErrorLog, Shift, DeviationLog } from './types';
import { INITIAL_RECIPES, INITIAL_PREVENTATIVES, getInitialBatches } from './data/mockData';
import { areIntervalsOverlapping, generateAutomaticPlanning, calculateProductionTimeline, formatFullDate, findBestStartTimes, StartTimeSuggestion, ProductSuggestionDetail, getInoculationDateFromEnvaseStart } from './utils/timeline';
import GanttTimeline from './components/GanttTimeline';
import { User, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "firebase/auth";
import { collection, getDocs, doc, setDoc, getDoc, deleteDoc } from "firebase/firestore";
import { auth, getTenantDb } from "./firebase";
import BatchForm from './components/BatchForm';
import ProductForm from './components/ProductForm';
import PreventativeForm from './components/PreventativeForm';
import IndustrialAssetsManager from './components/IndustrialAssetsManager';
import { AlertTriangle, Calendar, PlayCircle, Layers, ShieldX, HelpCircle, AlertOctagon, CheckCircle, BarChart3, Database, RefreshCw, XCircle, Trash2, Clock, CalendarDays, Sliders, ChevronUp, ChevronDown, X } from 'lucide-react';
import { getAssetsPool, normalizeAssetId, FactoryScaleCounts, DEFAULT_SCALE_COUNTS, Asset } from './types';

export default function App() {
  // Tabs: 'gantt' | 'batch' | 'product' | 'preventatives' | 'deviations'
  const [activeTab, setActiveTab] = useState<'gantt' | 'batch' | 'product' | 'preventatives' | 'deviations'>('gantt');

  // Core application states loaded from Firestore multi-tenant configs
  const [recipes, setRecipes] = useState<ProductRecipe[]>([]);
  const [batches, setBatches] = useState<Batch[]>(() => {
    const saved = localStorage.getItem('pcp_batches');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      } catch (e) {}
    }
    return getInitialBatches();
  });

  useEffect(() => {
    if (batches.length > 0) {
      localStorage.setItem('pcp_batches', JSON.stringify(batches));
    }
  }, [batches]);
  const [preventatives, setPreventatives] = useState<Preventative[]>([]);
  const [deviations, setDeviations] = useState<DeviationLog[]>([]);
  const [scaleCounts, setScaleCounts] = useState<FactoryScaleCounts>(() => {
    const saved = localStorage.getItem('pcp_scale_counts');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object') return { ...DEFAULT_SCALE_COUNTS, ...parsed };
      } catch (e) {}
    }
    return DEFAULT_SCALE_COUNTS;
  });

  const [envaseLinesCount, setEnvaseLinesCount] = useState<number>(3);

  useEffect(() => {
    localStorage.setItem('pcp_scale_counts', JSON.stringify(scaleCounts));
    setEnvaseLinesCount(scaleCounts.envaseCount);
  }, [scaleCounts]);

  const handleUpdateScaleCount = (scale: keyof FactoryScaleCounts, delta: number) => {
    setScaleCounts(prev => {
      const current = prev[scale] || 0;
      const nextVal = Math.max(0, Math.min(30, current + delta));
      return { ...prev, [scale]: nextVal };
    });
  };

  const [customAssets, setCustomAssets] = useState<Asset[]>(() => {
    const saved = localStorage.getItem('pcp_custom_assets');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      } catch (e) {}
    }
    return getAssetsPool(scaleCounts);
  });

  useEffect(() => {
    localStorage.setItem('pcp_custom_assets', JSON.stringify(customAssets));
  }, [customAssets]);

  const handleUpdateAsset = (id: string, name: string, capacityLiters?: number) => {
    setCustomAssets(prev => prev.map(a => a.id === id ? { ...a, name, capacityLiters: capacityLiters !== undefined ? capacityLiters : a.capacityLiters } : a));
  };

  const handleAddAsset = (scaleType: ScaleType, name?: string, capacityLiters?: number) => {
    setCustomAssets(prev => {
      const scaleItems = prev.filter(a => a.scaleType === scaleType);
      const nextIdx = scaleItems.length + 1;
      let newId = `${scaleType.toLowerCase()}-custom-${Date.now()}`;
      let defaultCap = capacityLiters;

      if (scaleType === '3000_5000L') {
        newId = `B${10 + nextIdx + 5}`;
        defaultCap = defaultCap || 5000;
      } else if (scaleType === '500L') {
        newId = `B${String(5 + nextIdx).padStart(2, '0')}`;
        defaultCap = defaultCap || 500;
      } else if (scaleType === '100L') {
        newId = `B${String(nextIdx).padStart(2, '0')}`;
        defaultCap = defaultCap || 100;
      } else if (scaleType === 'Envase') {
        newId = `envase-m${nextIdx}`;
      }

      const defaultName = name || (scaleType === 'Envase' ? `Envase - Máquina ${nextIdx}` : scaleType === 'Erlenmeyer' ? `Erlen - Rota ${nextIdx - 1}` : scaleType === 'Balão' ? `Balão - Rota ${nextIdx}` : `${newId} (${defaultCap ? `${defaultCap / 1000}kL` : 'Novo'})`);

      const newAsset: Asset = {
        id: newId,
        name: defaultName,
        scaleType,
        categoryLabel: scaleType === 'Envase' ? 'Linha de Envase' : scaleType === '3000_5000L' ? 'Tanques 3000L/5000L' : `Escala ${scaleType}`,
        capacityLiters: defaultCap
      };

      return [...prev, newAsset];
    });
  };

  const handleDeleteAsset = (id: string) => {
    setCustomAssets(prev => prev.filter(a => a.id !== id));
  };

  const handleResetAssets = () => {
    const defaultPool = getAssetsPool(scaleCounts);
    setCustomAssets(defaultPool);
    localStorage.removeItem('pcp_custom_assets');
  };

  const [setupTimes, setSetupTimes] = useState<Record<ScaleType, number>>({
    'Erlenmeyer': 0,
    'Balão': 0,
    '100L': 4,
    '500L': 6,
    '3000_5000L': 8,
    'Envase': 4
  });
  const [shiftConfig, setShiftConfig] = useState<ShiftConfig>({
    shifts: [
      { id: 'sh-1', name: '1º Turno (Seg a Sex)', startHour: '06:00', endHour: '14:00', workDays: [1, 2, 3, 4, 5] },
      { id: 'sh-2', name: '1º Turno (Ter a Sáb)', startHour: '06:00', endHour: '14:00', workDays: [2, 3, 4, 5, 6] },
      { id: 'sh-3', name: '2º Turno (Seg a Sex)', startHour: '14:00', endHour: '22:00', workDays: [1, 2, 3, 4, 5] }
    ]
  });
  const [planningErrors, setPlanningErrors] = useState<PlanningErrorLog[]>([]);
  const [planningModeTab, setPlanningModeTab] = useState<'single' | 'mix'>('single');
  const [mixConfig, setMixConfig] = useState<Record<string, { enabled: boolean; volume: number; priority: number }>>({});
  
  const [pendingShiftBypassModalData, setPendingShiftBypassModalData] = useState<{
    outOfShiftBatches: Batch[];
    errors: PlanningErrorLog[];
  } | null>(null);

  const [showConfigPanels, setShowConfigPanels] = useState<boolean>(() => {
    const saved = localStorage.getItem('pcp_show_config_panels');
    return saved !== null ? saved === 'true' : true;
  });

  // Authentication states
  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [loading, setLoading] = useState(false);
  const [databaseId, setDatabaseId] = useState('');
  const [isDataLoaded, setIsDataLoaded] = useState(false);

  // Start Time Optimization states
  const [showAnalyseModal, setShowAnalyseModal] = useState<boolean>(false);
  const [isAnalysing, setIsAnalysing] = useState<boolean>(false);
  const [analyseResults, setAnalyseResults] = useState<StartTimeSuggestion[]>([]);
  const [analyseMetaVolume, setAnalyseMetaVolume] = useState<number>(0);
  const [restrictToMonth, setRestrictToMonth] = useState<boolean>(false);
  const [useLeadTimePlanning, setUseLeadTimePlanning] = useState<boolean>(false);
  const [hasRunAnalysis, setHasRunAnalysis] = useState<boolean>(false);
  const [analyseProgress, setAnalyseProgress] = useState<number>(0);

  // OP Naming Strategy States
  const [opNamingMode, setOpNamingMode] = useState<'auto' | 'prefix' | 'custom_list'>('auto');
  const [opPrefixInput, setOpPrefixInput] = useState<string>('');
  const [customOpListInput, setCustomOpListInput] = useState<string>('');



  useEffect(() => {
    localStorage.setItem('pcp_show_config_panels', String(showConfigPanels));
  }, [showConfigPanels]);

  // Multi-shift management handlers
  const handleUpdateShift = (id: string, updatedFields: Partial<Shift>) => {
    setShiftConfig(prev => {
      const updatedShifts = prev.shifts.map(sh => (sh.id === id ? { ...sh, ...updatedFields } : sh));
      return { shifts: updatedShifts };
    });
  };

  const handleAddShift = () => {
    const newId = 'sh-' + Date.now();
    const newShift = {
      id: newId,
      name: `Turno ${shiftConfig.shifts.length + 1}`,
      startHour: '08:00',
      endHour: '16:00',
      workDays: [1, 2, 3, 4, 5]
    };
    setShiftConfig(prev => ({ shifts: [...prev.shifts, newShift] }));
  };

  const handleDeleteShift = (id: string) => {
    if (shiftConfig.shifts.length <= 1) {
      alert('Atenção: Mantenha pelo menos um turno configurado para operação.');
      return;
    }
    setShiftConfig(prev => ({ shifts: prev.shifts.filter(sh => sh.id !== id) }));
  };



  // Planner trigger inputs
  const [targetVolume, setTargetVolume] = useState<number>(15000);
  const [plannerRecipeId, setPlannerRecipeId] = useState<string>('');
  const [plannerStart, setPlannerStart] = useState<string>('2026-06-01T08:00');

  // Auth state listener on mounting
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        setLoading(true);
        try {
          const tokenResult = await currentUser.getIdTokenResult(true);
          const dbId = tokenResult.claims.databaseId;
          
          if (!dbId || typeof dbId !== 'string') {
            setAuthError("Acesso não autorizado: Conta não vinculada a uma indústria válida");
            await signOut(auth);
            setUser(null);
            setDatabaseId('');
            setIsDataLoaded(false);
          } else {
            setDatabaseId(dbId);
            setUser(currentUser);
            setAuthError('');
            
            // Initialize Firestore and Load Data!
            const tenantDb = getTenantDb(dbId);
            await fetchTenantData(tenantDb);
          }
        } catch (e: any) {
          console.error("Erro ao ler token do Firebase Auth:", e);
          setAuthError("Erro na autenticação. Tente novamente.");
          setUser(null);
          setDatabaseId('');
        } finally {
          setLoading(false);
        }
      } else {
        setUser(null);
        setDatabaseId('');
        setIsDataLoaded(false);
      }
    });
    return () => unsubscribe();
  }, []);

  const fetchTenantData = async (tenantDb: any) => {
    try {
      // 1. Recipes
      const recipesSnapshot = await getDocs(collection(tenantDb, "recipes"));
      const recipesList = recipesSnapshot.docs.map(d => ({ id: d.id, ...d.data() } as ProductRecipe));
      if (recipesList.length === 0) {
        for (const r of INITIAL_RECIPES) {
          await setDoc(doc(tenantDb, "recipes", r.id), r);
        }
        setRecipes(INITIAL_RECIPES);
      } else {
        setRecipes(recipesList);
      }

      // 2. Preventatives
      const prevSnapshot = await getDocs(collection(tenantDb, "preventatives"));
      const prevList = prevSnapshot.docs.map(d => ({ id: d.id, ...d.data() } as Preventative));
      if (prevList.length === 0) {
        for (const p of INITIAL_PREVENTATIVES) {
          await setDoc(doc(tenantDb, "preventatives", p.id), p);
        }
        setPreventatives(INITIAL_PREVENTATIVES);
      } else {
        setPreventatives(prevList);
      }

      // 3. Batches
      const batchesSnapshot = await getDocs(collection(tenantDb, "batches"));
      const batchesList = batchesSnapshot.docs.map(d => ({ id: d.id, ...d.data() } as Batch));
      if (batchesList.length === 0) {
        const savedLocal = localStorage.getItem('pcp_batches');
        let initialBatches = getInitialBatches();
        if (savedLocal) {
          try {
            const parsed = JSON.parse(savedLocal);
            if (Array.isArray(parsed) && parsed.length > 0) initialBatches = parsed;
          } catch (e) {}
        }
        for (const b of initialBatches) {
          await setDoc(doc(tenantDb, "batches", b.id), b);
        }
        setBatches(initialBatches);
        localStorage.setItem('pcp_batches', JSON.stringify(initialBatches));
      } else {
        setBatches(batchesList);
        localStorage.setItem('pcp_batches', JSON.stringify(batchesList));
      }

      // 4. Deviations
      const devSnapshot = await getDocs(collection(tenantDb, "deviations"));
      const devList = devSnapshot.docs.map(d => ({ id: d.id, ...d.data() } as DeviationLog));
      setDeviations(devList);

      // 5. Configs
      const configDoc = await getDoc(doc(tenantDb, "configs", "settings"));
      if (configDoc.exists()) {
        const data = configDoc.data();
        if (data.shiftConfig) setShiftConfig(data.shiftConfig);
        if (data.setupTimes) setSetupTimes(data.setupTimes);
        if (data.envaseLinesCount !== undefined) setEnvaseLinesCount(data.envaseLinesCount);
      } else {
        const defaultSettings = {
          shiftConfig: {
            shifts: [
              { id: 'sh-1', name: '1º Turno (Seg a Sex)', startHour: '06:00', endHour: '14:00', workDays: [1, 2, 3, 4, 5] },
              { id: 'sh-2', name: '1º Turno (Ter a Sáb)', startHour: '06:00', endHour: '14:00', workDays: [2, 3, 4, 5, 6] },
              { id: 'sh-3', name: '2º Turno (Seg a Sex)', startHour: '14:00', endHour: '22:00', workDays: [1, 2, 3, 4, 5] }
            ]
          },
          setupTimes: {
            'Erlenmeyer': 0,
            'Balão': 0,
            '100L': 4,
            '500L': 6,
            '3000_5000L': 8,
            'Envase': 4
          },
          envaseLinesCount: 3
        };
        await setDoc(doc(tenantDb, "configs", "settings"), defaultSettings);
        setShiftConfig(defaultSettings.shiftConfig);
        setSetupTimes(defaultSettings.setupTimes);
        setEnvaseLinesCount(defaultSettings.envaseLinesCount);
      }

      // 6. Capacity parameters
      setIsDataLoaded(true);
    } catch (err) {
      console.error("Erro ao carregar dados do tenant do Firestore:", err);
    }
  };

  // Login execution handler
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setAuthError('');
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err: any) {
      console.error("Erro no login:", err);
      if (err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        setAuthError("E-mail ou senha incorretos.");
      } else {
        setAuthError(err.message || "Erro de login.");
      }
      setLoading(false);
    }
  };

  // Logout handler
  const handleLogout = async () => {
    setLoading(true);
    try {
      await signOut(auth);
      setUser(null);
      setDatabaseId('');
      setIsDataLoaded(false);
      setRecipes([]);
      setBatches([]);
      setPreventatives([]);
      setDeviations([]);
    } catch (e) {
      console.error("Erro no logout:", e);
    } finally {
      setLoading(false);
    }
  };

  // Update default planner recipe when recipes list loads
  useEffect(() => {
    if (recipes.length > 0 && !plannerRecipeId) {
      setPlannerRecipeId(recipes[0].id);
    }
  }, [recipes, plannerRecipeId]);

  useEffect(() => {
    if (recipes.length > 0) {
      setMixConfig(prev => {
        const next = { ...prev };
        recipes.forEach((r, idx) => {
          if (!next[r.id]) {
            next[r.id] = {
              enabled: false,
              volume: r.yieldPerBatch * 3,
              priority: idx + 1
            };
          }
        });
        return next;
      });
    }
  }, [recipes]);

  // Sync general settings to Firestore whenever they change
  useEffect(() => {
    if (isDataLoaded && databaseId) {
      const saveConfig = async () => {
        try {
          await setDoc(doc(getTenantDb(), "configs", "settings"), {
            shiftConfig,
            setupTimes,
            envaseLinesCount
          });
        } catch (e) {
          console.error("Erro ao salvar configs no Firestore:", e);
        }
      };
      saveConfig();
    }
  }, [shiftConfig, setupTimes, envaseLinesCount, isDataLoaded, databaseId]);

  // Handle addition & deletion triggers synced to Firestore
  const handleSaveRecipe = async (updatedRecipe: ProductRecipe) => {
    setRecipes(prev => {
      const idx = prev.findIndex(r => r.id === updatedRecipe.id);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = updatedRecipe;
        return copy;
      } else {
        return [...prev, updatedRecipe];
      }
    });
    if (databaseId) {
      try {
        await setDoc(doc(getTenantDb(), "recipes", updatedRecipe.id), updatedRecipe);
      } catch (err) {
        console.error("Erro ao salvar receita no Firestore:", err);
      }
    }
  };

  const handleDeleteRecipe = async (id: string) => {
    setRecipes(prev => prev.filter(r => r.id !== id));
    setBatches(prev => prev.filter(b => b.productId !== id));
    if (databaseId) {
      try {
        const db = getTenantDb();
        await deleteDoc(doc(db, "recipes", id));
        const batchesSnapshot = await getDocs(collection(db, "batches"));
        for (const docSnap of batchesSnapshot.docs) {
          const b = docSnap.data();
          if (b.productId === id) {
            await deleteDoc(doc(db, "batches", docSnap.id));
          }
        }
      } catch (err) {
        console.error("Erro ao deletar receita no Firestore:", err);
      }
    }
  };



  const handleAddBatch = async (newBatch: Batch) => {
    setBatches(prev => [newBatch, ...prev]);
    setActiveTab('gantt');
    if (databaseId) {
      try {
        await setDoc(doc(getTenantDb(), "batches", newBatch.id), newBatch);
      } catch (err) {
        console.error("Erro ao adicionar lote no Firestore:", err);
      }
    }
  };

  const handleDeleteBatch = async (id: string) => {
    setBatches(prev => prev.filter(b => b.id !== id));
    if (databaseId) {
      try {
        await deleteDoc(doc(getTenantDb(), "batches", id));
      } catch (err) {
        console.error("Erro ao deletar lote no Firestore:", err);
      }
    }
  };

  const handleAddPreventative = async (newPrev: Preventative) => {
    setPreventatives(prev => [...prev, newPrev]);
    if (databaseId) {
      try {
        await setDoc(doc(getTenantDb(), "preventatives", newPrev.id), newPrev);
      } catch (err) {
        console.error("Erro ao adicionar preventiva no Firestore:", err);
      }
    }
  };

  const handleDeletePreventative = async (id: string) => {
    setPreventatives(prev => prev.filter(p => p.id !== id));
    if (databaseId) {
      try {
        await deleteDoc(doc(getTenantDb(), "preventatives", id));
      } catch (err) {
        console.error("Erro ao deletar preventiva no Firestore:", err);
      }
    }
  };

  const handleClearAllBatches = async () => {
    if (confirm('Atenção: Deseja deletar COMPLETAMENTE todos os lotes do cronograma corrente para uma replanificação do zero?')) {
      setBatches([]);
      setPlanningErrors([]);
      if (databaseId) {
        try {
          const db = getTenantDb();
          const batchesSnapshot = await getDocs(collection(db, "batches"));
          for (const docSnap of batchesSnapshot.docs) {
            await deleteDoc(doc(db, "batches", docSnap.id));
          }
        } catch (err) {
          console.error("Erro ao limpar lotes no Firestore:", err);
        }
      }
    }
  };

  const handleClearAllData = async () => {
    if (confirm('Atenção: Isso restaurará todos os dados originais do PCP no servidor da nuvem. Deseja continuar?')) {
      if (confirm('Você tem certeza absoluta? Essa ação não pode ser desfeita e irá sobrescrever os dados ativos da fábrica.')) {
        setRecipes(INITIAL_RECIPES);
        setPreventatives(INITIAL_PREVENTATIVES);
        setBatches(getInitialBatches());
        setDeviations([]);
        setEnvaseLinesCount(3);
        setSetupTimes({
          'Erlenmeyer': 0,
          'Balão': 0,
          '100L': 4,
          '500L': 6,
          '3000_5000L': 8,
          'Envase': 4
        });
        setShiftConfig({
          shifts: [
            { id: 'sh-1', name: '1º Turno (Seg a Sex)', startHour: '06:00', endHour: '14:00', workDays: [1, 2, 3, 4, 5] },
            { id: 'sh-2', name: '1º Turno (Ter a Sáb)', startHour: '06:00', endHour: '14:00', workDays: [2, 3, 4, 5, 6] },
            { id: 'sh-3', name: '2º Turno (Seg a Sex)', startHour: '14:00', endHour: '22:00', workDays: [1, 2, 3, 4, 5] }
          ]
        });
        setPlanningErrors([]);
        setActiveTab('gantt');

        if (databaseId) {
          try {
            const db = getTenantDb();
            const recipesSnapshot = await getDocs(collection(db, "recipes"));
            for (const d of recipesSnapshot.docs) await deleteDoc(doc(db, "recipes", d.id));
            for (const r of INITIAL_RECIPES) await setDoc(doc(db, "recipes", r.id), r);

            const prevSnapshot = await getDocs(collection(db, "preventatives"));
            for (const d of prevSnapshot.docs) await deleteDoc(doc(db, "preventatives", d.id));
            for (const p of INITIAL_PREVENTATIVES) await setDoc(doc(db, "preventatives", p.id), p);

            const batchesSnapshot = await getDocs(collection(db, "batches"));
            for (const d of batchesSnapshot.docs) await deleteDoc(doc(db, "batches", d.id));
            const initialBatches = getInitialBatches();
            for (const b of initialBatches) await setDoc(doc(db, "batches", b.id), b);

            const devSnapshot = await getDocs(collection(db, "deviations"));
            for (const d of devSnapshot.docs) await deleteDoc(doc(db, "deviations", d.id));

            await setDoc(doc(db, "configs", "settings"), {
              shiftConfig: {
                shifts: [
                  { id: 'sh-1', name: '1º Turno (Seg a Sex)', startHour: '06:00', endHour: '14:00', workDays: [1, 2, 3, 4, 5] },
                  { id: 'sh-2', name: '1º Turno (Ter a Sáb)', startHour: '06:00', endHour: '14:00', workDays: [2, 3, 4, 5, 6] },
                  { id: 'sh-3', name: '2º Turno (Seg a Sex)', startHour: '14:00', endHour: '22:00', workDays: [1, 2, 3, 4, 5] }
                ]
              },
              setupTimes: {
                'Erlenmeyer': 0,
                'Balão': 0,
                '100L': 4,
                '500L': 6,
                '3000_5000L': 8,
                'Envase': 4
              },
              envaseLinesCount: 3
            });
          } catch (err) {
            console.error("Erro ao resetar fábrica no Firestore:", err);
          }
        }
      }
    }
  };

  const handleAutoPlan = async (e: React.FormEvent) => {
    e.preventDefault();
    setPlanningErrors([]);

    const recipe = recipes.find(r => r.id === plannerRecipeId);
    if (!recipe) {
      alert('Por favor, selecione uma receita de produto válida.');
      return;
    }

    if (targetVolume <= 0) {
      alert('Insira uma meta de volume maior que zero.');
      return;
    }

    let adjustedStart = plannerStart;
    if (useLeadTimePlanning) {
      const preferredEnvaseStart = new Date(plannerStart);
      const inoculationDate = getInoculationDateFromEnvaseStart(recipe, preferredEnvaseStart, 0);
      const pad = (n: number) => String(n).padStart(2, '0');
      adjustedStart = `${inoculationDate.getFullYear()}-${pad(inoculationDate.getMonth() + 1)}-${pad(inoculationDate.getDate())}T${pad(inoculationDate.getHours())}:${pad(inoculationDate.getMinutes())}`;
    }

    let customOps: string[] | undefined = undefined;
    if (opNamingMode === 'custom_list' && customOpListInput.trim()) {
      customOps = customOpListInput.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean);
    }
    const prefix = opNamingMode === 'prefix' ? opPrefixInput : undefined;

    const result = generateAutomaticPlanning(
      recipe,
      targetVolume,
      adjustedStart,
      batches,
      preventatives,
      shiftConfig,
      setupTimes,
      envaseLinesCount,
      customOps,
      prefix
    );

    let inShiftToSave = result.scheduledBatches;
    let outOfShiftToSave = result.outOfShiftBatches;
    let errorsToSave = result.errors;

    if (useLeadTimePlanning) {
      const targetDate = new Date(plannerStart);
      const monthIndex = targetDate.getMonth();
      const year = targetDate.getFullYear();
      const targetMonthStartMs = new Date(year, monthIndex, 1, 0, 0, 0).getTime();
      const targetMonthEndMs = new Date(year, monthIndex + 1, 0, 23, 59, 59).getTime();

      const filterByMonth = (batchList: Batch[]) => batchList.filter(b => {
        const envaseStep = b.steps.find(s => s.scaleType === 'Envase');
        if (!envaseStep) return false;
        const envaseStartMs = new Date(envaseStep.startDateTime).getTime();
        const envaseEndMs = new Date(envaseStep.endDateTime).getTime();
        return envaseEndMs >= targetMonthStartMs && envaseStartMs <= targetMonthEndMs;
      });

      inShiftToSave = filterByMonth(result.scheduledBatches);
      outOfShiftToSave = filterByMonth(result.outOfShiftBatches);

      errorsToSave = result.errors.filter(err => {
        if (!err.startDateTime) return true;
        const errStartMs = new Date(err.startDateTime).getTime();
        return errStartMs >= targetMonthStartMs && errStartMs <= targetMonthEndMs;
      });
    }

    if (inShiftToSave.length > 0) {
      setBatches(prev => [...prev, ...inShiftToSave]);
      if (databaseId) {
        try {
          const db = getTenantDb();
          for (const b of inShiftToSave) {
            await setDoc(doc(db, "batches", b.id), b);
          }
        } catch (err) {
          console.error("Erro ao salvar lotes automáticos no Firestore:", err);
        }
      }
    }

    if (outOfShiftToSave.length > 0) {
      setPendingShiftBypassModalData({
        outOfShiftBatches: outOfShiftToSave,
        errors: errorsToSave
      });
    }

    if (errorsToSave.length > 0) {
      setPlanningErrors(errorsToSave);
    } else {
      setPlanningErrors([]);
    }

    const targetMonthIdx = new Date(plannerStart).getMonth();
    localStorage.setItem('pcp_gantt_active_month', String(targetMonthIdx));
  };

  const handleAutoPlanMix = async (e: React.FormEvent) => {
    e.preventDefault();
    setPlanningErrors([]);

    const selectedItems = Object.entries(mixConfig)
      .map(([productId, cfg]) => {
        const config = cfg as { enabled: boolean; volume: number; priority: number };
        return {
          productId,
          enabled: config?.enabled || false,
          volume: config?.volume || 0,
          priority: config?.priority || 1
        };
      })
      .filter(item => item.enabled && item.volume > 0);

    if (selectedItems.length === 0) {
      alert('Selecione pelo menos um produto do mix com volume maior que zero.');
      return;
    }

    const sortedItems = [...selectedItems].sort((a, b) => a.priority - b.priority);

    let activePool = [...batches];
    let allInShiftBatches: Batch[] = [];
    let allOutOfShiftBatches: Batch[] = [];
    let allErrors: PlanningErrorLog[] = [];

    let adjustedStart = plannerStart;
    if (useLeadTimePlanning && sortedItems.length > 0) {
      const firstRecipe = recipes.find(r => r.id === sortedItems[0].productId);
      if (firstRecipe) {
        const preferredEnvaseStart = new Date(plannerStart);
        const inoculationDate = getInoculationDateFromEnvaseStart(firstRecipe, preferredEnvaseStart, 0);
        const pad = (n: number) => String(n).padStart(2, '0');
        adjustedStart = `${inoculationDate.getFullYear()}-${pad(inoculationDate.getMonth() + 1)}-${pad(inoculationDate.getDate())}T${pad(inoculationDate.getHours())}:${pad(inoculationDate.getMinutes())}`;
      }
    }

    let currentCampaignStart = adjustedStart;

    let customOpsList: string[] = [];
    if (opNamingMode === 'custom_list' && customOpListInput.trim()) {
      customOpsList = customOpListInput.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean);
    }
    const globalPrefix = opNamingMode === 'prefix' ? opPrefixInput : undefined;

    let globalBatchOffset = 0;

    sortedItems.forEach((mixItem) => {
      const recipe = recipes.find(r => r.id === mixItem.productId);
      if (!recipe) return;

      const batchesNeededForThisProduct = Math.ceil(mixItem.volume / recipe.yieldPerBatch);

      let productCustomOps: string[] | undefined = undefined;
      if (opNamingMode === 'custom_list' && customOpsList.length > 0) {
        productCustomOps = customOpsList.slice(globalBatchOffset, globalBatchOffset + batchesNeededForThisProduct);
      }

      let productPrefix: string | undefined = undefined;
      if (opNamingMode === 'prefix' && globalPrefix && globalPrefix.trim()) {
        const cleanPrefix = globalPrefix.trim();
        const matchNumber = cleanPrefix.match(/^(.*?)(\d+)$/);
        if (matchNumber) {
          const prefixText = matchNumber[1];
          const startNum = parseInt(matchNumber[2], 10) + globalBatchOffset;
          const padLen = matchNumber[2].length;
          productPrefix = `${prefixText}${String(startNum).padStart(padLen, '0')}`;
        } else {
          productPrefix = `${cleanPrefix}-${globalBatchOffset + 1}`;
        }
      }

      const result = generateAutomaticPlanning(
        recipe,
        mixItem.volume,
        currentCampaignStart,
        activePool,
        preventatives,
        shiftConfig,
        setupTimes,
        envaseLinesCount,
        productCustomOps,
        productPrefix
      );

      const totalScheduledForThisProduct = result.scheduledBatches.length + result.outOfShiftBatches.length;
      globalBatchOffset += totalScheduledForThisProduct > 0 ? totalScheduledForThisProduct : batchesNeededForThisProduct;

      let inShiftToSave = result.scheduledBatches;
      let outOfShiftToSave = result.outOfShiftBatches;

      if (useLeadTimePlanning) {
        const targetDate = new Date(plannerStart);
        const monthIndex = targetDate.getMonth();
        const year = targetDate.getFullYear();
        const targetMonthStartMs = new Date(year, monthIndex, 1, 0, 0, 0).getTime();
        const targetMonthEndMs = new Date(year, monthIndex + 1, 0, 23, 59, 59).getTime();

        const filterByMonth = (batchList: Batch[]) => batchList.filter(b => {
          const envaseStep = b.steps.find(s => s.scaleType === 'Envase');
          if (!envaseStep) return false;
          const envaseStartMs = new Date(envaseStep.startDateTime).getTime();
          const envaseEndMs = new Date(envaseStep.endDateTime).getTime();
          return envaseEndMs >= targetMonthStartMs && envaseStartMs <= targetMonthEndMs;
        });

        inShiftToSave = filterByMonth(result.scheduledBatches);
        outOfShiftToSave = filterByMonth(result.outOfShiftBatches);

        const filteredErrors = result.errors.filter(err => {
          if (!err.startDateTime) return true;
          const errStartMs = new Date(err.startDateTime).getTime();
          return errStartMs >= targetMonthStartMs && errStartMs <= targetMonthEndMs;
        });
        allErrors.push(...filteredErrors);
      } else {
        if (result.errors.length > 0) {
          allErrors.push(...result.errors);
        }
      }

      if (inShiftToSave.length > 0) {
        allInShiftBatches.push(...inShiftToSave);
        activePool.push(...inShiftToSave);
      }

      if (outOfShiftToSave.length > 0) {
        allOutOfShiftBatches.push(...outOfShiftToSave);
        activePool.push(...outOfShiftToSave);
      }

      const allResBatches = [...result.scheduledBatches, ...result.outOfShiftBatches];
      if (allResBatches.length > 0) {
        // Set search start for the next product in the mix to start immediately after the last batch's inoculation
        // eliminating the 6-7 day lag caused by waiting for the final Envase step to end!
        const lastScheduledBatch = allResBatches[allResBatches.length - 1];
        const nextStartMs = new Date(lastScheduledBatch.startDateTime).getTime() + 60 * 60 * 1000;
        const pad = (n: number) => String(n).padStart(2, '0');
        const d = new Date(nextStartMs);
        currentCampaignStart = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
      }
    });

    if (allInShiftBatches.length > 0) {
      setBatches(prev => [...prev, ...allInShiftBatches]);
      if (databaseId) {
        try {
          const db = getTenantDb();
          for (const b of allInShiftBatches) {
            await setDoc(doc(db, "batches", b.id), b);
          }
        } catch (err) {
          console.error("Erro ao salvar lotes do mix no Firestore:", err);
        }
      }
    }

    if (allOutOfShiftBatches.length > 0) {
      setPendingShiftBypassModalData({
        outOfShiftBatches: allOutOfShiftBatches,
        errors: allErrors
      });
    }

    if (allErrors.length > 0) {
      setPlanningErrors(allErrors);
    } else {
      setPlanningErrors([]);
    }

    const targetMonthIdx = new Date(plannerStart).getMonth();
    localStorage.setItem('pcp_gantt_active_month', String(targetMonthIdx));
  };

  const handleBypassErrorScheduling = async (err: PlanningErrorLog) => {
    const recipe = recipes.find(r => r.id === err.productId);
    if (!recipe) {
      alert('Produto associado não encontrado.');
      return;
    }

    try {
      const candidateSteps = calculateProductionTimeline(
        recipe,
        err.startDateTime,
        0,
        batches,
        preventatives,
        undefined,
        undefined,
        setupTimes,
        envaseLinesCount
      );

      const newBatch: Batch = {
        id: `bypass-batch-${recipe.id}-${Date.now()}`,
        lotNumber: err.lotNumber,
        productId: recipe.id,
        startDateTime: err.startDateTime,
        transferIntervalHours: 0,
        steps: candidateSteps
      };

      setBatches(prev => [newBatch, ...prev]);
      setPlanningErrors(prev => prev.filter(e => e.id !== err.id));

      if (databaseId) {
        try {
          await setDoc(doc(getTenantDb(), "batches", newBatch.id), newBatch);
        } catch (e: any) {
          console.error("Erro ao salvar lote autorizado no Firestore:", e);
        }
      }
    } catch (e: any) {
      alert(`Falha no sequenciamento físico: ${e.message || 'Colisão de recursos em reatores.'}`);
    }
  };

  const handleAddDeviationLog = async (log: DeviationLog) => {
    setDeviations(prev => [log, ...prev]);
    if (databaseId) {
      try {
        await setDoc(doc(getTenantDb(), "deviations", log.id), log);
      } catch (e) {
        console.error("Erro ao salvar desvio no Firestore:", e);
      }
    }
  };

  const handleUpdateBatches = async (updatedBatches: Batch[]) => {
    setBatches(updatedBatches);
    if (databaseId) {
      try {
        const db = getTenantDb();
        for (const b of updatedBatches) {
          await setDoc(doc(db, "batches", b.id), b);
        }
      } catch (e) {
        console.error("Erro ao atualizar lotes no Firestore:", e);
      }
    }
  };

  const handleDeleteCampaignBatches = async (productId: string | 'all', monthIndex: number | 'all') => {
    const batchesToDelete = batches.filter(b => {
      if (productId !== 'all' && b.productId !== productId) return false;

      if (monthIndex !== 'all') {
        const envaseStep = b.steps.find(s => s.scaleType === 'Envase') || b.steps[b.steps.length - 1];
        if (!envaseStep) return false;
        const d = new Date(envaseStep.startDateTime);
        if (d.getMonth() !== monthIndex) return false;
      }

      return true;
    });

    if (batchesToDelete.length === 0) {
      alert('Nenhum lote encontrado para os critérios selecionados.');
      return;
    }

    const idsToDelete = new Set(batchesToDelete.map(b => b.id));

    // Remove from local state
    setBatches(prev => prev.filter(b => !idsToDelete.has(b.id)));

    // Remove from Firestore if DB connected
    if (databaseId) {
      try {
        const db = getTenantDb();
        for (const b of batchesToDelete) {
          await deleteDoc(doc(db, "batches", b.id));
        }
      } catch (err) {
        console.error("Erro ao excluir lotes do Firestore:", err);
      }
    }
  };

  const performAnalysis = async (restrictValue: boolean) => {
    let items: { recipe: ProductRecipe; targetVolume: number }[] = [];
    
    if (planningModeTab === 'single') {
      const recipe = recipes.find(r => r.id === plannerRecipeId);
      if (!recipe) return;
      if (targetVolume <= 0) return;
      items.push({ recipe, targetVolume });
    } else {
      const selectedItems = Object.entries(mixConfig)
        .map(([productId, cfg]) => {
          const config = cfg as { enabled: boolean; volume: number; priority: number };
          return {
            productId,
            enabled: config?.enabled || false,
            volume: config?.volume || 0,
            priority: config?.priority || 1
          };
        })
        .filter(item => item.enabled && item.volume > 0)
        .sort((a, b) => a.priority - b.priority);

      selectedItems.forEach(item => {
        const recipe = recipes.find(r => r.id === item.productId);
        if (recipe) items.push({ recipe, targetVolume: item.volume });
      });
    }

    setIsAnalysing(true);
    setAnalyseResults([]);
    setAnalyseProgress(0);

    // Yield control once to let loading UI display
    await new Promise(r => setTimeout(r, 50));

    try {
      const startDate = new Date(plannerStart);
      const year = startDate.getFullYear();
      const monthIndex = startDate.getMonth();

      const targetMonthStartMs = new Date(year, monthIndex, 1, 0, 0, 0).getTime();
      const targetMonthEndMs = new Date(year, monthIndex + 1, 0, 23, 59, 59).getTime();
      
      let leadTimeHours = 0;
      if (items.length > 0) {
        const recipe = items[0].recipe;
        for (let i = 0; i < recipe.steps.length - 1; i++) {
          leadTimeHours += recipe.steps[i].durationHours;
        }
        leadTimeHours += (recipe.steps.length - 2) * 2; // buffer transfer
      }
      if (leadTimeHours <= 0) leadTimeHours = 96;

      const sweepStartMs = restrictValue 
        ? targetMonthStartMs - leadTimeHours * 60 * 60 * 1000 
        : targetMonthStartMs;

      const testPoints: Date[] = [];
      let currentTest = new Date(sweepStartMs);
      currentTest.setMinutes(0, 0, 0);
      if (currentTest.getHours() % 4 !== 0) {
        currentTest.setHours(currentTest.getHours() + (4 - (currentTest.getHours() % 4)));
      }

      while (currentTest.getTime() <= targetMonthEndMs) {
        testPoints.push(new Date(currentTest.getTime()));
        currentTest.setHours(currentTest.getHours() + 4);
      }

      const formatLocal = (d: Date): string => {
        const pad = (n: number) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
      };

      const suggestions: StartTimeSuggestion[] = [];
      const chunkSize = 25; // Process 25 points per chunk for ultra-fast performance
      
      for (let i = 0; i < testPoints.length; i += chunkSize) {
        const chunk = testPoints.slice(i, i + chunkSize);
        
        for (const point of chunk) {
          const startStr = formatLocal(point);
          let activePool = [...batches];
          let totalVolumeScheduled = 0;
          let totalBatchesScheduled = 0;
          let totalErrors: PlanningErrorLog[] = [];
          let maxEndMs = new Date(startStr).getTime();
          const productDetails: ProductSuggestionDetail[] = [];
          
          let currentCampaignStart = startStr;
          
          for (const item of items) {
            const result = generateAutomaticPlanning(
              item.recipe,
              item.targetVolume,
              currentCampaignStart,
              activePool,
              preventatives,
              shiftConfig,
              setupTimes,
              envaseLinesCount
            );
            
            let batchesToCount = result.scheduledBatches;
            if (restrictValue) {
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
                 return !restrictValue || (errStartMs >= targetMonthStartMs && errStartMs <= targetMonthEndMs);
               });
               totalErrors.push(...filteredErrors);
            }

            const allResBatches = [...result.scheduledBatches, ...result.outOfShiftBatches];
            if (allResBatches.length > 0) {
               const lastScheduledBatch = allResBatches[allResBatches.length - 1];
               const nextStartMs = new Date(lastScheduledBatch.startDateTime).getTime() + 60 * 60 * 1000;
               currentCampaignStart = formatLocal(new Date(nextStartMs));
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

        // Update progress
        const progressPercent = Math.round((Math.min(i + chunkSize, testPoints.length) / testPoints.length) * 100);
        setAnalyseProgress(progressPercent);

        // Yield execution to prevent "Page Unresponsive" dialog
        await new Promise(r => setTimeout(r, 0));
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

      setAnalyseResults(uniqueSuggestions);
    } catch (err) {
      console.error("Erro na varredura de início do PCP:", err);
    } finally {
      setIsAnalysing(false);
    }
  };

  const handleAnalyseBestStart = () => {
    let items: { recipe: ProductRecipe; targetVolume: number }[] = [];
    
    if (planningModeTab === 'single') {
      const recipe = recipes.find(r => r.id === plannerRecipeId);
      if (!recipe) {
        alert('Por favor, selecione uma receita de produto válida.');
        return;
      }
      if (targetVolume <= 0) {
        alert('Insira uma meta de volume maior que zero.');
        return;
      }
      items.push({ recipe, targetVolume });
      setAnalyseMetaVolume(targetVolume);
    } else {
      const selectedItems = Object.entries(mixConfig)
        .map(([productId, cfg]) => {
          const config = cfg as { enabled: boolean; volume: number; priority: number };
          return {
            productId,
            enabled: config?.enabled || false,
            volume: config?.volume || 0,
            priority: config?.priority || 1
          };
        })
        .filter(item => item.enabled && item.volume > 0);

      if (selectedItems.length === 0) {
        alert('Selecione pelo menos um produto do mix com volume maior que zero.');
        return;
      }

      let mixTotalVolume = 0;
      selectedItems.forEach(item => {
        mixTotalVolume += item.volume;
      });
      setAnalyseMetaVolume(mixTotalVolume);
    }

    setAnalyseResults([]);
    setHasRunAnalysis(false);
    setAnalyseProgress(0);
    setShowAnalyseModal(true);
  };

  const handleToggleRestrict = (checked: boolean) => {
    setRestrictToMonth(checked);
    setHasRunAnalysis(false);
    setAnalyseResults([]);
  };

  const handleApplySuggestion = async (sug: StartTimeSuggestion) => {
    setPlannerStart(sug.startDateTime);
    setShowAnalyseModal(false);

    let items: { recipe: ProductRecipe; targetVolume: number }[] = [];
    if (planningModeTab === 'single') {
      const recipe = recipes.find(r => r.id === plannerRecipeId);
      if (recipe) items.push({ recipe, targetVolume });
    } else {
      const selectedItems = Object.entries(mixConfig)
        .map(([productId, cfg]) => {
          const config = cfg as { enabled: boolean; volume: number; priority: number };
          return {
            productId,
            enabled: config?.enabled || false,
            volume: config?.volume || 0,
            priority: config?.priority || 1
          };
        })
        .filter(item => item.enabled && item.volume > 0)
        .sort((a, b) => a.priority - b.priority);

      selectedItems.forEach(item => {
        const recipe = recipes.find(r => r.id === item.productId);
        if (recipe) items.push({ recipe, targetVolume: item.volume });
      });
    }

    let activePool = [...batches];
    let allNewBatches: Batch[] = [];
    let allErrors: PlanningErrorLog[] = [];

    const targetDate = new Date(plannerStart);
    const monthIndex = targetDate.getMonth();
    const year = targetDate.getFullYear();
    const targetMonthStartMs = new Date(year, monthIndex, 1, 0, 0, 0).getTime();
    const targetMonthEndMs = new Date(year, monthIndex + 1, 0, 23, 59, 59).getTime();

    let currentCampaignStart = sug.startDateTime;

    items.forEach(item => {
      const result = generateAutomaticPlanning(
        item.recipe,
        item.targetVolume,
        currentCampaignStart,
        activePool,
        preventatives,
        shiftConfig,
        setupTimes,
        envaseLinesCount
      );

      let batchesToSave = result.scheduledBatches;
      if (restrictToMonth) {
        batchesToSave = result.scheduledBatches.filter(b => {
          const envaseStep = b.steps.find(s => s.scaleType === 'Envase');
          if (!envaseStep) return false;
          const envaseStartMs = new Date(envaseStep.startDateTime).getTime();
          return envaseStartMs >= targetMonthStartMs && envaseStartMs <= targetMonthEndMs;
        });
      }

      if (batchesToSave.length > 0) {
        allNewBatches.push(...batchesToSave);
        activePool.push(...batchesToSave);
      }
      
      if (result.errors.length > 0) {
        const filteredErrors = result.errors.filter(err => {
          if (!err.startDateTime) return true;
          const errStartMs = new Date(err.startDateTime).getTime();
          return !restrictToMonth || (errStartMs >= targetMonthStartMs && errStartMs <= targetMonthEndMs);
        });
        allErrors.push(...filteredErrors);
      }

      const allResBatches = [...result.scheduledBatches, ...result.outOfShiftBatches];
      if (allResBatches.length > 0) {
        const lastScheduledBatch = allResBatches[allResBatches.length - 1];
        const nextStartMs = new Date(lastScheduledBatch.startDateTime).getTime() + 60 * 60 * 1000;
        const pad = (n: number) => String(n).padStart(2, '0');
        const d = new Date(nextStartMs);
        currentCampaignStart = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
      }
    });

    if (allNewBatches.length > 0) {
      setBatches(prev => [...prev, ...allNewBatches]);
      if (databaseId) {
        try {
          const db = getTenantDb();
          for (const b of allNewBatches) {
            await setDoc(doc(db, "batches", b.id), b);
          }
        } catch (err) {
          console.error("Erro ao salvar lotes no Firestore:", err);
        }
      }
    }

    if (allErrors.length > 0) {
      setPlanningErrors(allErrors);
    } else {
      setPlanningErrors([]);
    }

    setActiveTab('gantt');
    alert(`Planejamento gerado com sucesso para início em ${formatFullDate(sug.startDateTime)}!`);
  };

  // real-time analysis KPIs
  const totalBatchesCount = batches.length;
  const preventativesCount = preventatives.length;
  const formulasCount = recipes.length;

  // Calculate conflicting batches in active timeline taking setups and envaser counts into account
  let conflictBatchesCount = 0;
  batches.forEach(b => {
    let hasBatchConflict = false;
    for (const step of b.steps) {
      const stepSetup = setupTimes[step.scaleType] || 0;
      const end1Setup = new Date(step.endDateTime).getTime() + stepSetup * 60 * 60 * 1000;
      const start1 = new Date(step.startDateTime).getTime();
      const normAssetId = normalizeAssetId(step.assetId, envaseLinesCount);

      // Look for overlaps on other batches
      const overlapsWithBatch = batches.some(ob => 
        ob.id !== b.id && 
        ob.steps.some(ost => {
          if (normalizeAssetId(ost.assetId, envaseLinesCount) !== normAssetId) return false;
          const ostSetup = setupTimes[ost.scaleType] || 0;
          const ostEndSetup = new Date(ost.endDateTime).getTime() + ostSetup * 60 * 60 * 1000;
          const ostStart = new Date(ost.startDateTime).getTime();
          return start1 < ostEndSetup && ostStart < end1Setup;
        })
      );

      // Look for overlap with preventives
      const overlapsWithPrev = preventatives.some(p => {
        if (normalizeAssetId(p.assetId, envaseLinesCount) !== normAssetId) return false;
        const pStart = new Date(p.startDateTime).getTime();
        const pEnd = new Date(p.endDateTime).getTime();
        return start1 < pEnd && pStart < end1Setup;
      });

      if (overlapsWithBatch || overlapsWithPrev) {
        hasBatchConflict = true;
        break;
      }
    }
    if (hasBatchConflict) conflictBatchesCount++;
  });

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4 antialiased" id="login-root">
        <div className="w-full max-w-md bg-slate-800/80 border border-slate-707/60 rounded-3xl p-8 shadow-2xl backdrop-blur-md space-y-6">
          <div className="text-center space-y-2">
            <div className="w-14 h-14 rounded-2xl bg-amber-500 flex items-center justify-center font-bold text-slate-950 text-2xl tracking-tight shadow mx-auto mb-4 animate-pulse">
              𝝗
            </div>
            <span className="text-[10px] font-black uppercase tracking-widest text-amber-500 block leading-none">
              Líder PCP Bio - Enterprise
            </span>
            <h2 className="text-xl font-extrabold text-white tracking-tight">
              Acesso ao Sistema
            </h2>
            <p className="text-xs text-slate-400">
              Entre com suas credenciais para sincronizar seu cronograma de fábrica.
            </p>
          </div>

          {authError && (
            <div className="bg-rose-500/10 border border-rose-500/30 text-rose-300 rounded-xl p-3 text-xs flex items-start gap-2 animate-fadeIn">
              <AlertOctagon size={16} className="shrink-0 text-rose-400 mt-0.5" />
              <span>{authError}</span>
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">E-mail Corporativo</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="nome@empresa.com"
                className="w-full px-4 py-2.5 bg-slate-900 border border-slate-700 hover:border-slate-600 focus:ring-2 focus:ring-indigo-500 focus:border-transparent focus:outline-none rounded-xl text-xs font-semibold text-white transition-all placeholder:text-slate-500"
                required
                disabled={loading}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">Senha de Acesso</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-4 py-2.5 bg-slate-900 border border-slate-700 hover:border-slate-600 focus:ring-2 focus:ring-indigo-500 focus:border-transparent focus:outline-none rounded-xl text-xs font-semibold text-white transition-all placeholder:text-slate-500"
                required
                disabled={loading}
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-700 text-white font-bold text-xs rounded-xl shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-2 cursor-pointer mt-2"
            >
              {loading ? (
                <>
                  <RefreshCw className="animate-spin text-white" size={14} /> Carregando...
                </>
              ) : (
                "Acessar Sistema"
              )}
            </button>
          </form>

          <div className="text-center pt-2">
            <p className="text-[10px] text-slate-500 font-medium">
              Protegido por Criptografia de Ponta a Ponta Firebase & TLS 1.3
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 font-sans text-slate-800 antialiased flex flex-col" id="app-root">
      
      {/* PROFESSIONAL INDUSTRIAL DASHBOARD HEADER */}
      <header className="bg-slate-900 border-b border-slate-800 shrink-0 shadow-lg text-white">
        <div className="w-full px-4 py-4 md:px-6 flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500 flex items-center justify-center font-bold text-slate-950 text-xl tracking-tight shadow">
              𝝗
            </div>
            <div>
              <span className="text-[10px] font-black uppercase tracking-widest text-amber-500 block leading-none">
                Líder PCP Bio - Enterprise
              </span>
              <h1 className="text-lg font-extrabold tracking-tight">
                Sequenciador de Multiplicação Bacteriana
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2">

            <span className="text-xs bg-slate-800 text-slate-400 border border-slate-700 px-3 py-1.5 rounded-lg font-mono">
              FÁBRICA: <span className="text-amber-400 font-bold uppercase">{databaseId}</span>
            </span>
            <button
              onClick={handleLogout}
              className="px-3 py-1.5 bg-rose-950/60 hover:bg-rose-900/60 border border-rose-800/80 text-rose-200 hover:text-white rounded-lg text-xs font-semibold transition-colors flex items-center gap-1 cursor-pointer"
              title="Sair do Sistema"
            >
              <XCircle size={13} /> Sair
            </button>
          </div>
        </div>
      </header>

      {/* KPI METRIC BAR */}
      <section className="bg-slate-900/98 text-white border-b border-slate-800 shadow-sm shrink-0">
        <div className="w-full px-4 py-3 md:px-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            
            {/* KPI 1 */}
            <div className="flex items-center gap-3 bg-slate-800/40 p-3 rounded-lg border border-slate-800">
              <div className="w-8 h-8 rounded-full bg-blue-500/10 text-blue-400 flex items-center justify-center">
                <PlayCircle size={18} />
              </div>
              <div>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block leading-none">Lotes Programados</span>
                <span className="text-base font-black text-slate-100 font-mono leading-tight">{totalBatchesCount} Lotes</span>
              </div>
            </div>

            {/* KPI 2 */}
            <div className="flex items-center gap-3 bg-slate-800/40 p-3 rounded-lg border border-slate-800">
              <div className="w-8 h-8 rounded-full bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
                <Layers size={18} />
              </div>
              <div>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block leading-none">Fórmulas / Receitas</span>
                <span className="text-base font-black text-slate-100 font-mono leading-tight">{formulasCount} Ativas</span>
              </div>
            </div>

            {/* KPI 3 */}
            <div className="flex items-center gap-3 bg-slate-800/40 p-3 rounded-lg border border-slate-800">
              <div className="w-8 h-8 rounded-full bg-amber-500/10 text-amber-500 flex items-center justify-center">
                <ShieldX size={18} />
              </div>
              <div>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block leading-none">Paradas de Preventiva</span>
                <span className="text-base font-black text-slate-100 font-mono leading-tight">{preventativesCount} Janelas</span>
              </div>
            </div>

            {/* KPI 4 */}
            <div className="flex items-center gap-3 bg-slate-800/40 p-3 rounded-lg border border-slate-800">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                conflictBatchesCount > 0 ? 'bg-rose-500/20 text-rose-400 animate-pulse' : 'bg-slate-700/50 text-slate-400'
              }`}>
                <AlertOctagon size={18} />
              </div>
              <div>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block leading-none">Lotes com Conflito</span>
                <span className={`text-base font-black font-mono leading-tight ${
                  conflictBatchesCount > 0 ? 'text-rose-400' : 'text-slate-300'
                }`}>
                  {conflictBatchesCount > 0 ? `${conflictBatchesCount} Bloqueados` : '0 Conflitos'}
                </span>
              </div>
            </div>

          </div>
        </div>
      </section>

      {/* DASHBOARD CONTAINER WITH TABS */}
      <main className="flex-1 w-full p-4 md:p-6 space-y-6 flex flex-col justify-start">
        
        {/* TABS SELECTOR ROW */}
        <div className="flex border-b border-slate-200 bg-white p-1 rounded-xl shadow-xs gap-1 shrink-0" id="tabs-navigation-panel">
          
          <button
            onClick={() => setActiveTab('gantt')}
            className={`flex-1 md:flex-initial flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
              activeTab === 'gantt'
                ? 'bg-slate-900 text-white shadow-xs'
                : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100/70'
            }`}
            id="tab-gantt"
          >
            <Calendar size={15} /> Gantt da Produção
          </button>

          <button
            onClick={() => setActiveTab('batch')}
            className={`flex-1 md:flex-initial flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
              activeTab === 'batch'
                ? 'bg-slate-900 text-white shadow-xs'
                : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100/70'
            }`}
            id="tab-batch"
          >
            <PlayCircle size={15} /> Programar Novo Lote (PCP)
          </button>

          <button
            onClick={() => setActiveTab('product')}
            className={`flex-1 md:flex-initial flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
              activeTab === 'product'
                ? 'bg-slate-900 text-white shadow-xs'
                : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100/70'
            }`}
            id="tab-product"
          >
            <Layers size={15} /> Fórmulas & Receitas
          </button>

          <button
            onClick={() => setActiveTab('preventatives')}
            className={`flex-1 md:flex-initial flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
              activeTab === 'preventatives'
                ? 'bg-slate-900 text-white shadow-xs'
                : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100/70'
            }`}
            id="tab-preventatives"
          >
            <ShieldX size={15} /> Preventivas & Limpeza
          </button>

          <button
            onClick={() => setActiveTab('deviations')}
            className={`flex-1 md:flex-initial flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-bold rounded-lg transition-all relative cursor-pointer ${
              activeTab === 'deviations'
                ? 'bg-rose-900 border border-rose-800 text-white shadow-xs'
                : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100/70'
            }`}
            id="tab-deviations"
          >
            <AlertTriangle size={15} className={deviations.length > 0 ? "text-rose-500 animate-pulse" : ""} /> 
            Desvios & Ocorrências
            {deviations.length > 0 && (
              <span className="absolute -top-1 -right-1 bg-rose-600 text-white text-[9px] font-black rounded-full h-4 min-w-4 px-1 flex items-center justify-center shadow-xs">
                {deviations.length}
              </span>
            )}
          </button>
        </div>

        {/* TAB ACTIVE CONTENT RENDER */}
        <div className="flex-1 flex flex-col justify-start">
          {activeTab === 'gantt' && (
            <div className="space-y-6 flex flex-col justify-start">
              
              {/* HEADER DA SEÇÃO DE CONFIGURAÇÃO COM BOTÃO DE TOGGLE/MINIMIZAR */}
              <div className="flex justify-between items-center bg-white px-4 py-2.5 rounded-xl border border-slate-200 shadow-xs shrink-0 select-none">
                <div className="flex items-center gap-2">
                  <Sliders size={14} className="text-slate-500" />
                  <span className="text-[10px] font-extrabold text-slate-700 uppercase tracking-wider">Painéis de Configuração Operacional e Metas (PCP)</span>
                </div>
                <button
                  onClick={() => setShowConfigPanels(!showConfigPanels)}
                  className="px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-650 hover:text-slate-800 rounded-lg text-xs font-bold transition-all flex items-center gap-1 cursor-pointer border border-slate-200 shadow-3xs"
                  title={showConfigPanels ? "Minimizar painéis de configuração" : "Expandir painéis de configuração"}
                >
                  {showConfigPanels ? (
                    <>
                      <ChevronUp size={14} /> Minimizar Painéis
                    </>
                  ) : (
                    <>
                      <ChevronDown size={14} /> Expandir Painéis
                    </>
                  )}
                </button>
              </div>

              {/* TRIPLE CONFIGURATION PANELS */}
              {showConfigPanels && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                
                {/* PANEL 1: CONFIGURAÇÃO DE TURNOS OPERACIONAIS */}
                <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between border-b border-slate-100 pb-3" id="shifts-manager-header">
                      <div className="flex items-center gap-2">
                        <Clock size={16} className="text-amber-500" />
                        <h3 className="font-bold text-slate-800 text-xs uppercase tracking-wider">Escalas de Turnos Operacionais (PCP)</h3>
                      </div>
                      <button
                        type="button"
                        onClick={handleAddShift}
                        className="text-[10px] font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 px-2 py-1 rounded transition-colors cursor-pointer"
                        id="btn-add-new-shift"
                      >
                        + Novo Turno
                      </button>
                    </div>
                    
                    <div className="space-y-4 mt-4 max-h-[280px] overflow-y-auto pr-1" id="shifts-list-container">
                      {shiftConfig.shifts.map((sh) => (
                        <div key={sh.id} className="p-3 bg-slate-50 border border-slate-205 rounded-xl space-y-3 relative">
                          {/* Name and delete */}
                          <div className="flex items-center justify-between gap-2">
                            <input
                              type="text"
                              value={sh.name}
                              onChange={(e) => handleUpdateShift(sh.id, { name: e.target.value })}
                              className="bg-transparent border-b border-transparent hover:border-slate-300 focus:border-slate-500 text-xs font-bold text-slate-800 focus:outline-none py-0.5 px-1 truncate flex-1"
                              placeholder="Nome do turno..."
                            />
                            <button
                              type="button"
                              onClick={() => handleDeleteShift(sh.id)}
                              className="text-rose-600 hover:text-rose-700 p-1 rounded hover:bg-rose-50 transition-colors cursor-pointer"
                              title="Excluir este turno"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>

                          {/* Hours selectors */}
                          <div className="grid grid-cols-2 gap-2">
                            <div className="space-y-1">
                              <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">Entrada</label>
                              <select
                                value={sh.startHour}
                                onChange={(e) => handleUpdateShift(sh.id, { startHour: e.target.value })}
                                className="w-full px-1.5 py-1 bg-white border border-slate-200 rounded-lg text-[11px] font-mono font-bold text-slate-700 focus:outline-none"
                              >
                                {Array.from({ length: 24 }, (_, i) => {
                                  const h = String(i).padStart(2, '0') + ':00';
                                  return <option key={h} value={h}>{h} hs</option>;
                                })}
                              </select>
                            </div>

                            <div className="space-y-1">
                              <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">Saída</label>
                              <select
                                value={sh.endHour}
                                onChange={(e) => handleUpdateShift(sh.id, { endHour: e.target.value })}
                                className="w-full px-1.5 py-1 bg-white border border-slate-200 rounded-lg text-[11px] font-mono font-bold text-slate-700 focus:outline-none"
                              >
                                {Array.from({ length: 24 }, (_, i) => {
                                  const h = String(i).padStart(2, '0') + ':00';
                                  return <option key={h} value={h}>{h} hs</option>;
                                })}
                              </select>
                            </div>
                          </div>

                          {/* Workdays selector */}
                          <div className="space-y-1">
                            <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">Escala de Trabalho</label>
                            <div className="flex gap-1">
                              {[
                                { index: 1, label: 'Seg' },
                                { index: 2, label: 'Ter' },
                                { index: 3, label: 'Qua' },
                                { index: 4, label: 'Qui' },
                                { index: 5, label: 'Sex' },
                                { index: 6, label: 'Sáb' },
                                { index: 0, label: 'Dom' }
                              ].map((d, dIdx) => {
                                const isActive = sh.workDays.includes(d.index);
                                return (
                                  <button
                                    key={dIdx}
                                    type="button"
                                    onClick={() => {
                                      const list = sh.workDays.includes(d.index)
                                        ? sh.workDays.filter(i => i !== d.index)
                                        : [...sh.workDays, d.index];
                                      handleUpdateShift(sh.id, { workDays: list.sort() });
                                    }}
                                    className={`flex-1 text-[10px] py-1 font-bold rounded border transition-all cursor-pointer ${
                                      isActive
                                        ? 'bg-slate-900 border-slate-900 text-white shadow-xs'
                                        : 'bg-white hover:bg-slate-100 border-slate-200 text-slate-400'
                                    }`}
                                  >
                                    {d.label}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  
                  <div className="pt-2 border-t border-slate-100 block">
                    <p className="text-[9px] text-slate-400 font-medium leading-normal">
                      *Reatores operam 24/7 de forma contínua. Inoculação, transferências internas e envase exigem turnos ativos de escala definida acima.
                    </p>
                  </div>
                </div>
                
                {/* PANEL 2: PLANEJAMENTO MENSAL POR META DE VOLUME */}
                <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                  <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
                    <CalendarDays size={16} className="text-emerald-500" />
                    <h3 className="font-bold text-slate-800 text-xs uppercase tracking-wider">Planejamento Periódico por Meta de Volume</h3>
                  </div>
                  
                  {/* Selector de modo: Único ou Mix */}
                  <div className="flex border-b border-slate-100 pb-2 mb-3 gap-4 justify-between items-center">
                    <div className="flex gap-4">
                      <button
                        type="button"
                        onClick={() => setPlanningModeTab('single')}
                        className={`text-xs font-bold pb-1 cursor-pointer transition-all ${
                          planningModeTab === 'single'
                            ? 'text-indigo-600 border-b-2 border-indigo-600'
                            : 'text-slate-400 hover:text-slate-650'
                        }`}
                      >
                        Lote Único
                      </button>
                      <button
                        type="button"
                        onClick={() => setPlanningModeTab('mix')}
                        className={`text-xs font-bold pb-1 cursor-pointer transition-all ${
                          planningModeTab === 'mix'
                            ? 'text-indigo-600 border-b-2 border-indigo-600'
                            : 'text-slate-400 hover:text-slate-650'
                        }`}
                      >
                        Mix de Produtos
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={handleAnalyseBestStart}
                      className="px-2.5 py-1 bg-amber-500 hover:bg-amber-600 text-slate-950 rounded-lg text-[10px] font-black tracking-tight transition-all flex items-center gap-1 shadow-2xs cursor-pointer"
                      title="Encontrar a melhor data e horário de início no mês"
                    >
                      ⚡ Analisar Início
                    </button>
                  </div>

                  {planningModeTab === 'mix' ? (
                    <form onSubmit={handleAutoPlanMix} className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        {/* Data inicial do plano */}
                        <div className="space-y-1.5 col-span-2 sm:col-span-1">
                          <label className="text-[10px] font-bold text-slate-450 uppercase tracking-widest block">Data Início da Campanha (Comum)</label>
                          <input
                            type="datetime-local"
                            value={plannerStart}
                            onChange={(e) => setPlannerStart(e.target.value)}
                            className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono font-semibold text-slate-700"
                            required
                          />
                        </div>
                        <div className="col-span-2 sm:col-span-1 flex items-end">
                          <span className="text-[10px] text-slate-400 leading-relaxed font-semibold">
                            *O motor PCP agendará sequencialmente os produtos marcados na ordem de prioridade definida abaixo.
                          </span>
                        </div>

                        {/* Checkbox de Ajuste de Lead-Time e Restrição ao Mês */}
                        <div className="col-span-2 flex items-center gap-2 bg-indigo-50/40 p-2.5 rounded-xl border border-indigo-100/60">
                          <input
                            type="checkbox"
                            id="use-lead-time-mix"
                            checked={useLeadTimePlanning}
                            onChange={(e) => setUseLeadTimePlanning(e.target.checked)}
                            className="w-3.5 h-3.5 rounded text-indigo-650 focus:ring-indigo-500 cursor-pointer"
                          />
                          <label htmlFor="use-lead-time-mix" className="text-[10px] font-black text-slate-750 cursor-pointer select-none">
                            Ajustar início pelo Lead-Time (antecipa Erlen para envasar na data escolhida e restringe ao mês útil)
                          </label>
                        </div>
                      </div>

                      {/* Lista de Produtos do Mix */}
                      <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
                        {recipes.map((r) => {
                          const config = mixConfig[r.id] || { enabled: false, volume: r.yieldPerBatch * 3, priority: 1 };
                          return (
                            <div key={r.id} className="flex items-center gap-2 p-2 bg-slate-50 border border-slate-200 rounded-lg text-xs">
                              {/* Habilitado */}
                              <input
                                type="checkbox"
                                checked={config.enabled}
                                onChange={(e) => setMixConfig(prev => ({
                                  ...prev,
                                  [r.id]: { ...prev[r.id], enabled: e.target.checked }
                                }))}
                                className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                              />

                              {/* Nome do Produto */}
                              <div className="flex-1 min-w-0">
                                <p className="font-bold truncate text-slate-700">{r.name}</p>
                                <p className="text-[9px] text-slate-400 font-mono">Rend: {r.yieldPerBatch.toLocaleString('pt-BR')} L/Lote</p>
                              </div>

                              {/* Volume (apenas habilitado se checkbox estiver ativo) */}
                              <div className="w-28 flex items-center gap-1">
                                <input
                                  type="number"
                                  placeholder="Volume"
                                  disabled={!config.enabled}
                                  value={config.volume}
                                  onChange={(e) => setMixConfig(prev => ({
                                    ...prev,
                                    [r.id]: { ...prev[r.id], volume: Math.max(0, parseInt(e.target.value) || 0) }
                                  }))}
                                  className="w-full px-1.5 py-1 bg-white border border-slate-200 rounded text-center font-mono text-[11px] disabled:bg-slate-100 disabled:text-slate-400 font-bold"
                                />
                                <span className="text-[9px] text-slate-400 font-bold">L</span>
                              </div>

                              {/* Prioridade/Sequência */}
                              <div className="w-16">
                                <select
                                  disabled={!config.enabled}
                                  value={config.priority}
                                  onChange={(e) => setMixConfig(prev => ({
                                    ...prev,
                                    [r.id]: { ...prev[r.id], priority: parseInt(e.target.value) || 1 }
                                  }))}
                                  className="w-full px-1 py-1 bg-white border border-slate-200 rounded text-center text-[11px] font-bold text-slate-700 disabled:bg-slate-100 disabled:text-slate-400 cursor-pointer"
                                >
                                  {Array.from({ length: recipes.length }, (_, i) => (
                                    <option key={i + 1} value={i + 1}>
                                      {i + 1}º
                                    </option>
                                  ))}
                                </select>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* GESTÃO E ESTRATÉGIA DE OPs DO CLIENTE / ERP */}
                      <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 space-y-2">
                        <div className="flex items-center justify-between">
                          <label className="text-[10px] font-black text-slate-700 uppercase tracking-wider block">
                            Estratégia de Numeração de OPs (ERP)
                          </label>
                          <span className="text-[9px] text-indigo-600 font-bold bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-100">
                            🧬 Rastreabilidade por Escala
                          </span>
                        </div>

                        <div className="grid grid-cols-3 gap-1 text-xs">
                          <button
                            type="button"
                            onClick={() => setOpNamingMode('auto')}
                            className={`py-1.5 px-1 rounded-lg text-[9px] font-bold transition-all cursor-pointer ${
                              opNamingMode === 'auto'
                                ? 'bg-slate-900 text-white shadow-2xs'
                                : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                            }`}
                          >
                            ⚙️ Auto (PRE-L001)
                          </button>
                          <button
                            type="button"
                            onClick={() => setOpNamingMode('prefix')}
                            className={`py-1.5 px-1 rounded-lg text-[9px] font-bold transition-all cursor-pointer ${
                              opNamingMode === 'prefix'
                                ? 'bg-slate-900 text-white shadow-2xs'
                                : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                            }`}
                          >
                            🔢 OP Inicial
                          </button>
                          <button
                            type="button"
                            onClick={() => setOpNamingMode('custom_list')}
                            className={`py-1.5 px-1 rounded-lg text-[9px] font-bold transition-all cursor-pointer ${
                              opNamingMode === 'custom_list'
                                ? 'bg-slate-900 text-white shadow-2xs'
                                : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                            }`}
                          >
                            📋 Colar OPs ERP
                          </button>
                        </div>

                        {opNamingMode === 'prefix' && (
                          <div className="pt-1 animate-fadeIn">
                            <label className="text-[9px] font-bold text-slate-500 uppercase tracking-tight block">Número / Prefixo Inicial da OP</label>
                            <input
                              type="text"
                              value={opPrefixInput}
                              onChange={(e) => setOpPrefixInput(e.target.value)}
                              placeholder="Ex: OP-9040 (gerará OP-9040, OP-9041...)"
                              className="w-full mt-1 px-2.5 py-1 bg-white border border-slate-300 rounded font-mono font-bold text-xs text-slate-800"
                            />
                          </div>
                        )}

                        {opNamingMode === 'custom_list' && (
                          <div className="pt-1 animate-fadeIn">
                            <label className="text-[9px] font-bold text-slate-500 uppercase tracking-tight block">Lista de OPs do ERP (uma por linha ou vírgula)</label>
                            <textarea
                              value={customOpListInput}
                              onChange={(e) => setCustomOpListInput(e.target.value)}
                              placeholder="Colar OPs exatas do cliente:&#10;OP-1024&#10;OP-1029&#10;OP-1055"
                              className="w-full mt-1 px-2.5 py-1 bg-white border border-slate-300 rounded font-mono text-[11px] text-slate-800 min-h-14"
                            />
                          </div>
                        )}
                      </div>

                      {/* Botões de Ações do Mix */}
                      <div className="flex gap-2 pt-2">
                        <button
                          type="submit"
                          className="flex-1 flex items-center justify-center gap-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold py-2 rounded-lg transition-colors shadow-xs cursor-pointer h-9"
                          title="Gerar Sequenciamento de Mix de Produtos"
                        >
                          <RefreshCw size={12} /> Gerar Mix
                        </button>
                        <button
                          type="button"
                          onClick={handleClearAllBatches}
                          className="flex items-center justify-center bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-600 p-2 rounded-lg transition-colors cursor-pointer h-9"
                          title="Apagar TODOS os lotes cadastrados"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </form>
                  ) : (
                    <form onSubmit={handleAutoPlan} className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        {/* Product select */}
                        <div className="space-y-1.5 col-span-2 sm:col-span-1">
                          <label className="text-[10px] font-bold text-slate-450 uppercase tracking-widest block">Selecionar Produto</label>
                          <select
                            value={plannerRecipeId}
                            onChange={(e) => setPlannerRecipeId(e.target.value)}
                            className="w-full px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold text-slate-700 focus:outline-none"
                            required
                          >
                            {recipes.map(r => (
                              <option key={r.id} value={r.id}>
                                {r.name} (Rend: {r.yieldPerBatch?.toLocaleString('pt-BR') || '3.000'}L)
                              </option>
                            ))}
                          </select>
                        </div>

                        {/* Meta volume */}
                        <div className="space-y-1.5 col-span-2 sm:col-span-1">
                          <label className="text-[10px] font-bold text-slate-450 uppercase tracking-widest block">Meta Mensal (L / Doses)</label>
                          <div className="relative">
                            <input
                              type="number"
                              min="1"
                              value={targetVolume}
                              onChange={(e) => setTargetVolume(Math.max(1, parseInt(e.target.value) || 1))}
                              className="w-full pl-3 pr-8 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono font-bold text-slate-700"
                              required
                            />
                            <span className="absolute right-2.5 top-1.5 text-[10px] uppercase font-bold text-slate-400 pointer-events-none">Litros</span>
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        {/* Data inicial do plano */}
                        <div className="space-y-1.5 col-span-2 sm:col-span-1">
                          <label className="text-[10px] font-bold text-slate-450 uppercase tracking-widest block">Data Início da Campanha</label>
                          <input
                            type="datetime-local"
                            value={plannerStart}
                            onChange={(e) => setPlannerStart(e.target.value)}
                            className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono font-semibold text-slate-700"
                            required
                          />
                        </div>

                        {/* Checkbox de Ajuste de Lead-Time e Restrição ao Mês */}
                        <div className="col-span-2 sm:col-span-1 flex items-center gap-2 bg-indigo-50/40 p-2.5 rounded-xl border border-indigo-100/60">
                          <input
                            type="checkbox"
                            id="use-lead-time-single"
                            checked={useLeadTimePlanning}
                            onChange={(e) => setUseLeadTimePlanning(e.target.checked)}
                            className="w-3.5 h-3.5 rounded text-indigo-650 focus:ring-indigo-500 cursor-pointer"
                          />
                          <label htmlFor="use-lead-time-single" className="text-[10px] font-black text-slate-750 cursor-pointer select-none">
                            Ajustar início pelo Lead-Time (antecipa Erlen para envasar na data escolhida e restringe ao mês útil)
                          </label>
                        </div>
                      </div>

                      {/* GESTÃO E ESTRATÉGIA DE OPs DO CLIENTE / ERP */}
                      <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 space-y-2">
                        <div className="flex items-center justify-between">
                          <label className="text-[10px] font-black text-slate-700 uppercase tracking-wider block">
                            Estratégia de Numeração de OPs (ERP)
                          </label>
                          <span className="text-[9px] text-indigo-600 font-bold bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-100">
                            🧬 Rastreabilidade por Escala
                          </span>
                        </div>

                        <div className="grid grid-cols-3 gap-1 text-xs">
                          <button
                            type="button"
                            onClick={() => setOpNamingMode('auto')}
                            className={`py-1.5 px-1 rounded-lg text-[9px] font-bold transition-all cursor-pointer ${
                              opNamingMode === 'auto'
                                ? 'bg-slate-900 text-white shadow-2xs'
                                : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                            }`}
                          >
                            ⚙️ Auto (PRE-L001)
                          </button>
                          <button
                            type="button"
                            onClick={() => setOpNamingMode('prefix')}
                            className={`py-1.5 px-1 rounded-lg text-[9px] font-bold transition-all cursor-pointer ${
                              opNamingMode === 'prefix'
                                ? 'bg-slate-900 text-white shadow-2xs'
                                : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                            }`}
                          >
                            🔢 OP Inicial
                          </button>
                          <button
                            type="button"
                            onClick={() => setOpNamingMode('custom_list')}
                            className={`py-1.5 px-1 rounded-lg text-[9px] font-bold transition-all cursor-pointer ${
                              opNamingMode === 'custom_list'
                                ? 'bg-slate-900 text-white shadow-2xs'
                                : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                            }`}
                          >
                            📋 Colar OPs ERP
                          </button>
                        </div>

                        {opNamingMode === 'prefix' && (
                          <div className="pt-1 animate-fadeIn">
                            <label className="text-[9px] font-bold text-slate-500 uppercase tracking-tight block">Número / Prefixo Inicial da OP</label>
                            <input
                              type="text"
                              value={opPrefixInput}
                              onChange={(e) => setOpPrefixInput(e.target.value)}
                              placeholder="Ex: OP-9040 (gerará OP-9040, OP-9041...)"
                              className="w-full mt-1 px-2.5 py-1 bg-white border border-slate-300 rounded font-mono font-bold text-xs text-slate-800"
                            />
                          </div>
                        )}

                        {opNamingMode === 'custom_list' && (
                          <div className="pt-1 animate-fadeIn">
                            <label className="text-[9px] font-bold text-slate-500 uppercase tracking-tight block">Lista de OPs do ERP (uma por linha ou vírgula)</label>
                            <textarea
                              value={customOpListInput}
                              onChange={(e) => setCustomOpListInput(e.target.value)}
                              placeholder="Colar OPs exatas do cliente:&#10;OP-1024&#10;OP-1029&#10;OP-1055"
                              className="w-full mt-1 px-2.5 py-1 bg-white border border-slate-300 rounded font-mono text-[11px] text-slate-800 min-h-14"
                            />
                          </div>
                        )}
                      </div>

                        {/* Botões de Ações */}
                        <div className="flex items-end gap-2 col-span-2 sm:col-span-1">
                          <button
                            type="submit"
                            className="flex-1 flex items-center justify-center gap-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold py-2 rounded-lg transition-colors shadow-xs cursor-pointer h-9 shrink-0"
                            title="Gerar Sequenciamento de Planejamento Automático PCP"
                          >
                            <RefreshCw size={12} /> Gerar Planejamento
                          </button>
                          <button
                            type="button"
                            onClick={handleClearAllBatches}
                            className="flex items-center justify-center bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-600 p-2 rounded-lg transition-colors cursor-pointer h-9"
                            title="Apagar TODOS os lotes cadastrados"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                    </form>
                  )}
                </div>

                {/* PANEL 3: RESTRIÇÕES INDUSTRIAIS: SETUP/CIP E LINHAS DE ENVASE ATIVAS */}
                <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
                      <Sliders size={16} className="text-slate-700" />
                      <h3 className="font-bold text-slate-800 text-xs uppercase tracking-wider">Configuração de Restrições Industriais</h3>
                    </div>

                    <div className="space-y-4 mt-4">
                      {/* Equipment count configuration per Scale */}
                      <div className="space-y-2 pb-3 border-b border-slate-150">
                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                          Capacidade de Equipamentos / Rotas por Escala (Linhas no Gantt)
                        </label>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div className="flex flex-col gap-1">
                            <span className="text-[9px] font-bold text-slate-500 uppercase">Rotas Erlenmeyer</span>
                            <div className="flex items-center gap-1">
                              <input
                                type="number"
                                min="1"
                                max="30"
                                value={scaleCounts.erlenmeyerCount}
                                onChange={(e) => handleUpdateScaleCount('erlenmeyerCount', (parseInt(e.target.value) || 1) - scaleCounts.erlenmeyerCount)}
                                className="w-16 px-2 py-1 text-center bg-slate-50 border border-slate-205 rounded text-xs font-mono font-bold"
                              />
                              <span className="text-[10px] text-slate-400">rotas</span>
                            </div>
                          </div>

                          <div className="flex flex-col gap-1">
                            <span className="text-[9px] font-bold text-slate-500 uppercase">Rotas Balão</span>
                            <div className="flex items-center gap-1">
                              <input
                                type="number"
                                min="1"
                                max="30"
                                value={scaleCounts.balaoCount}
                                onChange={(e) => handleUpdateScaleCount('balaoCount', (parseInt(e.target.value) || 1) - scaleCounts.balaoCount)}
                                className="w-16 px-2 py-1 text-center bg-slate-50 border border-slate-205 rounded text-xs font-mono font-bold"
                              />
                              <span className="text-[10px] text-slate-400">rotas</span>
                            </div>
                          </div>

                          <div className="flex flex-col gap-1">
                            <span className="text-[9px] font-bold text-slate-500 uppercase">Biorreatores 100L</span>
                            <div className="flex items-center gap-1">
                              <input
                                type="number"
                                min="1"
                                max="30"
                                value={scaleCounts.b100LCount}
                                onChange={(e) => handleUpdateScaleCount('b100LCount', (parseInt(e.target.value) || 1) - scaleCounts.b100LCount)}
                                className="w-16 px-2 py-1 text-center bg-slate-50 border border-slate-205 rounded text-xs font-mono font-bold"
                              />
                              <span className="text-[10px] text-slate-400">vasos</span>
                            </div>
                          </div>

                          <div className="flex flex-col gap-1">
                            <span className="text-[9px] font-bold text-slate-500 uppercase">Biorreatores 500L</span>
                            <div className="flex items-center gap-1">
                              <input
                                type="number"
                                min="1"
                                max="30"
                                value={scaleCounts.b500LCount}
                                onChange={(e) => handleUpdateScaleCount('b500LCount', (parseInt(e.target.value) || 1) - scaleCounts.b500LCount)}
                                className="w-16 px-2 py-1 text-center bg-slate-50 border border-slate-205 rounded text-xs font-mono font-bold"
                              />
                              <span className="text-[10px] text-slate-400">vasos</span>
                            </div>
                          </div>

                          <div className="flex flex-col gap-1">
                            <span className="text-[9px] font-bold text-slate-500 uppercase">Biorreatores 5kL</span>
                            <div className="flex items-center gap-1">
                              <input
                                type="number"
                                min="1"
                                max="30"
                                value={scaleCounts.b5kLCount}
                                onChange={(e) => handleUpdateScaleCount('b5kLCount', (parseInt(e.target.value) || 1) - scaleCounts.b5kLCount)}
                                className="w-16 px-2 py-1 text-center bg-slate-50 border border-slate-205 rounded text-xs font-mono font-bold"
                              />
                              <span className="text-[10px] text-slate-400">vasos</span>
                            </div>
                          </div>

                          <div className="flex flex-col gap-1">
                            <span className="text-[9px] font-bold text-slate-500 uppercase">Linhas de Envase</span>
                            <div className="flex items-center gap-1">
                              <input
                                type="number"
                                min="1"
                                max="30"
                                value={scaleCounts.envaseCount}
                                onChange={(e) => handleUpdateScaleCount('envaseCount', (parseInt(e.target.value) || 1) - scaleCounts.envaseCount)}
                                className="w-16 px-2 py-1 text-center bg-slate-50 border border-slate-205 rounded text-xs font-mono font-bold"
                              />
                              <span className="text-[10px] text-slate-400">máquinas</span>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Setup/CIP post batch timings per Equipment scale */}
                      <div className="space-y-2 pt-2 border-t border-slate-100/60">
                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Tempos de Setup / Preparação (CIP) pôs lote</label>
                        <div className="grid grid-cols-2 gap-3 text-xs">
                          {Object.keys(setupTimes).map((scKey) => {
                            const label = scKey === '3000_5000L' ? 'Tanque 5kL' : scKey === 'Envase' ? 'Envase' : `Biorr. ${scKey}`;
                            return (
                              <div key={scKey} className="flex flex-col gap-1">
                                <span className="text-[9px] font-bold text-slate-500 uppercase tracking-tight">{label}</span>
                                <div className="flex items-center gap-1">
                                  <input
                                    type="number"
                                    min="0"
                                    max="48"
                                    value={setupTimes[scKey as ScaleType]}
                                    onChange={(e) => {
                                      const val = Math.max(0, parseInt(e.target.value) || 0);
                                      setSetupTimes(prev => ({ ...prev, [scKey]: val }));
                                    }}
                                    className="w-16 px-2 py-1 text-center bg-slate-50 border border-slate-205 rounded text-xs font-mono font-bold"
                                  />
                                  <span className="text-[10px] text-slate-400">h</span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="pt-2 border-t border-slate-100 block">
                    <p className="text-[9px] text-slate-400 font-medium leading-normal">
                      *O motor PCP do Gantt e do agendador automático respeitam e reservam o equipamento pós-conclusão pelo setup especificado.
                    </p>
                  </div>
                </div>

                {/* INDUSTRIAL ASSETS & NOMENCLATURE MANAGER FOR MULTI-CLIENT PLANTS */}
                <IndustrialAssetsManager
                  assets={customAssets}
                  scaleCounts={scaleCounts}
                  onUpdateAsset={handleUpdateAsset}
                  onAddAsset={handleAddAsset}
                  onDeleteAsset={handleDeleteAsset}
                  onResetAssets={handleResetAssets}
                />

              </div>
              )}

              {/* FINITE PLANNING ERROR LOG MESSAGES */}
              {planningErrors.length > 0 && (
                <div className="bg-rose-50 border border-rose-200 text-rose-800 rounded-2xl p-4 md:p-5 space-y-2 animate-fadeIn" id="pcp-planning-errors">
                  <div className="flex items-center justify-between gap-2 text-rose-700 font-extrabold text-xs uppercase tracking-wider border-b border-rose-200/60 pb-2">
                    <div className="flex items-center gap-2">
                      <AlertOctagon size={16} />
                      <span>Gargalos PCP: {planningErrors.length} Lote(s) não puderam ser programados (Restrição de Turno/Capacidades)</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setPlanningErrors([])}
                      className="p-1 text-rose-500 hover:text-rose-900 hover:bg-rose-150/70 rounded-lg transition-colors cursor-pointer shrink-0"
                      title="Fechar e dispensar aviso de gargalos"
                    >
                      <X size={16} />
                    </button>
                  </div>
                  <p className="text-[11px] text-rose-600 font-medium">
                    As metas de volume esbarraram na capacidade finita das rotas ou colidiram em períodos de manutenção/fora de turno útil sem possibilidade de antecipação (com Backward). Detalhamento dos erros:
                  </p>
                  <div className="max-h-48 overflow-y-auto space-y-2 pr-1 divide-y divide-rose-100 font-mono text-[10px]">
                    {planningErrors.map((err, idx) => (
                      <div key={err.id} className="pt-2.5 flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-rose-100 last:border-0 pb-2.5">
                        <div className="space-y-1">
                          <span className="font-bold text-rose-700 block md:inline mr-2">{idx+1}. Lote {err.lotNumber} ({err.productName}):</span>
                          <span className="text-rose-600 leading-normal font-sans text-xs">{err.reason}</span>
                        </div>
                        {err.canBypass && (
                          <button
                            type="button"
                            onClick={() => handleBypassErrorScheduling(err)}
                            className="shrink-0 bg-emerald-600 hover:bg-emerald-700 text-white font-sans text-[10px] font-bold px-3 py-1.5 rounded-lg shadow-xs transition-colors cursor-pointer flex items-center gap-1"
                          >
                            <CheckCircle size={10} /> Autorizar e Agendar (Horas Extras)
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* TIMELINE VIEW CARD */}
              <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <GanttTimeline
                  batches={batches}
                  preventatives={preventatives}
                  recipes={recipes}
                  onDeleteBatch={handleDeleteBatch}
                  onDeletePreventative={handleDeletePreventative}
                  onUpdateBatches={handleUpdateBatches}
                  onAddDeviationLog={handleAddDeviationLog}
                  setupTimes={setupTimes}
                  envaseLinesCount={envaseLinesCount}
                  scaleCounts={scaleCounts}
                  onUpdateScaleCount={handleUpdateScaleCount}
                  customAssets={customAssets}
                  deviations={deviations}
                  planningErrors={planningErrors}
                  onDeleteCampaignBatches={handleDeleteCampaignBatches}
                />
              </div>

            </div>
          )}

          {activeTab === 'batch' && (
            <BatchForm
              recipes={recipes}
              existingBatches={batches}
              preventatives={preventatives}
              shiftConfig={shiftConfig}
              onAddBatch={handleAddBatch}
              envaseLinesCount={envaseLinesCount}
              setupTimes={setupTimes}
            />
          )}

          {activeTab === 'product' && (
            <ProductForm
              recipes={recipes}
              onSaveRecipe={handleSaveRecipe}
              onDeleteRecipe={handleDeleteRecipe}
              customAssets={customAssets}
            />
          )}

          {activeTab === 'preventatives' && (
            <PreventativeForm
              preventatives={preventatives}
              onAddPreventative={handleAddPreventative}
              onDeletePreventative={handleDeletePreventative}
              envaseLinesCount={envaseLinesCount}
            />
          )}

          {activeTab === 'deviations' && (
            <div className="space-y-6 animate-fadeIn" id="deviations-tab-panel">
              {/* STATUS INDICATORS FOR OPERATION REPORT */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center gap-3">
                  <div className="p-2.5 rounded-lg bg-slate-100 text-slate-700">
                    <Sliders size={18} />
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Total de Intervenções</span>
                    <span className="text-lg font-black text-slate-800">{deviations.length}</span>
                  </div>
                </div>

                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center gap-3">
                  <div className="p-2.5 rounded-lg bg-rose-50 text-rose-600">
                    <AlertOctagon size={18} />
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Lotes Contaminados</span>
                    <span className="text-lg font-black text-rose-600">
                      {deviations.filter(d => d.type === 'CONTAMINATION' || d.type === 'contaminação').length}
                    </span>
                  </div>
                </div>

                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center gap-3">
                  <div className="p-2.5 rounded-lg bg-amber-50 text-amber-600">
                    <Clock size={18} />
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Recálculos de Horas</span>
                    <span className="text-lg font-black text-amber-600">
                      {deviations.filter(d => d.type === 'DELAY' || d.type === 'atraso / reprogramado').length}
                    </span>
                  </div>
                </div>

                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center gap-3">
                  <div className="p-2.5 rounded-lg bg-indigo-50 text-indigo-600">
                    <RefreshCw size={18} />
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Mudanças de Ativo</span>
                    <span className="text-lg font-black text-indigo-600">
                      {deviations.filter(d => d.type === 'ROUTE_CHANGE' || d.type === 'troca de rota').length}
                    </span>
                  </div>
                </div>
              </div>

              {/* LOG ENTRIES MAIN LIST AREA */}
              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3" id="deviations-log-header">
                  <div>
                    <h3 className="font-extrabold text-slate-800 text-sm uppercase tracking-wider">Histórico de Ocorrências & Estudo de Causa (PCP)</h3>
                    <p className="text-[11px] text-slate-400 font-semibold font-mono">Registro cronológico de incidentes mecânicos, biológicos ou operacionais adaptativos</p>
                  </div>
                  {deviations.length > 0 && (
                    <button
                      onClick={() => {
                        if (confirm('Deseja realmente limpar permanentemente todo o histórico de desvios operacionais?')) {
                          setDeviations([]);
                          localStorage.removeItem('pcp_deviations');
                        }
                      }}
                      className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 border border-rose-250 rounded-lg text-rose-600 text-xs font-bold transition-all flex items-center gap-1 cursor-pointer"
                    >
                      <Trash2 size={13} /> Limpar Ocorrências
                    </button>
                  )}
                </div>

                {deviations.length === 0 ? (
                  <div className="py-12 text-center max-w-md mx-auto space-y-3">
                    <div className="w-12 h-12 bg-emerald-50 text-emerald-500 rounded-full flex items-center justify-center mx-auto text-xl shadow-xs">
                      ✓
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs font-extrabold text-slate-800 uppercase tracking-widest">Nenhum Desvio Ativo</p>
                      <p className="text-[11px] text-slate-400 font-semibold leading-relaxed">
                        A planta biológica está operando perfeitamente dentro do planejado. Nenhuma contaminação ou desvio de rota foi relatado no momento.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100 overflow-hidden">
                    {deviations.map((dev) => {
                      // Custom tags
                      let typeBadge = 'bg-slate-50 text-slate-700 border-slate-200';
                      let typeLabel = dev.type;
                      if (dev.type === 'CONTAMINATION' || dev.type === 'contaminação') {
                        typeBadge = 'bg-rose-50 text-rose-700 border-rose-200';
                        typeLabel = 'Contaminação';
                      } else if (dev.type === 'DELAY' || dev.type === 'atraso / reprogramado') {
                        typeBadge = 'bg-amber-50 text-amber-700 border-amber-250';
                        typeLabel = 'Ajuste de Horário';
                      } else if (dev.type === 'ROUTE_CHANGE' || dev.type === 'troca de rota') {
                        typeBadge = 'bg-indigo-50 text-indigo-700 border-indigo-250';
                        typeLabel = 'Troca de Rota';
                      }

                      const displayCategory = dev.category || dev.reason || 'Geral';
                      let categoryBadge = 'bg-slate-50 border border-slate-200 text-slate-750';
                      if (displayCategory === 'Biológico') categoryBadge = 'bg-teal-50 border border-teal-200 text-teal-800';
                      else if (displayCategory === 'Mecânico') categoryBadge = 'bg-cyan-50 border border-cyan-200 text-cyan-800';
                      else if (displayCategory === 'Operacional') categoryBadge = 'bg-slate-50 border border-slate-200 text-slate-700';

                      return (
                        <div key={dev.id} className="py-4 flex flex-col md:flex-row md:items-start justify-between gap-4 font-sans text-xs">
                          <div className="space-y-1.5 flex-1 pr-4">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className={`px-2 py-0.5 rounded-full text-[9px] font-extrabold uppercase border ${typeBadge}`}>
                                {typeLabel}
                              </span>
                              <span className={`px-2 py-0.5 rounded text-[9px] font-bold ${categoryBadge}`}>
                                {displayCategory}
                              </span>
                              <span className="text-[10px] font-mono text-slate-400 font-bold">
                                {formatFullDate(dev.timestamp)}
                              </span>
                            </div>

                            <p className="text-[11px] font-mono block">
                              Lote de Produção: <strong className="text-slate-800">{dev.lotNumber}</strong> • Produto: <span className="font-bold">{dev.productName}</span>
                            </p>

                          <div className="bg-slate-50/70 p-3 rounded-lg border border-slate-150 leading-relaxed text-slate-600 max-w-4xl text-[11px]">
                              {dev.notes}
                            </div>
                          </div>

                          <div className="shrink-0 flex md:flex-col items-end gap-1.5 text-right font-mono text-[9px] text-slate-400">
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </main>

      {/* FOOTER */}
      <footer className="bg-white border-t border-slate-200 py-4 px-4 text-center text-[11px] font-medium text-slate-400 shrink-0" id="global-footer">
        © 2026 Sequenciador Gantt PCP Biológico • Planejamento e Controle de Produção de Lotes de Multiplicação Bacteriana • DaniloHenrique120@gmail.com
      </footer>

      {showAnalyseModal && (
        <div className="fixed inset-0 bg-slate-950/65 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-fadeIn">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl max-w-2xl w-full max-h-[85vh] overflow-hidden flex flex-col">
            {/* Header */}
            <div className="p-6 border-b border-slate-100 flex items-center justify-between shrink-0 bg-slate-50">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-amber-500/10 text-amber-600 flex items-center justify-center shadow-3xs">
                  <PlayCircle size={20} className="animate-pulse" />
                </div>
                <div>
                  <h3 className="font-extrabold text-slate-800 text-sm uppercase tracking-wider">Otimizador de Início Mensal (APS)</h3>
                  <p className="text-[11px] text-slate-450 font-medium mt-0.5">
                    Meta de volume analisada: <span className="font-bold text-slate-700">{analyseMetaVolume.toLocaleString('pt-BR')} L</span>
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowAnalyseModal(false)}
                className="text-slate-400 hover:text-slate-650 p-1.5 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
              >
                <XCircle size={20} />
              </button>
            </div>

            {/* Toggle bar for Month boundary constraint */}
            <div className="px-6 py-3 bg-indigo-50/50 border-b border-slate-100 flex items-center justify-between shrink-0 select-none">
              <span className="text-[11px] text-slate-500 font-bold flex items-center gap-1.5">
                <Sliders size={12} className="text-indigo-500" /> Restringir Produção ao Mês Selecionado:
              </span>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={restrictToMonth}
                  onChange={(e) => handleToggleRestrict(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600"></div>
                <span className="ml-2 text-[10px] font-bold text-slate-700 uppercase tracking-tight">
                  {restrictToMonth ? 'Restringir ao Mês Ativo' : 'Sem Restrição (Campanha Completa)'}
                </span>
              </label>
            </div>

            {/* Content */}
            <div className="p-6 overflow-y-auto flex-1 space-y-4">
              {isAnalysing ? (
                <div className="flex flex-col items-center justify-center py-16 space-y-4">
                  <div className="w-12 h-12 border-4 border-slate-200 border-t-indigo-600 rounded-full animate-spin"></div>
                  <div className="text-center space-y-2 w-full max-w-xs">
                    <p className="text-xs font-bold text-slate-705">Varrendo o calendário mensal... {analyseProgress}%</p>
                    <div className="w-full bg-slate-200 h-2 rounded-full overflow-hidden shadow-3xs p-0.5">
                      <div className="bg-indigo-600 h-full rounded-full transition-all duration-300" style={{ width: `${analyseProgress}%` }}></div>
                    </div>
                    <p className="text-[10px] text-slate-400 font-medium">Simulando reatores, setups de CIP, escalas e preventivas em tempo real.</p>
                  </div>
                </div>
              ) : !hasRunAnalysis ? (
                <div className="py-12 flex flex-col items-center justify-center text-center space-y-4">
                  <div className="w-16 h-16 bg-indigo-50 border border-indigo-100 text-indigo-600 rounded-2xl flex items-center justify-center text-3xl shadow-3xs animate-bounce">
                    ⚡
                  </div>
                  <div className="space-y-1.5 max-w-md">
                    <h4 className="font-extrabold text-slate-800 text-sm uppercase tracking-wider">Pronto para Iniciar a Varredura</h4>
                    <p className="text-[11px] text-slate-450 font-medium leading-relaxed">
                      Ajuste os parâmetros de restrição mensal na barra acima. O otimizador simulará mais de 350 cenários bi-horários de partida (24/7) para encontrar as melhores datas e otimizar setups de CIP e reatores sem travar a tela.
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      setHasRunAnalysis(true);
                      performAnalysis(restrictToMonth);
                    }}
                    className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl transition-all shadow-md hover:scale-[1.02] cursor-pointer"
                  >
                    Executar Análise de Cenários
                  </button>
                </div>
              ) : (
                <>
                  {analyseResults.length === 0 ? (
                    <div className="p-5 bg-rose-50 border border-rose-150 rounded-2xl text-center space-y-3">
                      <p className="text-xs font-bold text-rose-700">Nenhum ponto de início viável encontrado</p>
                      <p className="text-[10px] text-rose-600 leading-normal">
                        O volume solicitado ou as restrições físicas (capacidade dos ativos ou preventivas) impedem que qualquer lote seja concluído neste mês sob o cenário atual.
                      </p>
                      <button
                        onClick={() => {
                          setHasRunAnalysis(true);
                          performAnalysis(restrictToMonth);
                        }}
                        className="px-4 py-2 bg-white border border-rose-200 text-rose-700 text-xs font-bold rounded-lg transition-all shadow-3xs cursor-pointer hover:bg-rose-100/50"
                      >
                        Tentar Novamente
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3.5">
                      <div className="flex justify-between items-center mb-1">
                        <p className="text-[10px] uppercase tracking-wider font-extrabold text-slate-400">Opções de Início Recomendadas:</p>
                        <button
                          onClick={() => {
                            setHasRunAnalysis(true);
                            performAnalysis(restrictToMonth);
                          }}
                          className="text-[10px] text-indigo-600 font-extrabold hover:underline"
                        >
                          Recalcular Cenários
                        </button>
                      </div>
                      {analyseResults.map((sug, idx) => {
                        const percent = Math.min(100, Math.round((sug.volumeScheduled / analyseMetaVolume) * 100));
                        const isPerfect = percent === 100;
                        const missingVolume = analyseMetaVolume - sug.volumeScheduled;

                        return (
                          <div
                            key={sug.startDateTime}
                            className={`p-4 border rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-4 transition-all hover:shadow-xs ${
                              idx === 0
                                ? 'bg-indigo-50/20 border-indigo-150 shadow-3xs'
                                : 'bg-slate-50/50 border-slate-200'
                            }`}
                          >
                            <div className="space-y-3 flex-1">
                              {/* Option badge */}
                              <div className="flex items-center gap-2">
                                <span className={`text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full ${
                                  idx === 0
                                    ? 'bg-indigo-600 text-white'
                                    : 'bg-slate-200 text-slate-600'
                                }`}>
                                  {idx === 0 ? '🏆 Opção Ideal' : `${idx + 1}ª Sugestão`}
                                </span>

                                {sug.requiresBypass ? (
                                  <span className="text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 flex items-center gap-0.5">
                                    ⚠️ Horas Extras ({sug.errorsCount})
                                  </span>
                                ) : (
                                  <span className="text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                                    ✅ Turno Padrão
                                  </span>
                                )}
                              </div>

                              {/* Dates */}
                              <div className="grid grid-cols-2 gap-2 text-xs">
                                <div>
                                  <span className="text-[9px] text-slate-400 font-bold block uppercase tracking-wider">Início</span>
                                  <span className="font-bold text-slate-700">{formatFullDate(sug.startDateTime)}</span>
                                </div>
                                <div>
                                  <span className="text-[9px] text-slate-400 font-bold block uppercase tracking-wider">Previsão Fim</span>
                                  <span className="font-bold text-slate-700">{formatFullDate(sug.endDateTime)}</span>
                                </div>
                              </div>

                              {/* Progress bar */}
                              <div className="space-y-1">
                                <div className="flex items-center justify-between text-[10px] font-bold text-slate-500">
                                  <span>Volume Total Encaixado:</span>
                                  <span className={isPerfect ? 'text-emerald-600 font-mono' : 'text-slate-700 font-mono'}>
                                    {sug.volumeScheduled.toLocaleString('pt-BR')} L <span className="text-[9px] text-slate-400 font-normal">({percent}% da Meta de {analyseMetaVolume.toLocaleString('pt-BR')} L)</span>
                                  </span>
                                </div>
                                <div className="w-full bg-slate-200 h-2 rounded-full overflow-hidden">
                                  <div
                                    className={`h-full transition-all duration-500 ${isPerfect ? 'bg-emerald-500' : 'bg-amber-500'}`}
                                    style={{ width: `${percent}%` }}
                                  ></div>
                                </div>
                                {!isPerfect && (
                                  <p className="text-[9px] font-semibold text-rose-500">
                                    *Faltariam {missingVolume.toLocaleString('pt-BR')} L para atingir a meta total neste período.
                                  </p>
                                )}
                              </div>

                              {/* Per-Product Breakdown Grid for Mix */}
                              {sug.productDetails && sug.productDetails.length > 0 && (
                                <div className="mt-2.5 pt-2 border-t border-slate-200/80 space-y-1.5">
                                  <span className="text-[9px] font-black uppercase tracking-wider text-slate-400 font-mono block">
                                    Detalhamento de Encaixe por Produto:
                                  </span>
                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                                    {sug.productDetails.map(pDetail => {
                                      const pPercent = pDetail.targetVolume > 0 
                                        ? Math.min(100, Math.round((pDetail.scheduledVolume / pDetail.targetVolume) * 100))
                                        : 100;
                                      const colorOb = COLOR_OPTIONS.find(o => o.value === pDetail.color) || COLOR_OPTIONS[0];
                                      const pMissing = pDetail.targetVolume - pDetail.scheduledVolume;

                                      return (
                                        <div key={pDetail.recipeId} className="flex items-center justify-between p-2 bg-white rounded-lg border border-slate-200/80 text-[11px] shadow-3xs">
                                          <div className="flex items-center gap-1.5 truncate mr-2">
                                            <span className={`w-2 h-2 rounded-full ${colorOb.bg} border ${colorOb.border} shrink-0`}></span>
                                            <span className="font-bold text-slate-800 truncate">{pDetail.recipeName}</span>
                                          </div>
                                          <div className="text-right font-mono text-[10px] shrink-0">
                                            <div className="font-bold text-slate-700">
                                              {pDetail.scheduledVolume.toLocaleString('pt-BR')} L <span className="text-slate-400 font-normal">/ {pDetail.targetVolume.toLocaleString('pt-BR')} L</span>
                                            </div>
                                            {pMissing > 0 ? (
                                              <span className="text-[9px] font-bold text-rose-600">
                                                Faltam: -{pMissing.toLocaleString('pt-BR')} L ({pPercent}%)
                                              </span>
                                            ) : (
                                              <span className="text-[9px] font-bold text-emerald-600">
                                                ✓ 100% ({pDetail.batchesScheduledCount} {pDetail.batchesScheduledCount === 1 ? 'lote' : 'lotes'})
                                              </span>
                                            )}
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}
                            </div>

                            <button
                              onClick={() => handleApplySuggestion(sug)}
                              className={`py-2 px-4 rounded-xl text-xs font-bold transition-all shadow-3xs hover:scale-[1.02] active:scale-[0.98] cursor-pointer shrink-0 md:self-center self-end ${
                                idx === 0
                                  ? 'bg-indigo-600 hover:bg-indigo-700 text-white'
                                  : 'bg-white border border-slate-350 hover:bg-slate-50 text-slate-700'
                              }`}
                            >
                              Aplicar e Agendar
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-slate-100 flex justify-end shrink-0 bg-slate-50">
              <button
                onClick={() => setShowAnalyseModal(false)}
                className="px-4 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-bold rounded-xl transition-all cursor-pointer shadow-3xs"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pending Shift Bypass Interactive Confirmation Modal */}
      {pendingShiftBypassModalData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs animate-fade-in font-sans">
          <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 max-w-lg w-full overflow-hidden flex flex-col max-h-[90vh]">
            {/* Header */}
            <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-amber-500/10">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-amber-500/20 text-amber-600 flex items-center justify-center font-bold">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-800">Conflito de Turnos Operacionais</h3>
                  <p className="text-[11px] text-amber-700 font-semibold">Lotes gerados fora da jornada padrão de trabalho</p>
                </div>
              </div>
              <button
                onClick={() => setPendingShiftBypassModalData(null)}
                className="text-slate-400 hover:text-slate-600 text-lg font-bold p-1 cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Content Body */}
            <div className="p-5 space-y-4 overflow-y-auto">
              <div className="p-3 bg-amber-50 border border-amber-200/60 rounded-xl text-xs text-amber-900 leading-relaxed font-medium">
                O otimizador identificou que <strong>{pendingShiftBypassModalData.outOfShiftBatches.length} lote(s)</strong> possuem etapas de inoculação ou envase em dias/horários fora dos turnos ativos da fábrica (ex: finais de semana ou horários não cadastrados).
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                  Lotes Sinalizados Fora do Turno:
                </label>
                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                  {pendingShiftBypassModalData.outOfShiftBatches.map((b) => {
                    const recipe = recipes.find(r => r.id === b.productId);
                    const envaseStep = b.steps.find(s => s.scaleType === 'Envase');
                    const err = pendingShiftBypassModalData.errors.find(e => e.lotNumber === b.lotNumber);

                    return (
                      <div key={b.id} className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1 text-xs">
                        <div className="flex items-center justify-between font-mono font-bold text-slate-800">
                          <span>{b.lotNumber} - {recipe?.name || 'Bio-Lote'}</span>
                          <span className="text-[10px] bg-amber-100 text-amber-800 px-2 py-0.5 rounded font-sans font-bold">
                            Fora de Turno
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-600">
                          <strong>Início Lote:</strong> {formatFullDate(b.startDateTime)}
                        </div>
                        {envaseStep && (
                          <div className="text-[11px] text-slate-600">
                            <strong>Previsão Envase:</strong> {formatFullDate(envaseStep.startDateTime)}
                          </div>
                        )}
                        {err && (
                          <div className="text-[10px] text-rose-600 font-semibold pt-1">
                            ⚠️ {err.reason}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <p className="text-xs text-slate-600 font-semibold text-center pt-2">
                Deseja incluir estes lotes no gráfico de Gantt (Horas Extras / Turno Flexível)?
              </p>
            </div>

            {/* Footer Buttons */}
            <div className="p-4 border-t border-slate-100 bg-slate-50 flex items-center justify-end gap-2 shrink-0">
              <button
                onClick={() => setPendingShiftBypassModalData(null)}
                className="px-4 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-bold rounded-xl transition-all cursor-pointer shadow-3xs"
              >
                Não, Descartar Fora de Turno
              </button>
              <button
                onClick={async () => {
                  const toConfirm = pendingShiftBypassModalData.outOfShiftBatches;
                  setBatches(prev => [...prev, ...toConfirm]);
                  if (databaseId) {
                    try {
                      const db = getTenantDb();
                      for (const b of toConfirm) {
                        await setDoc(doc(db, "batches", b.id), b);
                      }
                    } catch (err) {
                      console.error("Erro ao salvar lotes no Firestore:", err);
                    }
                  }
                  setPendingShiftBypassModalData(null);
                }}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-xl transition-all shadow-md cursor-pointer flex items-center gap-1.5"
              >
                <span>Sim, Programar Lotes no Gantt</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
