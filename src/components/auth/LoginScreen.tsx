import React, { useState } from 'react';
import { CheckCircle2, Database, Lock, Mail, Sparkles, UserPlus } from 'lucide-react';
import { supabase } from '../../lib/supabase';

interface LoginScreenProps {
  onContinueOffline: () => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ onContinueOffline }) => {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase) return;
    setLoading(true);
    setError(null);
    setInfo(null);
    try {
      if (mode === 'signup') {
        if (password.length < 6) {
          setError('يجب أن تكون كلمة المرور 6 أحرف على الأقل.');
          return;
        }
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
        });
        if (signUpError) {
          setError(signUpError.message);
          return;
        }
        if (data.session) {
          // Signed in automatically (email confirmation disabled)
          return;
        }
        setInfo(
          'تم إنشاء الحساب بنجاح! افتح بريدك الإلكتروني واضغط على رابط التفعيل من Supabase، ثم عد وسجّل الدخول.'
        );
        setMode('signin');
      } else {
        const { error: authError } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (authError) {
          if (authError.message === 'Invalid login credentials') {
            setError(
              'البريد الإلكتروني أو كلمة المرور غير صحيحة. إذا لم تنشئ حساباً بعد، اختر "إنشاء حساب جديد".'
            );
          } else if (authError.message.toLowerCase().includes('email not confirmed')) {
            setError(
              'يرجى تفعيل حسابك أولاً من خلال الضغط على رابط التفعيل المرسل إلى بريدك الإلكتروني.'
            );
          } else {
            setError(authError.message);
          }
        }
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
        <div className="bg-[#1A1A1E] text-white px-8 py-7 text-center">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-gradient-to-br from-[#BD956D] to-[#8E6742] flex items-center justify-center shadow-md mb-3.5">
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
          {/* Sign In / Sign Up Switch */}
          <div className="grid grid-cols-2 gap-1.5 rounded-xl bg-[#F3F2EE] p-1">
            <button
              type="button"
              onClick={() => {
                setMode('signin');
                setError(null);
              }}
              className={`py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                mode === 'signin'
                  ? 'bg-[#1A1A1E] text-white shadow-sm'
                  : 'text-[#6E6C66] hover:text-[#1A1A1E]'
              }`}
            >
              تسجيل الدخول
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('signup');
                setError(null);
                setInfo(null);
              }}
              className={`py-2 rounded-lg text-xs font-bold transition-all cursor-pointer inline-flex items-center justify-center gap-1.5 ${
                mode === 'signup'
                  ? 'bg-[#A67C52] text-white shadow-sm'
                  : 'text-[#6E6C66] hover:text-[#1A1A1E]'
              }`}
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>إنشاء حساب جديد</span>
            </button>
          </div>

          <div className="flex items-center gap-2 text-xs text-[#7B5836] bg-[#FBF8F4] border border-[#E6D5C3] rounded-xl px-3.5 py-2.5">
            <Database className="w-4 h-4 text-[#A67C52] shrink-0" />
            <span>
              {mode === 'signup'
                ? 'أنشئ حساب DressCode الخاص بك الآن مباشرة — سيتم ربطه تلقائياً بقاعدة بيانات PostgreSQL.'
                : 'سجّل الدخول بحساب فريق DressCode للمزامنة المباشرة مع PostgreSQL.'}
            </span>
          </div>

          {info && (
            <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-3.5 py-2.5 text-xs font-semibold text-emerald-800 flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{info}</span>
            </div>
          )}

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
                كلمة المرور {mode === 'signup' && <span className="text-[#6E6C66] font-normal">(6 أحرف على الأقل)</span>}
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-[#9C9990] absolute right-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="password"
                  required
                  minLength={6}
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
              className={`w-full rounded-xl text-white text-sm font-bold py-3 transition-colors cursor-pointer disabled:opacity-60 ${
                mode === 'signup'
                  ? 'bg-[#A67C52] hover:bg-[#8E6742]'
                  : 'bg-[#1A1A1E] hover:bg-[#2E2E35]'
              }`}
            >
              {loading
                ? 'جاري التنفيذ...'
                : mode === 'signup'
                ? 'إنشاء الحساب الآن'
                : 'تسجيل الدخول إلى النظام'}
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
