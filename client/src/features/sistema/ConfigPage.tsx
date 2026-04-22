import React from 'react';
import { Settings, ExternalLink, Info } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';

export const ConfigPage: React.FC = () => (
  <>
    <PageHeader title="Configuração" subtitle="Parâmetros do dashboard · variáveis operacionais ficam no Intelligence V1" />
    <div className="p-6 flex-1 min-h-0 overflow-y-auto">
      <div className="max-w-2xl space-y-4">
        <div className="flex gap-3 p-4 bg-indigo-50 border border-indigo-200 rounded-xl text-sm">
          <Info className="w-5 h-5 text-indigo-600 flex-shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold text-indigo-900 mb-1">Configurações da Mari</div>
            <div className="text-indigo-700 leading-relaxed">
              O Dashboard V5 é um painel de supervisão. Para editar <strong>identidade, tom, modelos IA, preços</strong> e
              outras configurações da Mari, use o <strong>Intelligence V1</strong>.
            </div>
            <a href="http://localhost:3471" target="_blank" rel="noopener"
              className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-800">
              Abrir Intelligence V1 <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-4">
            <Settings className="w-4 h-4 text-slate-500" />
            <div className="font-semibold text-slate-900">Sobre este painel</div>
          </div>
          <div className="space-y-2 text-sm">
            <Linha label="Versão" valor="Dashboard V5" />
            <Linha label="Porta" valor="3452" />
            <Linha label="Domínio" valor="dashv5.plamevbrasil.com.br" />
            <Linha label="Banco" valor="mariv3 (operacional) + mari_intelligence (auditoria)" />
            <Linha label="Stack" valor="Express + Socket.IO + React + Vite + Tailwind v4 + shadcn/ui" />
          </div>
        </div>
      </div>
    </div>
  </>
);

const Linha: React.FC<{ label: string; valor: string }> = ({ label, valor }) => (
  <div className="flex gap-3 text-xs">
    <span className="text-slate-500 min-w-[100px]">{label}</span>
    <span className="text-slate-800 font-medium flex-1 break-words">{valor}</span>
  </div>
);
