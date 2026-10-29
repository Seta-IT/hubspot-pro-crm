import React from 'react';

/** Moldura visual padrao das telas publicas de autenticacao (mesmo layout do /login). */
export default function AuthCardShell(props: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#0d2b4e] flex flex-col items-center justify-center p-4 sm:p-6 text-slate-800">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
        <div className="px-6 py-6 bg-[#213343] text-white flex flex-col items-center text-center">
          <div className="px-3 h-10 rounded-md bg-white flex items-center justify-center gap-1.5 shadow-sm mb-3">
            <span className="font-semibold text-[#0d2b4e] text-base tracking-tight">SETA</span>
            <span className="w-[2px] h-4 bg-[#f26522] inline-block" />
            <span className="font-semibold text-[#f26522] text-base tracking-tight">IT</span>
          </div>
          <h1 className="text-lg font-semibold tracking-tight">{props.title}</h1>
          <p className="text-xs text-slate-300 mt-1">{props.subtitle}</p>
        </div>
        <div className="p-6 space-y-5">{props.children}</div>
      </div>
    </div>
  );
}

export const AUTH_INPUT_CLASS =
  'w-full px-4 py-2.5 rounded-xl border border-slate-300 text-xs font-semibold text-slate-900 focus:outline-none focus:border-[#0d2b4e]';
export const AUTH_BUTTON_CLASS =
  'w-full py-3 rounded-xl bg-[#ff7a59] hover:bg-[#e86646] text-white text-sm font-semibold shadow-md flex items-center justify-center gap-2 cursor-pointer transition disabled:opacity-50';
