/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { ProductRecipe, StepDefinition, ScaleType, COLOR_OPTIONS } from '../types';
import { Plus, Trash2, ArrowUp, ArrowDown, Edit3, Check, RotateCcw } from 'lucide-react';

interface ProductFormProps {
  recipes: ProductRecipe[];
  onSaveRecipe: (recipe: ProductRecipe) => void;
  onDeleteRecipe: (id: string) => void;
}

const SCALE_TYPES_LIST: ScaleType[] = [
  'Erlenmeyer',
  'Balão',
  '100L',
  '500L',
  '3000_5000L',
  'Envase'
];

export default function ProductForm({ recipes, onSaveRecipe, onDeleteRecipe }: ProductFormProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [color, setColor] = useState('blue');
  const [yieldPerBatch, setYieldPerBatch] = useState<number>(3000);
  const [steps, setSteps] = useState<StepDefinition[]>([]);
  const [errorMsg, setErrorMsg] = useState('');

  // RCCP settings
  const [fermentationTimeHours, setFermentationTimeHours] = useState<number>(72);
  const [cipSipTimeHours, setCipSipTimeHours] = useState<number>(8);
  const [chargeDischargeTimeHours, setChargeDischargeTimeHours] = useState<number>(4);
  const [batchVolume, setBatchVolume] = useState<number>(5000);

  // Start creating/editing a recipe
  const handleStartNew = () => {
    setEditingId('new');
    setName('');
    setColor('blue');
    setYieldPerBatch(4000);
    setSteps([
      { id: 'step-' + Date.now() + '-1', scaleType: 'Erlenmeyer', durationHours: 24 },
      { id: 'step-' + Date.now() + '-2', scaleType: 'Balão', durationHours: 24 },
      { id: 'step-' + Date.now() + '-3', scaleType: '100L', durationHours: 48 },
      { id: 'step-' + Date.now() + '-4', scaleType: '500L', durationHours: 48 },
      { id: 'step-' + Date.now() + '-5', scaleType: '3000_5000L', durationHours: 72 },
      { id: 'step-' + Date.now() + '-6', scaleType: 'Envase', durationHours: 12 },
    ]);
    setFermentationTimeHours(72);
    setCipSipTimeHours(8);
    setChargeDischargeTimeHours(4);
    setBatchVolume(5000);
    setErrorMsg('');
  };

  const handleStartEdit = (recipe: ProductRecipe) => {
    setEditingId(recipe.id);
    setName(recipe.name);
    setColor(recipe.color);
    setYieldPerBatch(recipe.yieldPerBatch || 3000);
    setSteps([...recipe.steps]);
    setFermentationTimeHours(recipe.fermentationTimeHours || 72);
    setCipSipTimeHours(recipe.cipSipTimeHours || 8);
    setChargeDischargeTimeHours(recipe.chargeDischargeTimeHours || 4);
    setBatchVolume(recipe.batchVolume || recipe.yieldPerBatch || 5000);
    setErrorMsg('');
  };

  const handleAddStep = () => {
    const defaultScale: ScaleType = '100L';
    setSteps([
      ...steps,
      { id: 'step-' + Date.now() + '-' + steps.length, scaleType: defaultScale, durationHours: 24 }
    ]);
  };

  const handleRemoveStep = (idx: number) => {
    setSteps(steps.filter((_, i) => i !== idx));
  };

  const handleStepChange = (idx: number, fields: Partial<StepDefinition>) => {
    const updated = [...steps];
    updated[idx] = { ...updated[idx], ...fields };
    setSteps(updated);
  };

  const handleMoveStep = (idx: number, direction: 'up' | 'down') => {
    if (direction === 'up' && idx === 0) return;
    if (direction === 'down' && idx === steps.length - 1) return;

    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    const updated = [...steps];
    const temp = updated[idx];
    updated[idx] = updated[targetIdx];
    updated[targetIdx] = temp;
    setSteps(updated);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    if (!name.trim()) {
      setErrorMsg('O nome do produto é obrigatório.');
      return;
    }

    if (yieldPerBatch <= 0) {
      setErrorMsg('O rendimento por lote deve ser maior que zero.');
      return;
    }

    if (steps.length === 0) {
      setErrorMsg('A receita deve conter pelo menos uma etapa.');
      return;
    }

    for (const step of steps) {
      if (step.durationHours <= 0) {
        setErrorMsg('Todas as etapas devem ter tempo de permanência maior que zero horas.');
        return;
      }
    }

    const finalId = editingId === 'new' ? 'rec-' + Date.now() : (editingId as string);

    onSaveRecipe({
      id: finalId,
      name: name.trim(),
      color,
      yieldPerBatch,
      steps,
      fermentationTimeHours,
      cipSipTimeHours,
      chargeDischargeTimeHours,
      batchVolume
    });

    setEditingId(null);
    setName('');
    setYieldPerBatch(3000);
    setSteps([]);
    setFermentationTimeHours(72);
    setCipSipTimeHours(8);
    setChargeDischargeTimeHours(4);
    setBatchVolume(5000);
  };

  return (
    <div className="space-y-6" id="product-form-container">
      <div className="flex justify-between items-center bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
        <div>
          <h2 className="text-lg font-semibold text-slate-800" id="recipe-tab-title">Cadastro de Receitas de Produtos</h2>
          <p className="text-xs text-slate-500">Defina o fluxo de scale-up e tempos de permanência em cada escala.</p>
        </div>
        {!editingId && (
          <button
            onClick={handleStartNew}
            id="btn-new-recipe"
            className="flex items-center gap-2 bg-slate-900 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <Plus size={16} /> Nova Receita / Produto
          </button>
        )}
      </div>

      {editingId ? (
        <form onSubmit={handleSave} className="bg-white rounded-xl border border-slate-200 shadow-sm" id="recipe-editor-form">
          {/* Header */}
          <div className="flex justify-between items-center px-6 py-4 border-b border-slate-100 bg-slate-50/50 rounded-t-xl">
            <h3 className="font-semibold text-slate-800">
              {editingId === 'new' ? 'Criar Nova Receita' : `Editando Receita: ${name}`}
            </h3>
            <button
              type="button"
              onClick={() => setEditingId(null)}
              className="text-slate-400 hover:text-slate-600 text-sm font-medium transition-colors cursor-pointer"
            >
              Cancelar
            </button>
          </div>

          <div className="p-6 space-y-6">
            {errorMsg && (
              <div className="p-3 bg-rose-50 text-rose-600 text-xs rounded-lg border border-rose-100 font-medium" id="recipe-error-msg">
                {errorMsg}
              </div>
            )}

            {/* Basic Info */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="space-y-2 col-span-1">
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">Nome do Produto</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex: SOJA POWER, PREMIER MAX, BACILLUS R0"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-800 transition-shadow"
                  required
                />
              </div>

              <div className="space-y-2 col-span-1">
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">Rendimento por Lote (L / Doses)</label>
                <input
                  type="number"
                  min="1"
                  value={yieldPerBatch}
                  onChange={(e) => setYieldPerBatch(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-800 transition-shadow"
                  required
                />
              </div>

              <div className="space-y-2 col-span-1">
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">ID Visual no Gantt (Cor)</label>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {COLOR_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setColor(opt.value)}
                      className={`w-7 h-7 rounded-full ${opt.bg} flex items-center justify-center border transition-all cursor-pointer ${
                        color === opt.value ? 'border-amber-400 scale-110 shadow' : 'border-slate-200 hover:scale-105'
                      }`}
                      title={opt.label}
                    >
                      {color === opt.value && <Check size={12} className="text-white" />}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* RCCP Capacity Parameters Grid Section */}
            <div className="bg-slate-50/50 border border-slate-200 rounded-2xl p-4 space-y-4">
              <span className="text-[10px] font-extrabold text-slate-650 uppercase tracking-wider block border-b border-slate-200 pb-1.5">
                Parâmetros de Capacidade do Biorreator (RCCP)
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-450 uppercase tracking-widest block">Volume Nominal Lote (L)</label>
                  <input
                    type="number"
                    min="1"
                    value={batchVolume}
                    onChange={(e) => setBatchVolume(Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-mono font-bold text-slate-700 focus:outline-none"
                    required
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-450 uppercase tracking-widest block">Tempo Reação (hs)</label>
                  <input
                    type="number"
                    min="0"
                    value={fermentationTimeHours}
                    onChange={(e) => setFermentationTimeHours(Math.max(0, parseInt(e.target.value) || 0))}
                    className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-mono font-bold text-slate-700 focus:outline-none"
                    required
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-450 uppercase tracking-widest block">Tempo CIP / SIP (hs)</label>
                  <input
                    type="number"
                    min="0"
                    value={cipSipTimeHours}
                    onChange={(e) => setCipSipTimeHours(Math.max(0, parseInt(e.target.value) || 0))}
                    className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-mono font-bold text-slate-700 focus:outline-none"
                    required
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-450 uppercase tracking-widest block">Carga / Descarga (hs)</label>
                  <input
                    type="number"
                    min="0"
                    value={chargeDischargeTimeHours}
                    onChange={(e) => setChargeDischargeTimeHours(Math.max(0, parseInt(e.target.value) || 0))}
                    className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-mono font-bold text-slate-700 focus:outline-none"
                    required
                  />
                </div>
              </div>
            </div>

            {/* Steps Section */}
            <div className="space-y-4">
              <div className="flex justify-between items-center border-b border-slate-100 pb-2">
                <span className="text-xs font-bold text-slate-600 uppercase tracking-wider">Sequenciamento das Etapas de Scale-up</span>
                <span className="text-xs text-slate-400">Arranjo sequencial do menor para o maior volume</span>
              </div>

              <div className="space-y-3" id="recipe-steps-list">
                {steps.map((step, index) => {
                  return (
                    <div
                      key={step.id}
                      className="flex flex-col md:flex-row md:items-center gap-3 p-3 bg-slate-50 rounded-xl border border-slate-150 relative transition-all"
                    >
                      {/* Badge representativo da ordem */}
                      <div className="flex items-center gap-2">
                        <span className="w-6 h-6 flex items-center justify-center rounded-full bg-slate-200 text-slate-600 font-mono text-xs font-bold">
                          {index + 1}
                        </span>
                        <span className="text-xs font-semibold text-slate-500 md:hidden">Etapa {index + 1}</span>
                      </div>

                      {/* Escala */}
                      <div className="flex-1 min-w-[140px] space-y-1">
                        <label className="text-[10px] uppercase font-bold text-slate-400 block md:hidden">Escala/Etapa</label>
                        <select
                          value={step.scaleType}
                          onChange={(e) => handleStepChange(index, { scaleType: e.target.value as ScaleType })}
                          className="w-full px-2 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-medium focus:outline-none"
                        >
                          {SCALE_TYPES_LIST.map(type => (
                            <option key={type} value={type}>
                              {type === '3000_5000L' ? 'Tanque 3000L/5000L' : type === 'Envase' ? 'Linha Envase / Quality' : type}
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Tempo */}
                      <div className="w-full md:w-36 space-y-1">
                        <label className="text-[10px] uppercase font-bold text-slate-400 block md:hidden">Permanência (Horas)</label>
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min="1"
                            value={step.durationHours || ''}
                            onChange={(e) => handleStepChange(index, { durationHours: Math.max(0, parseInt(e.target.value) || 0) })}
                            className="w-full px-2 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-mono font-medium focus:outline-none"
                            placeholder="Horas"
                          />
                          <span className="text-xs text-slate-500">horas</span>
                        </div>
                      </div>

                      {/* Reordenação e Ações */}
                      <div className="flex items-center justify-end gap-1 ml-auto pt-2 md:pt-0 border-t md:border-t-0 border-slate-150">
                        {/* Up */}
                        <button
                          type="button"
                          onClick={() => handleMoveStep(index, 'up')}
                          disabled={index === 0}
                          className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-white rounded border border-transparent disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
                          title="Mover acima"
                        >
                          <ArrowUp size={14} />
                        </button>
                        {/* Down */}
                        <button
                          type="button"
                          onClick={() => handleMoveStep(index, 'down')}
                          disabled={index === steps.length - 1}
                          className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-white rounded border border-transparent disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
                          title="Mover abaixo"
                        >
                          <ArrowDown size={14} />
                        </button>
                        {/* Delete */}
                        <button
                          type="button"
                          onClick={() => handleRemoveStep(index)}
                          className="p-1.5 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded border border-transparent ml-2 cursor-pointer"
                          title="Apagar Etapa"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={handleAddStep}
                className="flex items-center justify-center gap-1.5 w-full py-2.5 border-2 border-dashed border-slate-200 hover:border-slate-300 rounded-lg text-xs font-medium text-slate-500 hover:text-slate-600 bg-slate-50 hover:bg-slate-100/50 transition-colors cursor-pointer"
              >
                <Plus size={14} /> Adicionar Etapa Intermediária
              </button>
            </div>
          </div>

          {/* Footer Save Row */}
          <div className="flex justify-end gap-3 px-6 py-4 bg-slate-50 border-t border-slate-100 rounded-b-xl">
            <button
              type="button"
              onClick={() => setEditingId(null)}
              className="px-4 py-2 border border-slate-200 rounded-lg text-xs font-medium text-slate-600 bg-white hover:bg-slate-50 transition-colors cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="flex items-center gap-1 px-5 py-2 bg-slate-900 text-white rounded-lg text-xs font-medium hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <Check size={14} /> Salvar Configuração de Produto
            </button>
          </div>
        </form>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6" id="recipes-catalog">
          {recipes.map((recipe) => {
            const recipeColorObj = COLOR_OPTIONS.find(o => o.value === recipe.color) || COLOR_OPTIONS[0];
            const totalHours = recipe.steps.reduce((acc, step) => acc + step.durationHours, 0);

            return (
              <div
                key={recipe.id}
                className="bg-white rounded-xl border border-slate-200/80 shadow-sm overflow-hidden flex flex-col group hover:border-slate-300 hover:shadow-md transition-all"
              >
                {/* Visual Color Bar Indicator */}
                <div className={`h-2 ${recipeColorObj.bg}`} />

                <div className="p-5 flex-1 flex flex-col">
                  <div className="flex justify-between items-start gap-2 mb-2">
                    <div>
                      <h4 className="font-semibold text-slate-800 group-hover:text-slate-950 transition-colors">{recipe.name}</h4>
                      <div className="flex flex-col gap-1 mt-1">
                        <div className="flex gap-1 bg-slate-50 border border-slate-100 p-1 rounded items-center">
                          <span className="text-[9px] font-mono text-slate-400 uppercase tracking-wide">ID: {recipe.id}</span>
                          <span className="text-slate-300">|</span>
                          <span className="text-[9px] font-bold text-emerald-600">
                            Rend: {recipe.yieldPerBatch?.toLocaleString('pt-BR') || '3.000'} L
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-1 bg-indigo-50/20 border border-indigo-100/30 p-1.5 rounded text-[9px] font-medium text-slate-500 font-mono">
                          <div>Vol: <span className="font-bold text-slate-700">{recipe.batchVolume || recipe.yieldPerBatch || 0}L</span></div>
                          <div>Ferm: <span className="font-bold text-slate-700">{recipe.fermentationTimeHours || 0}h</span></div>
                          <div>CIP: <span className="font-bold text-slate-700">{recipe.cipSipTimeHours || 0}h</span></div>
                          <div>C/D: <span className="font-bold text-slate-700">{recipe.chargeDischargeTimeHours || 0}h</span></div>
                        </div>
                      </div>
                    </div>
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono font-medium bg-slate-100 text-slate-600">
                      {totalHours}h Totais
                    </span>
                  </div>

                  <div className="mt-4 flex-1">
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Sequência de Multiplicação</p>
                    <div className="space-y-1.5">
                      {recipe.steps.map((st, i) => (
                        <div key={st.id} className="flex justify-between items-center text-xs text-slate-600 bg-slate-50/70 p-1.5 rounded border border-slate-100 hover:bg-slate-50">
                          <div className="flex items-center gap-2">
                            <span className="w-4 h-4 rounded-full bg-slate-200 flex items-center justify-center text-[9px] font-bold text-slate-600 font-mono">
                              {i + 1}
                            </span>
                            <span className="font-medium text-slate-700">
                              {st.scaleType === '3000_5000L' ? 'Tanque 3000/5000L' : st.scaleType === 'Envase' ? 'Envase / Quality' : st.scaleType}
                            </span>
                          </div>
                          <span className="font-mono text-slate-500 font-medium">{st.durationHours}h</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="mt-6 pt-4 border-t border-slate-100 flex justify-end gap-2 text-xs">
                    <button
                      onClick={() => handleStartEdit(recipe)}
                      className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-250 text-slate-600 bg-white hover:bg-slate-50 rounded-md font-medium transition-colors cursor-pointer"
                    >
                      <Edit3 size={12} /> Editar
                    </button>
                    {recipes.length > 1 && (
                      <button
                        onClick={() => onDeleteRecipe(recipe.id)}
                        className="flex items-center gap-1.5 px-3 py-1.5 border border-rose-100 text-rose-600 bg-white hover:bg-rose-50 rounded-md font-medium transition-colors cursor-pointer"
                      >
                        <Trash2 size={12} /> Apagar
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
