/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { ProductRecipe, Batch, Preventative, COLOR_OPTIONS, ScaleType, ShiftConfig, PlanningErrorLog, Shift, DeviationLog } from './types';
import { INITIAL_RECIPES, INITIAL_PREVENTATIVES, getInitialBatches } from './data/mockData';
import { areIntervalsOverlapping, generateAutomaticPlanning, calculateProductionTimeline, formatFullDate } from './utils/timeline';
import GanttTimeline from './components/GanttTimeline';
import { User, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "firebase/auth";
import { collection, getDocs, doc, setDoc, getDoc, deleteDoc } from "firebase/firestore";
import { auth, getTenantDb } from "./firebase";
import BatchForm from './components/BatchForm';
import ProductForm from './components/ProductForm';
import PreventativeForm from './components/PreventativeForm';
import { AlertTriangle, Calendar, PlayCircle, Layers, ShieldX, HelpCircle, AlertOctagon, CheckCircle, BarChart3, Database, RefreshCw, XCircle, Trash2, Clock, CalendarDays, Sliders, ChevronUp, ChevronDown } from 'lucide-react';
import { getAssetsPool, normalizeAssetId } from './types';

export default function App() {
  // Tabs: 'gantt' | 'batch' | 'product' | 'preventatives' | 'deviations'
  const [activeTab, setActiveTab] = useState<'gantt' | 'batch' | 'product' | 'preventatives' | 'deviations'>('gantt');

  // Core application states loaded from Firestore multi-tenant configs
  const [recipes, setRecipes] = useState<ProductRecipe[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [preventatives, setPreventatives] = useState<Preventative[]>([]);
  const [deviations, setDeviations] = useState<DeviationLog[]>([]);
  const [envaseLinesCount, setEnvaseLinesCount] = useState<number>(3);
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
        const initialBatches = getInitialBatches();
        for (const b of initialBatches) {
          await setDoc(doc(tenantDb, "batches", b.id), b);
        }
        setBatches(initialBatches);
      } else {
        setBatches(batchesList);
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

    const result = generateAutomaticPlanning(
      recipe,
      targetVolume,
      plannerStart,
      batches,
      preventatives,
      shiftConfig,
      setupTimes,
      envaseLinesCount
    );

    if (result.scheduledBatches.length > 0) {
      setBatches(prev => [...prev, ...result.scheduledBatches]);
      if (databaseId) {
        try {
          const db = getTenantDb();
          for (const b of result.scheduledBatches) {
            await setDoc(doc(db, "batches", b.id), b);
          }
        } catch (err) {
          console.error("Erro ao salvar lotes automáticos no Firestore:", err);
        }
      }
    }

    if (result.errors.length > 0) {
      setPlanningErrors(result.errors);
    } else {
      setPlanningErrors([]);
    }
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
    let allNewBatches: Batch[] = [];
    let allErrors: PlanningErrorLog[] = [];

    sortedItems.forEach((mixItem) => {
      const recipe = recipes.find(r => r.id === mixItem.productId);
      if (!recipe) return;

      const result = generateAutomaticPlanning(
        recipe,
        mixItem.volume,
        plannerStart,
        activePool,
        preventatives,
        shiftConfig,
        setupTimes,
        envaseLinesCount
      );

      if (result.scheduledBatches.length > 0) {
        allNewBatches.push(...result.scheduledBatches);
        activePool.push(...result.scheduledBatches);
      }

      if (result.errors.length > 0) {
        allErrors.push(...result.errors);
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
          console.error("Erro ao salvar lotes do mix no Firestore:", err);
        }
      }
    }

    if (allErrors.length > 0) {
      setPlanningErrors(allErrors);
    } else {
      setPlanningErrors([]);
    }
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
              Acesso ao System
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
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 hover:border-slate-600 focus:border-indigo-500 rounded-xl text-xs font-semibold text-white focus:outline-none transition-all placeholder:text-slate-500"
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
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 hover:border-slate-600 focus:border-indigo-500 rounded-xl text-xs font-semibold text-white focus:outline-none transition-all placeholder:text-slate-500"
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
            <button
              onClick={handleClearAllData}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-750 text-slate-350 hover:text-white rounded-lg text-xs font-semibold border border-slate-700 transition-colors flex items-center gap-1 cursor-pointer"
              title="Resetar dados para exemplo de fábrica padrão"
            >
              <Database size={13} /> Resetar Fábrica Exemplo
            </button>
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
                  <div className="flex border-b border-slate-100 pb-2 mb-3 gap-4">
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
                      {/* Active Envaser Machines Pool count */}
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Estações de Envase Ativas (Recorrente)</label>
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min="1"
                            max="10"
                            value={envaseLinesCount}
                            onChange={(e) => {
                              const val = Math.max(1, Math.min(10, parseInt(e.target.value) || 1));
                              setEnvaseLinesCount(val);
                            }}
                            className="w-20 px-2 text-center py-1 bg-slate-50 border border-slate-205 rounded-lg text-xs font-mono font-bold text-slate-800 focus:outline-none"
                          />
                          <span className="text-[11px] font-medium text-slate-500 leading-normal">linhas de envase paralelas disponíveis para Quality.</span>
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

              </div>
              )}

              {/* FINITE PLANNING ERROR LOG MESSAGES */}
              {planningErrors.length > 0 && (
                <div className="bg-rose-50 border border-rose-200 text-rose-800 rounded-2xl p-4 md:p-5 space-y-2 animate-fadeIn" id="pcp-planning-errors">
                  <div className="flex items-center gap-2 text-rose-700 font-extrabold text-xs uppercase tracking-wider">
                    <AlertOctagon size={16} />
                    <span>Gargalos PCP: {planningErrors.length} Lote(s) não puderam ser programados (Restrição de Turno/Capacidades)</span>
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
                      {deviations.filter(d => d.type === 'contaminação').length}
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
                      {deviations.filter(d => d.type === 'atraso / reprogramado').length}
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
                      {deviations.filter(d => d.type === 'troca de rota').length}
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
                      let typeBadge = '';
                      if (dev.type === 'contaminação') typeBadge = 'bg-rose-50 text-rose-700 border-rose-200';
                      else if (dev.type === 'atraso / reprogramado') typeBadge = 'bg-amber-50 text-amber-700 border-amber-250';
                      else if (dev.type === 'troca de rota') typeBadge = 'bg-indigo-50 text-indigo-700 border-indigo-250';

                      let categoryBadge = '';
                      if (dev.category === 'Biológico') categoryBadge = 'bg-teal-50 border border-teal-200 text-teal-800';
                      else if (dev.category === 'Mecânico') categoryBadge = 'bg-cyan-50 border border-cyan-200 text-cyan-800';
                      else if (dev.category === 'Operacional') categoryBadge = 'bg-slate-50 border border-slate-200 text-slate-705';

                      return (
                        <div key={dev.id} className="py-4 flex flex-col md:flex-row md:items-start justify-between gap-4 font-sans text-xs">
                          <div className="space-y-1.5 flex-1 pr-4">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className={`px-2 py-0.5 rounded-full text-[9px] font-extrabold uppercase border ${typeBadge}`}>
                                {dev.type}
                              </span>
                              <span className={`px-2 py-0.5 rounded text-[9px] font-bold ${categoryBadge}`}>
                                {dev.category}
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
                            <span>ID: {dev.id}</span>
                            <span>Registro Automático</span>
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
    </div>
  );
}
