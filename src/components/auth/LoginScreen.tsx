import React, { useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  Database,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  User,
  UserPlus,
} from 'lucide-react';
import { resolveAuthIdentifier, supabase } from '../../lib/supabase';

interface LoginScreenProps {
  recoveryMode?: boolean;
  onRecoveryDone?: () => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({
  recoveryMode = false,
  onRecoveryDone,
}) => {
  const [mode, setMode] = useState<'signin' | 'signup' | 'forgot'>('signin');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const handleRecoverySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase) return;
    setError(null);
    setInfo(null);

    if (password.length < 6) {
      setError('يجب أن تكون كلمة المرور الجديدة 6 أحرف على الأقل.');
      return;
    }
    if (password !== confirmPassword) {
      setError('كلمتا المرور غير متطابقتين.');
      return;
    }

    setLoading(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        setError(updateError.message);
        return;
      }
      setInfo('تم تحديث كلمة المرور بنجاح! جاري الدخول إلى النظام...');
      setTimeout(() => {
        onRecoveryDone?.();
      }, 900);
    } catch {
      setError('تعذر تحديث كلمة المرور. حاول مرة أخرى.');
    } finally {
      setLoading(false);
    }
  };

  const formatAuthError = (msg: string): string => {
    const lower = msg.toLowerCase();
    if (lower.includes('rate limit') || lower.includes('too many requests')) {
      return 'تم تجاوز حد إرسال رسائل البريد الإلكتروني مؤقتاً (خطة Supabase المجانية تسمح برسالتين فقط في الساعة). انتظر قليلاً أو أنشئ/فعّل الحساب مباشرة من لوحة تحكم Supabase.';
    }
    if (lower.includes('already registered') || lower.includes('user already exists')) {
      return 'اسم المستخدم أو البريد الإلكتروني مسجّل بالفعل. انتقل إلى «تسجيل الدخول».';
    }
    if (lower.includes('invalid login credentials')) {
      return 'اسم المستخدم / البريد الإلكتروني أو كلمة المرور غير صحيحة.';
    }
    if (lower.includes('email not confirmed')) {
      return 'يرجى تفعيل الحساب أولاً (للحسابات باسم المستخدم مثل admin، نفّذ ملف 020_username_admin_account.sql أو فعّله من لوحة Supabase).';
    }
    return msg;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase) return;
    const rawId = identifier.trim();
    if (!rawId) return;

    const isPlainUsername = !rawId.includes('@');
    const resolvedEmail = resolveAuthIdentifier(rawId);

    setLoading(true);
    setError(null);
    setInfo(null);
    try {
      if (mode === 'forgot') {
        if (isPlainUsername) {
          setError(
            'استعادة كلمة المرور عبر البريد متاحة للحسابات المسجلة بإيميل حقيقي فقط. لتغيير كلمة مرور حساب باسم مستخدم (مثل admin)، أعد تشغيل ملف 020_username_admin_account.sql بكلمة المرور الجديدة أو عدّلها من لوحة Supabase.'
          );
          return;
        }
        const { error: resetError } = await supabase.auth.resetPasswordForEmail(resolvedEmail, {
          redirectTo: window.location.origin,
        });
        if (resetError) {
          setError(formatAuthError(resetError.message));
          return;
        }
        setInfo(
          'تم إرسال رابط إعادة تعيين كلمة المرور إلى بريدك الإلكتروني. افتح البريد واضغط على الرابط لاختيار كلمة مرور جديدة.'
        );
        return;
      }

      if (mode === 'signup') {
        if (password.length < 6) {
          setError('يجب أن تكون كلمة المرور 6 أحرف على الأقل.');
          return;
        }
        const cleanDisplay = isPlainUsername ? rawId.toLowerCase().replace(/\s+/g, '') : rawId;
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: resolvedEmail,
          password,
          options: {
            emailRedirectTo: window.location.origin,
            data: isPlainUsername
              ? { username: cleanDisplay, full_name: cleanDisplay }
              : undefined,
          },
        });
        if (signUpError) {
          setError(formatAuthError(signUpError.message));
          return;
        }
        if (data.session) {
          return;
        }
        setInfo(
          isPlainUsername
            ? `تم إنشاء حساب «${cleanDisplay}»! لأن الحساب بدون إيميل حقيقي، فعّله بنقرة واحدة من لوحة Supabase (Authentication → Users) أو عبر ملف 020_username_admin_account.sql ثم سجّل الدخول.`
            : 'تم إنشاء الحساب بنجاح! افتح بريدك الإلكتروني واضغط على رابط التفعيل من Supabase، ثم عد وسجّل الدخول.'
        );
        setMode('signin');
      } else {
        const { error: authError } = await supabase.auth.signInWithPassword({
          email: resolvedEmail,
          password,
        });
        if (authError) {
          setError(formatAuthError(authError.message));
        }
      }
    } catch {
      setError('تعذر الاتصال بخادم Supabase.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-[#F7F6F3] flex items-center justify-center p-3.5 sm:p-4">
      <div className="w-full max-w-md bg-white rounded-3xl border border-[#E5E3DD] shadow-xl overflow-hidden">
        <div className="bg-[#1A1A1E] text-white px-5 sm:px-8 py-6 sm:py-7 text-center">
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

        <div className="p-5 sm:p-7 space-y-4 sm:space-y-5">
          {recoveryMode ? (
            <>
              <div className="flex items-center gap-2 text-xs text-[#7B5836] bg-[#FBF8F4] border border-[#E6D5C3] rounded-xl px-3.5 py-2.5">
                <KeyRound className="w-4 h-4 text-[#A67C52] shrink-0" />
                <span>أدخل كلمة المرور الجديدة لحسابك في DressCode ERP.</span>
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

              <form onSubmit={handleRecoverySubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-[#1A1A1E] mb-1.5">
                    كلمة المرور الجديدة{' '}
                    <span className="text-[#6E6C66] font-normal">(6 أحرف على الأقل)</span>
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-[#9C9990] absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      minLength={6}
                      dir="ltr"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full rounded-xl border border-[#E5E3DD] bg-[#FAF9F7] pr-10 pl-10 py-2.5 text-sm text-left focus:outline-none focus:border-[#A67C52]"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                      className="absolute left-3 top-1/2 -translate-y-1/2 p-1 text-[#6E6C66] hover:text-[#1A1A1E] cursor-pointer"
                    >
                      {showPassword ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#1A1A1E] mb-1.5">
                    تأكيد كلمة المرور الجديدة
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-[#9C9990] absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type={showConfirmPassword ? 'text' : 'password'}
                      required
                      minLength={6}
                      dir="ltr"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full rounded-xl border border-[#E5E3DD] bg-[#FAF9F7] pr-10 pl-10 py-2.5 text-sm text-left focus:outline-none focus:border-[#A67C52]"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword((v) => !v)}
                      aria-label={
                        showConfirmPassword ? 'إخفاء تأكيد كلمة المرور' : 'إظهار تأكيد كلمة المرور'
                      }
                      className="absolute left-3 top-1/2 -translate-y-1/2 p-1 text-[#6E6C66] hover:text-[#1A1A1E] cursor-pointer"
                    >
                      {showConfirmPassword ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full rounded-xl bg-[#A67C52] hover:bg-[#8E6742] text-white text-sm font-bold py-3 transition-colors cursor-pointer disabled:opacity-60"
                >
                  {loading ? 'جاري التحديث...' : 'حفظ كلمة المرور الجديدة'}
                </button>
              </form>
            </>
          ) : (
            <>
              {/* Sign In / Sign Up Switch (hidden in Forgot Password view) */}
              {mode !== 'forgot' ? (
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
              ) : (
                <div className="flex items-center justify-between gap-2 pb-1">
                  <div className="flex items-center gap-2 text-sm font-bold text-[#1A1A1E]">
                    <KeyRound className="w-4 h-4 text-[#A67C52]" />
                    <span>استعادة كلمة المرور</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setMode('signin');
                      setError(null);
                      setInfo(null);
                    }}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-[#6E6C66] hover:text-[#1A1A1E] cursor-pointer"
                  >
                    <ArrowRight className="w-3.5 h-3.5" />
                    <span>العودة للدخول</span>
                  </button>
                </div>
              )}

              <div className="flex items-center gap-2 text-xs text-[#7B5836] bg-[#FBF8F4] border border-[#E6D5C3] rounded-xl px-3.5 py-2.5">
                <Database className="w-4 h-4 text-[#A67C52] shrink-0" />
                <span>
                  {mode === 'forgot'
                    ? 'أدخل بريدك الإلكتروني المسجّل وسنرسل لك رابطاً لإعادة تعيين كلمة المرور.'
                    : mode === 'signup'
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
                    {mode === 'forgot'
                      ? 'البريد الإلكتروني المسجّل'
                      : 'اسم المستخدم أو البريد الإلكتروني'}
                  </label>
                  <div className="relative">
                    <User className="w-4 h-4 text-[#9C9990] absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type={mode === 'forgot' ? 'email' : 'text'}
                      required
                      autoComplete="username"
                      dir="ltr"
                      value={identifier}
                      onChange={(e) => setIdentifier(e.target.value)}
                      placeholder={
                        mode === 'forgot'
                          ? 'name@example.com'
                          : 'admin  أو  name@example.com'
                      }
                      className="w-full rounded-xl border border-[#E5E3DD] bg-[#FAF9F7] pr-10 pl-3.5 py-2.5 text-sm text-left focus:outline-none focus:border-[#A67C52]"
                    />
                  </div>
                </div>

                {mode !== 'forgot' && (
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="block text-xs font-semibold text-[#1A1A1E]">
                        كلمة المرور{' '}
                        {mode === 'signup' && (
                          <span className="text-[#6E6C66] font-normal">(6 أحرف على الأقل)</span>
                        )}
                      </label>
                      {mode === 'signin' && (
                        <button
                          type="button"
                          onClick={() => {
                            setMode('forgot');
                            setError(null);
                            setInfo(null);
                          }}
                          className="text-xs font-semibold text-[#8E6742] hover:text-[#6E4F32] hover:underline cursor-pointer"
                        >
                          نسيت كلمة المرور؟
                        </button>
                      )}
                    </div>
                    <div className="relative">
                      <Lock className="w-4 h-4 text-[#9C9990] absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        type={showPassword ? 'text' : 'password'}
                        required
                        minLength={6}
                        dir="ltr"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="••••••••"
                        className="w-full rounded-xl border border-[#E5E3DD] bg-[#FAF9F7] pr-10 pl-10 py-2.5 text-sm text-left focus:outline-none focus:border-[#A67C52]"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        aria-label={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                        className="absolute left-3 top-1/2 -translate-y-1/2 p-1 text-[#6E6C66] hover:text-[#1A1A1E] cursor-pointer"
                      >
                        {showPassword ? (
                          <EyeOff className="w-4 h-4" />
                        ) : (
                          <Eye className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className={`w-full rounded-xl text-white text-sm font-bold py-3 transition-colors cursor-pointer disabled:opacity-60 ${
                    mode === 'signup' || mode === 'forgot'
                      ? 'bg-[#A67C52] hover:bg-[#8E6742]'
                      : 'bg-[#1A1A1E] hover:bg-[#2E2E35]'
                  }`}
                >
                  {loading
                    ? 'جاري التنفيذ...'
                    : mode === 'forgot'
                    ? 'إرسال رابط إعادة التعيين'
                    : mode === 'signup'
                    ? 'إنشاء الحساب الآن'
                    : 'تسجيل الدخول إلى النظام'}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
