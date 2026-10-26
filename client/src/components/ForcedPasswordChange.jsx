import { useState } from 'react';

import { api } from '../api';

function ForcedPasswordChange({
  user,
  onPasswordChanged,
  onLogout,
  logoutPending,
}) {
  const [form, setForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });

  const [submitting, setSubmitting] = useState(false);
  const [passwordChanged, setPasswordChanged] =
    useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  function updateForm(event) {
    const { name, value } = event.target;

    setForm((currentForm) => ({
      ...currentForm,
      [name]: value,
    }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setMessage('');
    setError('');

    if (form.newPassword.length < 8) {
      setError('رمز جدید باید حداقل 8 کاراکتر باشد.');
      return;
    }

    if (form.newPassword !== form.confirmPassword) {
      setError('رمز جدید و تکرار آن یکسان نیستند.');
      return;
    }

    if (form.currentPassword === form.newPassword) {
      setError('رمز جدید باید با رمز موقت متفاوت باشد.');
      return;
    }

    setSubmitting(true);

    try {
      const result = await api.patch('/account/password', {
        currentPassword: form.currentPassword,
        newPassword: form.newPassword,
      });

      setMessage(result.message);
      setPasswordChanged(true);

      setForm({
        currentPassword: '',
        newPassword: '',
        confirmPassword: '',
      });
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="password-change-shell" dir="rtl">
      <section className="password-change-card">
        <header className="password-change-header">
          <div className="brand-mark">ک</div>

          <div>
            <span className="eyebrow">امنیت حساب</span>
            <h1>تغییر رمز عبور</h1>
            <p>
              سلام {user.fullName}، مدیر رمز حساب شما را
              بازنشانی کرده است.
            </p>
          </div>
        </header>

        {message && (
          <div className="alert success">{message}</div>
        )}

        {error && (
          <div className="alert error">{error}</div>
        )}

        {passwordChanged ? (
          <div className="password-change-success">
            <strong>رمز شخصی شما ثبت شد.</strong>

            <p>
              اکنون می‌توانید با رمز جدید وارد داشبورد خود
              شوید.
            </p>

            <button
              type="button"
              className="primary-button full-width"
              onClick={onPasswordChanged}
            >
              ورود به داشبورد
            </button>
          </div>
        ) : (
          <form
            className="dashboard-form"
            onSubmit={handleSubmit}
          >
            <label>
              رمز موقت
              <input
                type="password"
                name="currentPassword"
                value={form.currentPassword}
                onChange={updateForm}
                autoComplete="current-password"
                placeholder="رمزی که مدیر به شما داده است"
                required
                disabled={submitting}
              />
            </label>

            <label>
              رمز شخصی جدید
              <input
                type="password"
                name="newPassword"
                value={form.newPassword}
                onChange={updateForm}
                autoComplete="new-password"
                placeholder="حداقل 8 کاراکتر"
                minLength="8"
                maxLength="100"
                required
                disabled={submitting}
              />
            </label>

            <label>
              تکرار رمز شخصی جدید
              <input
                type="password"
                name="confirmPassword"
                value={form.confirmPassword}
                onChange={updateForm}
                autoComplete="new-password"
                placeholder="رمز جدید را دوباره وارد کنید"
                minLength="8"
                maxLength="100"
                required
                disabled={submitting}
              />
            </label>

            <button
              type="submit"
              className="primary-button full-width"
              disabled={submitting}
            >
              {submitting
                ? 'در حال تغییر رمز...'
                : 'ثبت رمز شخصی جدید'}
            </button>
          </form>
        )}

        <button
          type="button"
          className="secondary-button password-change-logout"
          onClick={onLogout}
          disabled={logoutPending || submitting}
        >
          خروج از حساب
        </button>
      </section>
    </main>
  );
}

export default ForcedPasswordChange;
