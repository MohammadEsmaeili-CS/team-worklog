import { useEffect, useState } from 'react';

import { api } from './api';
import MemberDashboard from './components/MemberDashboard';
import ManagerDashboard from './components/ManagerDashboard';
import ForcedPasswordChange from './components/ForcedPasswordChange';
import './App.css';

const emptyLoginForm = {
  identifier: '',
  password: '',
};

const emptyRegisterForm = {
  fullName: '',
  username: '',
  email: '',
  password: '',
};

const roleLabels = {
  manager: 'مدیر',
  member: 'عضو تیم',
};

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authMode, setAuthMode] = useState('login');
  const [loginForm, setLoginForm] = useState(emptyLoginForm);
  const [registerForm, setRegisterForm] =
    useState(emptyRegisterForm);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let ignore = false;

    async function loadCurrentUser() {
      try {
        const result = await api.get('/account/me');

        if (!ignore) {
          setUser(result.user);
        }
      } catch {
        if (!ignore) {
          setUser(null);
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    }

    loadCurrentUser();

    return () => {
      ignore = true;
    };
  }, []);

  function changeMode(mode) {
    setAuthMode(mode);
    setMessage('');
    setError('');
  }

  function updateLoginForm(event) {
    const { name, value } = event.target;

    setLoginForm((currentForm) => ({
      ...currentForm,
      [name]: value,
    }));
  }

  function updateRegisterForm(event) {
    const { name, value } = event.target;

    setRegisterForm((currentForm) => ({
      ...currentForm,
      [name]: value,
    }));
  }

  async function handleLogin(event) {
    event.preventDefault();
    setSubmitting(true);
    setMessage('');
    setError('');

    try {
      const result = await api.post('/auth/login', loginForm);

      setUser(result.user);
      setLoginForm(emptyLoginForm);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRegister(event) {
    event.preventDefault();
    setSubmitting(true);
    setMessage('');
    setError('');

    try {
      const result = await api.post(
        '/auth/register',
        registerForm,
      );

      setMessage(result.message);
      setRegisterForm(emptyRegisterForm);
      setAuthMode('login');
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleLogout() {
    setSubmitting(true);
    setError('');

    try {
      await api.post('/auth/logout');
      setUser(null);
      setMessage('با موفقیت از حساب خارج شدید.');
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="loading-screen" dir="rtl">
        <div className="loading-spinner" />
        <p>در حال اتصال به سامانه...</p>
      </div>
    );
  }

  if (!user) {
    return (
      <main className="auth-page" dir="rtl">
        <section className="brand-panel">
          <div className="brand-mark">ک</div>

          <div>
            <p className="eyebrow">KARNAMA</p>
            <h1>کارنما</h1>
            <p className="brand-description">
              ثبت فعالیت، محاسبه زمان و تأیید شفاف عملکرد
              اعضای تیم در یک محیط یکپارچه.
            </p>
          </div>

          <div className="feature-list">
            <div className="feature-item">
              <span>۱</span>
              <p>ثبت دستی زمان یا استفاده از زمان‌سنج</p>
            </div>

            <div className="feature-item">
              <span>۲</span>
              <p>حفظ حریم خصوصی فعالیت اعضا</p>
            </div>

            <div className="feature-item">
              <span>۳</span>
              <p>تأیید نهایی فعالیت توسط هر دو مدیر</p>
            </div>
          </div>
        </section>

        <section className="auth-panel">
          <div className="auth-card">
            <div className="auth-heading">
              <p className="eyebrow">ورود امن</p>
              <h2>
                {authMode === 'login'
                  ? 'خوش آمدید'
                  : 'ایجاد حساب عضو'}
              </h2>
              <p>
                {authMode === 'login'
                  ? 'برای ادامه وارد حساب خود شوید.'
                  : 'پس از ثبت‌نام، حساب باید توسط مدیر تأیید شود.'}
              </p>
            </div>

            <div className="auth-tabs">
              <button
                type="button"
                className={
                  authMode === 'login' ? 'active' : ''
                }
                onClick={() => changeMode('login')}
              >
                ورود
              </button>

              <button
                type="button"
                className={
                  authMode === 'register' ? 'active' : ''
                }
                onClick={() => changeMode('register')}
              >
                ثبت‌نام
              </button>
            </div>

            {message && (
              <div className="alert success">{message}</div>
            )}

            {error && (
              <div className="alert error">{error}</div>
            )}

            {authMode === 'login' ? (
              <form
                className="auth-form"
                onSubmit={handleLogin}
              >
                <label>
                  نام کاربری یا ایمیل
                  <input
                    name="identifier"
                    value={loginForm.identifier}
                    onChange={updateLoginForm}
                    placeholder="مثلاً rezaei"
                    autoComplete="username"
                    required
                  />
                </label>

                <label>
                  رمز عبور
                  <input
                    type="password"
                    name="password"
                    value={loginForm.password}
                    onChange={updateLoginForm}
                    placeholder="رمز عبور خود را وارد کنید"
                    autoComplete="current-password"
                    required
                  />
                </label>

                <button
                  className="primary-button"
                  type="submit"
                  disabled={submitting}
                >
                  {submitting
                    ? 'در حال ورود...'
                    : 'ورود به سامانه'}
                </button>
              </form>
            ) : (
              <form
                className="auth-form"
                onSubmit={handleRegister}
              >
                <label>
                  نام و نام خانوادگی
                  <input
                    name="fullName"
                    value={registerForm.fullName}
                    onChange={updateRegisterForm}
                    placeholder="نام کامل"
                    autoComplete="name"
                    required
                  />
                </label>

                <label>
                  نام کاربری
                  <input
                    name="username"
                    value={registerForm.username}
                    onChange={updateRegisterForm}
                    placeholder="حروف انگلیسی و عدد"
                    autoComplete="username"
                    required
                  />
                </label>

                <label>
                  ایمیل
                  <input
                    type="email"
                    name="email"
                    value={registerForm.email}
                    onChange={updateRegisterForm}
                    placeholder="name@example.com"
                    autoComplete="email"
                    required
                  />
                </label>

                <label>
                  رمز عبور
                  <input
                    type="password"
                    name="password"
                    value={registerForm.password}
                    onChange={updateRegisterForm}
                    placeholder="حداقل ۸ کاراکتر"
                    autoComplete="new-password"
                    minLength="8"
                    required
                  />
                </label>

                <button
                  className="primary-button"
                  type="submit"
                  disabled={submitting}
                >
                  {submitting
                    ? 'در حال ثبت‌نام...'
                    : 'ایجاد حساب'}
                </button>
              </form>
            )}
          </div>
        </section>
      </main>
    );
  }

  if (user.mustChangePassword) {
  return (
    <ForcedPasswordChange
      user={user}
      onPasswordChanged={() =>
        setUser((currentUser) => ({
          ...currentUser,
          mustChangePassword: false,
        }))
      }
      onLogout={handleLogout}
      logoutPending={submitting}
    />
  );
}

  if (user.role === 'member') {
    return (
      <MemberDashboard
        user={user}
        onLogout={handleLogout}
        logoutPending={submitting}
      />
    );
  }
  if (user.role === 'manager') {
    return (
      <ManagerDashboard
        user={user}
        onLogout={handleLogout}
        logoutPending={submitting}
      />
    );
  }

  return (
    <main className="dashboard-shell" dir="rtl">
      <header className="dashboard-header">
        <div className="dashboard-brand">
          <div className="brand-mark small">ک</div>

          <div>
            <strong>کارنما</strong>
            <span>
              {roleLabels[user.role] || user.role}
            </span>
          </div>
        </div>

        <div className="user-menu">
          <div>
            <strong>{user.fullName}</strong>
            <span>@{user.username}</span>
          </div>

          <button
            type="button"
            className="secondary-button"
            onClick={handleLogout}
            disabled={submitting}
          >
            خروج
          </button>
        </div>
      </header>

      <section className="welcome-card">
        <p className="eyebrow">ورود موفق</p>
        <h1>سلام {user.fullName}</h1>
        <p>
          حساب شما با نقش «
          {roleLabels[user.role] || user.role}
          » وارد سامانه شده است.
        </p>

        <div className="status-chip">
          حساب فعال
        </div>
      </section>
    </main>
  );
}

export default App;
