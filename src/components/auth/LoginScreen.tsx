import React, { useState } from 'react';
import { Database, Lock, Mail, Sparkles } from 'lucide-react';
import { supabase } from '../../lib/supabase';

interface LoginScreenProps {
  onContinueOffline: () => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ onContinueOffline }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase) return;
    setLoading(true);
    setError(null);
    try {
      const { error: authError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (authError) {
        setError(
          authError.message === 'Invalid login credentials'
            ? 'البريد الإلكتروني أو كلمة المرور غير صحيحة.'
            : authError.message
        );
      }
    } catch {
      setError('تعذر الاتصال بخادم Supabase.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F7F6F3] flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-3xl border border-[#E5E3DD] shadow-xl overflow-hidden">
        <div className="bg-[#1A1A1E] text-white px-8 py-8 text-center">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-gradient-to-br from-[#BD956D] to-[#8E6742] flex items-center justify-center shadow-md mb-4">
            <span
              className="text-white text-2xl font-semibold tracking-wider"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              DC
            </span>
          </div>
          <h1
            className="text-2xl font-semibold tracking-[0.18em]"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            DRESSCODE
          </h1>
          <p className="text-xs text-[#B4B2AA] mt-1.5">
            نظام إدارة التصنيع والمشتريات والمبيعات السحابي (PostgreSQL)
          </p>
        </div>

        <div className="p-7 space-y-5">
          <div className="flex items-center gap-2 text-xs text-[#7B5836] bg-[#FBF8F4] border border-[#E6D5C3] rounded-xl px-3.5 py-2.5">
            <Database className="w-4 h-4 text-[#A67C52] shrink-0" />
            <span>سجّل الدخول بحساب فريق DressCode للمزامنة المباشرة مع PostgreSQL.</span>
          </div>

          {error && (
            <div className="rounded-xl bg-red-50 border border-red-200 px-3.5 py-2.5 text-xs font-semibold text-red-700">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-[#1A1A1E] mb-1.5">
                البريد الإلكتروني
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-[#9C9990] absolute right-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="email"
                  required
                  dir="ltr"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@dresscode-clothing.com"
                  className="w-full rounded-xl border border-[#E5E3DD] bg-[#FAF9F7] pr-10 pl-3.5 py-2.5 text-sm text-left focus:outline-none focus:border-[#A67C52]"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#1A1A1E] mb-1.5">
                كلمة المرور
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-[#9C9990] absolute right-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="password"
                  required
                  dir="ltr"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full rounded-xl border border-[#E5E3DD] bg-[#FAF9F7] pr-10 pl-3.5 py-2.5 text-sm text-left focus:outline-none focus:border-[#A67C52]"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-[#1A1A1E] hover:bg-[#2E2E35] text-white text-sm font-bold py-3 transition-colors cursor-pointer disabled:opacity-60"
            >
              {loading ? 'جاري تسجيل الدخول...' : 'تسجيل الدخول إلى النظام'}
            </button>
          </form>

          <div className="pt-3 border-t border-[#F0EFEA] text-center">
            <button
              type="button"
              onClick={onContinueOffline}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#6E6C66] hover:text-[#8E6742] cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5 text-[#A67C52]" />
              <span>أو المتابعة في الوضع المحلي التجريبي (LocalStorage)</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
