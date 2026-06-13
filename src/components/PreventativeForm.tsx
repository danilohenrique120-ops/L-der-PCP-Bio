/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Preventative, getAssetsPool, normalizeAssetId } from '../types';
import { formatFullDate } from '../utils/timeline';
import { ShieldX, Trash2, CalendarCheck, HelpCircle } from 'lucide-react';

interface PreventativeFormProps {
  preventatives: Preventative[];
  onAddPreventative: (prev: Preventative) => void;
  onDeletePreventative: (id: string) => void;
  envaseLinesCount: number;
}

export default function PreventativeForm({ preventatives, onAddPreventative, onDeletePreventative, envaseLinesCount }: PreventativeFormProps) {
  const assetsList = getAssetsPool(envaseLinesCount);
  const [assetId, setAssetId] = useState(assetsList[0].id);
  const [description, setDescription] = useState('CRONOGRAMA DE PREVENTIVA');
  const [startDate, setStartDate] = useState('2026-06-05');
  const [startTime, setStartTime] = useState('08:00');
  const [endDate, setEndDate] = useState('2026-06-07');
  const [endTime, setEndTime] = useState('18:00');
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');

    const startISO = new Date(`${startDate}T${startTime}:00`);
    const endISO = new Date(`${endDate}T${endTime}:00`);

    if (isNaN(startISO.getTime()) || isNaN(endISO.getTime())) {
      setErrorMsg('Datas e Horas inválidas.');
      return;
    }

    if (endISO.getTime() <= startISO.getTime()) {
      setErrorMsg('A Data/Hora de término deve ser posterior à Data/Hora de início.');
      return;
    }

    if (!description.trim()) {
      setErrorMsg('Por favor, informe um motivo / descrição para a preventiva.');
      return;
    }

    const newPreventative: Preventative = {
      id: 'prev-' + Date.now(),
      assetId,
      description: description.trim().toUpperCase(),
      startDateTime: startISO.toISOString(),
      endDateTime: endISO.toISOString()
    };

    onAddPreventative(newPreventative);
    setSuccessMsg('Bloqueio de Preventiva adicionado ao cronograma.');
    
    // Reset to defaults
    setDescription('MANUTENÇÃO PREVENTIVA');
  };

  return (
    <div className="space-y-6" id="preventatives-container">
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-800" id="prev-tab-title">Gestão de Preventivas e Indisponibilidade de Ativos</h2>
        <p className="text-xs text-slate-500 font-medium">Bloqueie ativos manuais para manutenção física. O PCP recusará agendar lotes nestes reatores durante tais janelas.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Input Card */}
        <div className="lg:col-span-5 bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-6" id="add-preventative-form">
          <div className="border-b border-slate-100 pb-3 flex items-center gap-2">
            <ShieldX className="text-slate-800" size={18} />
            <span className="font-semibold text-slate-800 text-sm uppercase tracking-wide">Novo Bloqueio Preventivo</span>
          </div>

          <form onSubmit={handleAdd} className="space-y-4">
            {/* Select Asset */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">Ativo Alvo (Vaso/Rota)</label>
              <select
                value={assetId}
                onChange={(e) => setAssetId(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-800 transition-shadow cursor-pointer"
              >
                {assetsList.map(a => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.categoryLabel})
                  </option>
                ))}
              </select>
            </div>

            {/* Title / Description */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">Descrição do Bloqueio</label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Ex: PREVENTIVA TRIMESTRAL, LIMPEZA QUÍMICA, REFORMA"
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm uppercase font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-800 transition-shadow"
                required
              />
            </div>

            {/* Start Date/Time */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">Início Bloqueio</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-medium focus:outline-none focus:ring-2"
                  required
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">Hora Início</label>
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-medium focus:outline-none focus:ring-2"
                  required
                />
              </div>
            </div>

            {/* End Date/Time */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">Término Bloqueio</label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-medium focus:outline-none focus:ring-2"
                  required
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">Hora Término</label>
                <input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-medium focus:outline-none focus:ring-2"
                  required
                />
              </div>
            </div>

            {errorMsg && (
              <div className="p-3 bg-rose-50 text-rose-600 text-xs rounded-lg border border-rose-100 font-semibold leading-relaxed">
                {errorMsg}
              </div>
            )}

            {successMsg && (
              <div className="p-3 bg-emerald-50 text-emerald-600 text-xs rounded-lg border border-emerald-100 font-semibold select-none">
                {successMsg}
              </div>
            )}

            <button
              type="submit"
              className="w-full py-3 bg-slate-900 border border-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-bold shadow-sm transition-all cursor-pointer block uppercase tracking-wider"
            >
              Confirmar Bloqueio de Ativo
            </button>
          </form>
        </div>

        {/* Existing Preventatives List */}
        <div className="lg:col-span-7 bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4" id="preventatives-manager-list">
          <div className="border-b border-slate-100 pb-3">
            <h3 className="font-semibold text-slate-800 text-sm uppercase tracking-wide">Janelas Ativas de Bloqueio</h3>
          </div>

          {preventatives.length > 0 ? (
            <div className="space-y-3 max-h-[480px] overflow-y-auto pr-1">
              {preventatives.map((prev) => {
                const associatedAsset = assetsList.find(a => a.id === normalizeAssetId(prev.assetId, envaseLinesCount));

                return (
                  <div
                    key={prev.id}
                    className="flex items-center justify-between p-3 bg-slate-950 text-white rounded-xl border border-slate-800 transition-all shadow-sm group hover:border-slate-700"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] uppercase font-bold bg-white text-slate-950 font-mono px-1.5 py-0.5 rounded leading-none">
                          {associatedAsset?.name || prev.assetId}
                        </span>
                        <span className="font-semibold text-xs text-slate-100 tracking-tight uppercase">
                          {prev.description}
                        </span>
                      </div>

                      <div className="text-[10px] font-mono text-slate-400">
                        De {formatFullDate(prev.startDateTime)} até {formatFullDate(prev.endDateTime)}
                      </div>
                    </div>

                    <button
                      onClick={() => onDeletePreventative(prev.id)}
                      className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-md transition-colors cursor-pointer"
                      title="Apagar bloqueio"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-16 text-slate-400 text-xs">
              Nenhuma preventiva programada na linha temporal.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
