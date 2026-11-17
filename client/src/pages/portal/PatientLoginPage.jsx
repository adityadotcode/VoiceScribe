/**
 * PatientLoginPage — Patient portal sign-in
 *
 * Milestone 1 improvements:
 *   - Password visibility toggle.
 *   - Session-expired notice when arriving with ?expired=1 (set by
 *     PatientPortalLayout on 401 responses — future hardening hook).
 *   - Clears error on field change.
 */

import { useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { usePatientAuth } from '../../contexts/PatientPortalAuthContext.jsx';

export default function PatientLoginPage() {
  const { login, isAuthenticated, isLoading } = usePatientAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const sessionExpired = searchParams.get('expired') === '1';

  const [email,        setEmail]        = useState('');
  const [password,     setPassword]     = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error,        setError]        = useState('');
  const [submitting,   setSubmitting]   = useState(false);

  if (!isLoading && isAuthenticated) {
    return <Navigate to="/portal/history" replace />;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (submitting) return;
    setError('');
    setSubmitting(true);
    const result = await login({ email: email.trim(), password });
    setSubmitting(false);
    if (!result?.success) {
      setError('Invalid email or password.');
      return;
    }
    navigate('/portal/history', { replace: true });
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-brand">
          <span className="app-logo-mark" aria-hidden="true">VS</span>
          <span className="app-brand-name">VoiceScribe</span>
        </div>
        <p className="auth-subtitle">Patient health record portal</p>

        <h1 className="auth-title">Sign in to your records</h1>

        {/* Session-expired notice */}
        {sessionExpired && !error && (
          <p className="auth-notice" role="status">
            Your session has expired. Please sign in again.
          </p>
        )}

        {error && (
          <p className="auth-error" role="alert">{error}</p>
        )}

        <form className="auth-form" onSubmit={handleSubmit} noValidate>
          <div className="auth-field">
            <label htmlFor="pp-email" className="auth-label">Email</label>
            <input
              id="pp-email"
              type="email"
              className="auth-input"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => { setEmail(e.target.value); setError(''); }}
              disabled={submitting}
            />
          </div>

          <div className="auth-field">
            <label htmlFor="pp-password" className="auth-label">Password</label>
            <div className="auth-password-row">
              <input
                id="pp-password"
                type={showPassword ? 'text' : 'password'}
                className="auth-input auth-input--password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError(''); }}
                disabled={submitting}
              />
              <button
                type="button"
                className="auth-toggle-pw"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                tabIndex={-1}
              >
                {showPassword ? '🙈' : '👁'}
              </button>
            </div>
          </div>

          <button
            type="submit"
            className="auth-submit"
            disabled={submitting || !email || !password}
          >
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="auth-footer">
          Have an invite?{' '}
          <Link to="/portal/register" className="auth-link">
            Create your account
          </Link>
        </p>
      </div>
    </div>
  );
}
