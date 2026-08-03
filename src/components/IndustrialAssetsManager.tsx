/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Asset, ScaleType, FactoryScaleCounts } from '../types';
import { Edit3, Plus, Trash2, RotateCcw, Check, Sliders, Database, Layers, ShieldCheck } from 'lucide-react';

interface IndustrialAssetsManagerProps {
  assets: Asset[];
  scaleCounts: FactoryScaleCounts;
  onUpdateAsset: (id: string, name: string, capacityLiters?: number) => void;
  onAddAsset: (scaleType: ScaleType, name?: string, capacityLiters?: number) => void;
  onDeleteAsset: (id: string) => void;
  onResetAssets: () => void;
}

const SCALE_LABELS: Record<ScaleType, string> = {
  'Erlenmeyer': 'Rotas Erlenmeyer',
  'Balão': 'Rotas Balão',
  '100L': 'Biorreatores 100L',
  '500L': 'Biorreatores 500L',
  '3000_5000L': 'Biorreatores 3.000L / 5.000L',
  'Envase': 'Linhas de Envase / Máquinas'
};

const SCALE_TYPES: ScaleType[] = ['Erlenmeyer', 'Balão', '100L', '500L', '3000_5000L', 'Envase'];

export default function IndustrialAssetsManager({
  assets,
  scaleCounts,
  onUpdateAsset,
  onAddAsset,
  onDeleteAsset,
  onResetAssets
}: IndustrialAssetsManagerProps) {
  const [activeScaleTab, setActiveScaleTab] = useState<ScaleType>('3000_5000L');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editCapacity, setEditCapacity] = useState<number | undefined>(undefined);

  // New asset form
  const [newName, setNewName] = useState('');
  const [newCapacity, setNewCapacity] = useState<number>(5000);
  const [showAddForm, setShowAddForm] = useState(false);

  const scaleAssets = assets.filter(a => a.scaleType === activeScaleTab);

  const handleStartEdit = (asset: Asset) => {
    setEditingId(asset.id);
    setEditName(asset.name);
    setEditCapacity(asset.capacityLiters);
  };

  const handleSaveEdit = (id: string) => {
    if (!editName.trim()) return;
    onUpdateAsset(id, editName.trim(), editCapacity);
    setEditingId(null);
  };

  const handleCreateAsset = (e: React.FormEvent) => {
    e.preventDefault();
    onAddAsset(activeScaleTab, newName.trim() || undefined, newCapacity || undefined);
    setNewName('');
    setShowAddForm(false);
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden" id="assets-manager-root">
      {/* Header */}
      <div className="p-5 border-b border-slate-100 bg-slate-50/60 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-slate-900 text-white rounded-xl shadow-xs">
            <Sliders size={18} />
          </div>
          <div>
            <h3 className="font-bold text-slate-800 text-sm uppercase tracking-wider">
              Mapeamento de Equipamentos & Nomenclatura da Planta (Multi-Cliente)
            </h3>
            <p className="text-xs text-slate-500 font-medium">
              Personalize nomes, códigos industriais (TAGs) e capacidades em Litros dos vasos de cada cliente.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            if (confirm('Deseja restaurar a nomenclatura e quantitativo padrão de equipamentos da fábrica?')) {
              onResetAssets();
            }
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-slate-600 bg-white border border-slate-250 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer shadow-3xs"
          title="Restaurar nomenclatura padrão dos reatores"
        >
          <RotateCcw size={13} /> Restaurar Padrão
        </button>
      </div>

      {/* Scale Type Tabs */}
      <div className="px-5 pt-4 border-b border-slate-100 bg-slate-50/20">
        <div className="flex flex-wrap gap-1">
          {SCALE_TYPES.map((scale) => {
            const count = assets.filter(a => a.scaleType === scale).length;
            const isActive = activeScaleTab === scale;
            return (
              <button
                key={scale}
                type="button"
                onClick={() => setActiveScaleTab(scale)}
                className={`px-3 py-2 text-xs font-bold rounded-t-xl transition-all cursor-pointer flex items-center gap-1.5 border-t border-x ${
                  isActive
                    ? 'bg-white text-slate-900 border-slate-200 border-b-white -mb-px font-extrabold shadow-3xs'
                    : 'bg-slate-100/70 text-slate-500 border-transparent hover:bg-slate-150'
                }`}
              >
                <span>{SCALE_LABELS[scale]}</span>
                <span className={`px-1.5 py-0.2 rounded text-[10px] font-mono ${
                  count > 0 ? (isActive ? 'bg-slate-900 text-white' : 'bg-slate-200 text-slate-700') : 'bg-rose-100 text-rose-700 font-extrabold'
                }`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab Content */}
      <div className="p-5 space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
            Equipamentos Ativos na Escala ({scaleAssets.length} unidade{scaleAssets.length === 1 ? '' : 's'})
          </span>

          <button
            type="button"
            onClick={() => {
              setNewName('');
              if (activeScaleTab === '3000_5000L') setNewCapacity(5000);
              else if (activeScaleTab === '500L') setNewCapacity(500);
              else if (activeScaleTab === '100L') setNewCapacity(100);
              setShowAddForm(true);
            }}
            className="flex items-center gap-1 px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-bold transition-colors cursor-pointer shadow-3xs"
          >
            <Plus size={14} /> Adicionar Reator / Linha
          </button>
        </div>

        {/* Create new asset modal inline form */}
        {showAddForm && (
          <form onSubmit={handleCreateAsset} className="p-4 bg-indigo-50/70 border border-indigo-200 rounded-xl space-y-3 animate-fadeIn">
            <div className="flex items-center justify-between border-b border-indigo-200/60 pb-2">
              <span className="text-xs font-extrabold text-indigo-900 uppercase tracking-tight flex items-center gap-1">
                <Plus size={14} /> Novo Equipamento / Linha para {SCALE_LABELS[activeScaleTab]}
              </span>
              <button
                type="button"
                onClick={() => setShowAddForm(false)}
                className="text-xs text-indigo-600 font-bold hover:text-indigo-900 cursor-pointer"
              >
                Cancelar
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-tight block">Nome / Tag Industrial</label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder={activeScaleTab === '3000_5000L' ? 'Ex: Reator F-101 ou B17' : 'Ex: Linha Envase 4'}
                  className="w-full mt-1 px-2.5 py-1.5 bg-white border border-slate-300 rounded font-semibold text-xs text-slate-800"
                  autoFocus
                />
              </div>

              {(activeScaleTab === '3000_5000L' || activeScaleTab === '500L' || activeScaleTab === '100L') && (
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-tight block">Capacidade Útil (Litros)</label>
                  <input
                    type="number"
                    min="1"
                    value={newCapacity}
                    onChange={(e) => setNewCapacity(parseInt(e.target.value) || 1000)}
                    className="w-full mt-1 px-2.5 py-1.5 bg-white border border-slate-300 rounded font-mono font-bold text-xs text-slate-800"
                  />
                </div>
              )}
            </div>

            <div className="flex justify-end pt-1">
              <button
                type="submit"
                className="px-4 py-1.5 bg-indigo-650 hover:bg-indigo-750 text-white rounded-lg text-xs font-bold transition-colors cursor-pointer"
              >
                Salvar Novo Equipamento
              </button>
            </div>
          </form>
        )}

        {/* List of assets in active scale */}
        {scaleAssets.length === 0 ? (
          <div className="p-8 text-center bg-slate-50 rounded-xl border border-dashed border-slate-250 text-slate-400 space-y-2">
            <ShieldCheck size={28} className="mx-auto text-slate-300" />
            <p className="text-xs font-semibold text-slate-600">Nenhum equipamento cadastrado nesta escala.</p>
            <p className="text-[11px] text-slate-400">Esta escala será desativada do Gantt e das receitas para este cliente.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {scaleAssets.map((asset) => {
              const isEditing = editingId === asset.id;

              return (
                <div
                  key={asset.id}
                  className={`p-3.5 rounded-xl border transition-all flex items-center justify-between gap-3 ${
                    isEditing
                      ? 'bg-amber-50/70 border-amber-300 shadow-sm'
                      : 'bg-white border-slate-200 hover:border-slate-300 shadow-3xs'
                  }`}
                >
                  {isEditing ? (
                    <div className="flex-1 space-y-2">
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="px-2 py-1 bg-white border border-amber-400 rounded font-bold text-xs text-slate-900 w-full"
                          placeholder="Nome / Tag do vaso"
                        />
                      </div>
                      {(activeScaleTab === '3000_5000L' || activeScaleTab === '500L' || activeScaleTab === '100L') && (
                        <div className="flex items-center gap-2 text-xs">
                          <span className="text-[10px] font-bold text-slate-500 uppercase">Capacidade:</span>
                          <input
                            type="number"
                            min="1"
                            value={editCapacity || ''}
                            onChange={(e) => setEditCapacity(e.target.value ? parseInt(e.target.value) : undefined)}
                            className="w-24 px-2 py-0.5 bg-white border border-amber-400 rounded font-mono font-bold text-xs"
                          />
                          <span className="text-xs font-bold text-slate-500 font-mono">L</span>
                        </div>
                      )}
                      <div className="flex items-center gap-1 pt-1">
                        <button
                          type="button"
                          onClick={() => handleSaveEdit(asset.id)}
                          className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-[10px] font-bold transition-colors cursor-pointer flex items-center gap-1"
                        >
                          <Check size={12} /> Salvar
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="px-2.5 py-1 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded text-[10px] font-bold transition-colors cursor-pointer"
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-slate-800 text-xs font-mono">{asset.name}</span>
                          {asset.capacityLiters && (
                            <span className="px-1.5 py-0.2 bg-slate-100 text-slate-600 rounded text-[10px] font-mono font-bold border border-slate-200">
                              {asset.capacityLiters.toLocaleString('pt-BR')} L
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] text-slate-400 block font-mono">ID no Sistema: {asset.id}</span>
                      </div>

                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleStartEdit(asset)}
                          className="p-1.5 text-slate-400 hover:text-indigo-650 hover:bg-indigo-50 rounded-lg transition-colors cursor-pointer"
                          title="Editar nome e capacidade do equipamento"
                        >
                          <Edit3 size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (confirm(`Deseja excluir o equipamento "${asset.name}"?`)) {
                              onDeleteAsset(asset.id);
                            }
                          }}
                          className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                          title="Excluir equipamento"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
